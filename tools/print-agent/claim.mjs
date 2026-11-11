import { classifyPrintError } from './queue.mjs';

/**
 * Claims queued jobs from Supabase so a ticket fired while this workstation was
 * switched off still prints when it comes back — without a browser open.
 *
 * The cloud row is the system of record; the local durable queue is the
 * idempotency record. A claimed job is admitted with the key `fnb:<job id>`, so
 * a re-claim of the same row (a lease that expired, a duplicate poll, an agent
 * restart) finds the existing local record instead of printing a second copy.
 *
 * Everything here is injected (`client`, `acceptJob`) so the claim logic is
 * tested without a database or a printer.
 */

export const CLAIM_RPC = 'fn_claim_fnb_print_jobs';
export const COMPLETE_RPC = 'fn_complete_fnb_print_job';
// Paired workstations authenticate with their own secret instead of a service key.
export const TOKEN_CLAIM_RPC = 'fn_print_agent_claim';
export const TOKEN_COMPLETE_RPC = 'fn_print_agent_complete';

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ALLOWED_PORTS = new Set([9100, 9101, 9102]);
const MAX_PAYLOAD_CHARS = 700_000;

/** Where a claimed job should print, taken from the payload stored by the app. */
export function resolveClaimedJobTarget(job) {
  const target = job?.payload?.printTarget;
  if (!target) return null;

  const printerName = String(target.windowsPrinterName || '').trim();
  if (printerName) return { transport: 'windows_spooler', target: { printerName } };

  const host = String(target.host || '').trim();
  const port = Number(target.port);
  if (IPV4.test(host) && ALLOWED_PORTS.has(port)) return { transport: 'network_ip', target: { host, port } };

  return null;
}

/** The ESC/POS bytes the app stored with the job, or null when they are missing. */
export function claimedJobPayload(job) {
  const raw = job?.payload?.escposBase64;
  if (typeof raw !== 'string' || !raw.length) return null;
  if (raw.length > MAX_PAYLOAD_CHARS) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return null;
  return Buffer.from(raw, 'base64');
}

const isMissingFunction = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST202' || /could not find the function|does not exist/i.test(message);
};

const MISSING_TARGET_MESSAGE = 'This print job has no printer address stored with it, so the agent cannot print it. Print a new copy from the app.';
const MISSING_PAYLOAD_MESSAGE = 'This print job was saved without its print data. Print a new copy from the app.';

export function createJobClaimer({
  client,
  agentId,
  propertyId = null,
  logger = null,
  acceptJob,
  batchSize = 3,
  leaseSeconds = 120,
  token = null,
} = {}) {
  let disabledReason = null;

  const warn = (message, details) => { try { logger?.warn?.(message, details); } catch (_) { /* ignore */ } };
  const info = (message, details) => { try { logger?.info?.(message, details); } catch (_) { /* ignore */ } };

  async function complete(job, status, message) {
    try {
      const { error } = token
        ? await client.rpc(TOKEN_COMPLETE_RPC, {
          p_token: token,
          p_job_id: job.id,
          p_status: status,
          p_error_message: message,
        })
        : await client.rpc(COMPLETE_RPC, {
          p_job_id: job.id,
          p_status: status,
          p_error_message: message,
          p_agent_id: agentId,
        });
      if (error) warn('could not report a claimed print job', { jobId: job.id, status, error: error.message });
    } catch (error) {
      warn('could not report a claimed print job', { jobId: job.id, status, error: error?.message });
    }
  }

  async function claimOnce() {
    const summary = { claimed: 0, printed: 0, failed: 0, uncertain: 0, skipped: 0, disabled: disabledReason };
    if (disabledReason) return summary;
    if (!client || (!agentId && !token) || typeof acceptJob !== 'function') {
      disabledReason = 'NOT_CONFIGURED';
      summary.disabled = disabledReason;
      return summary;
    }

    let data;
    try {
      const response = token
        ? await client.rpc(TOKEN_CLAIM_RPC, {
          p_token: token,
          p_limit: batchSize,
          p_lease_seconds: leaseSeconds,
        })
        : await client.rpc(CLAIM_RPC, {
          p_agent_id: agentId,
          p_property_id: propertyId,
          p_limit: batchSize,
          p_lease_seconds: leaseSeconds,
        });
      if (response?.error) throw response.error;
      data = response?.data;
    } catch (error) {
      if (isMissingFunction(error)) {
        disabledReason = 'RPC_UNAVAILABLE';
        warn('cloud print claims are unavailable; the database has no claim function yet', { error: error?.message });
      } else {
        warn('could not claim cloud print jobs', { error: error?.message });
      }
      summary.disabled = disabledReason;
      return summary;
    }

    const jobs = Array.isArray(data) ? data : (data ? [data] : []);
    summary.claimed = jobs.length;

    for (const job of jobs) {
      const resolved = resolveClaimedJobTarget(job);
      const payload = claimedJobPayload(job);

      if (!resolved || !payload) {
        summary.failed += 1;
        await complete(job, 'failed', resolved ? MISSING_PAYLOAD_MESSAGE : MISSING_TARGET_MESSAGE);
        continue;
      }

      let status = 'failed';
      let message = null;
      try {
        const outcome = await acceptJob({
          idempotencyKey: `fnb:${job.id}`,
          transport: resolved.transport,
          target: resolved.target,
          payloadBase64: payload.toString('base64'),
          title: job.title || null,
          meta: { jobId: job.id, propertyId: job.property_id || null, printerId: job.printer_id || null, source: 'cloud_queue' },
        });

        if (outcome?.ok) {
          status = 'printed';
        } else if (outcome?.status === 'uncertain') {
          status = 'uncertain';
          message = outcome.message || 'The printer did not confirm this job.';
        } else if (outcome?.code === 'PRINT_JOB_IN_PROGRESS' || outcome?.status === 'printing' || outcome?.status === 'queued') {
          // Another attempt (or this agent's earlier delivery) still owns the
          // job. Leave the row claimed: its lease will settle it one way or the
          // other, and completing it here would race the real outcome.
          summary.skipped += 1;
          continue;
        } else {
          status = 'failed';
          message = outcome?.message || 'The printer did not accept the job.';
        }
      } catch (error) {
        status = classifyPrintError(error) === 'uncertain' ? 'uncertain' : 'failed';
        message = error?.message || 'The printer did not accept the job.';
      }

      if (status === 'printed') summary.printed += 1;
      else if (status === 'uncertain') summary.uncertain += 1;
      else summary.failed += 1;

      await complete(job, status, message);
    }

    if (summary.claimed) {
      info('cloud print queue polled', {
        claimed: summary.claimed,
        printed: summary.printed,
        failed: summary.failed,
        uncertain: summary.uncertain,
        skipped: summary.skipped,
      });
    }
    return summary;
  }

  return {
    claimOnce,
    get disabled() { return disabledReason; },
  };
}
