/**
 * Turns the local agent's health and queue into something a receptionist can
 * read at a glance: is the agent running, is anything waiting, and did any job
 * fail or end up in the `uncertain` state where paper may or may not have come
 * out.
 *
 * Pure functions plus two thin fetch helpers, so the wording and the decisions
 * are testable without a browser or a printer.
 */

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:8631';

export function normalizeAgentBaseUrl(value = DEFAULT_AGENT_URL) {
  let base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) base = DEFAULT_AGENT_URL;
  base = base.replace(/\/(?:api|print-agent)$/i, '');
  return base.replace(/\/+$/, '');
}

export const ATTENTION_STATUSES = Object.freeze(['failed', 'uncertain']);

const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

export function statusLabel(status) {
  if (status === 'printed') return 'Printed';
  if (status === 'printing') return 'Printing';
  if (status === 'queued') return 'Waiting';
  if (status === 'failed') return 'Did not print';
  if (status === 'uncertain') return 'Needs checking';
  return 'Unknown';
}

/**
 * @param {{ agent?: object|null, queue?: object|null }} input
 * `agent` is the `/health` body, `queue` the `/queue` body.
 */
export function summarizePrintHealth({ agent = null, queue = null } = {}) {
  if (!agent || agent.ok === false) {
    return {
      reachable: false,
      tone: 'danger',
      headline: 'The print agent is not running on this computer.',
      detail: 'Printing from the app will fail until it is running. It starts automatically after installation; restart the computer if it does not come back.',
      counts: null,
      attention: [],
    };
  }

  const counts = queue?.counts || agent.queue || null;
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const attention = items
    .filter((job) => ATTENTION_STATUSES.includes(job?.status))
    .slice(0, 5);

  const uncertain = counts?.uncertain || 0;
  const failed = counts?.failed || 0;
  const waiting = counts?.queued || 0;

  if (uncertain) {
    return {
      reachable: true,
      tone: 'warning',
      headline: `${plural(uncertain, 'print job')} may not have printed.`,
      detail: 'The printer never confirmed these jobs. Check the paper before reprinting: if it is already there, reprinting would give the guest two copies.',
      counts,
      attention,
    };
  }

  if (failed) {
    return {
      reachable: true,
      tone: 'danger',
      headline: `${plural(failed, 'print job')} did not reach the printer.`,
      detail: 'Check the printer is switched on and connected, then reprint. Nothing was printed twice to get here.',
      counts,
      attention,
    };
  }

  if (waiting) {
    return {
      reachable: true,
      tone: 'warning',
      headline: `${plural(waiting, 'print job')} waiting to print.`,
      detail: 'The agent is sending these now. They will print without anyone keeping the app open.',
      counts,
      attention,
    };
  }

  return {
    reachable: true,
    tone: 'ok',
    headline: 'Print agent is running and the queue is clear.',
    detail: counts ? `${plural(counts.printed || 0, 'job')} printed recently.` : '',
    counts,
    attention,
  };
}

async function getJson(fetchImpl, url, { timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads `/health` (with queue counts) and `/queue` (with job details). */
export async function fetchPrintHealth(agentUrl, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const base = normalizeAgentBaseUrl(agentUrl);
  const { response, body } = await getJson(fetchImpl, `${base}/health`, { timeoutMs });
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || 'The print agent did not answer correctly.');
  }

  let queue = null;
  try {
    const queueResult = await getJson(fetchImpl, `${base}/queue`, { timeoutMs });
    if (queueResult.response.ok && queueResult.body?.ok) queue = queueResult.body;
  } catch (_) {
    // Older agents have no /queue; health counts are still useful.
  }

  return { baseUrl: base, agent: body, queue, ...summarizePrintHealth({ agent: body, queue }) };
}

/** Deliberate reprint of a failed or uncertain job. */
export async function retryPrintJob(agentUrl, jobId, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, message: 'Choose a print job to reprint.' };

  const base = normalizeAgentBaseUrl(agentUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/queue/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok) return { ok: true, job: body.job || null };
    return {
      ok: false,
      code: body?.code || `HTTP_${response.status}`,
      message: body?.message || 'The printer did not accept the reprint.',
    };
  } finally {
    clearTimeout(timer);
  }
}
