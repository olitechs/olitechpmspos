import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A durable, crash-safe print queue for the local agent.
 *
 * Why this exists: the agent used to accept a print over HTTP, write bytes to a
 * socket and forget the job. If the service restarted mid-print, nobody could
 * say whether paper came out, and a retry risked a second copy of one receipt.
 *
 * Two properties matter more than throughput here:
 *
 * 1. Write-ahead. A job is on disk *before* any bytes reach the printer, and it
 *    is marked as attempted before the socket write starts. A crash therefore
 *    leaves a record that can be reported as `uncertain` instead of a job that
 *    silently disappears.
 * 2. At most one print per idempotency key. Receipts, tickets and reports carry
 *    a key derived from the document they belong to. A duplicate submission
 *    finds the existing record instead of producing a second copy.
 *
 * Storage is deliberately dependency-free: an append-only NDJSON journal plus a
 * compacted snapshot. No native modules, so it installs on any Windows PC.
 */

export const QUEUE_STATUSES = Object.freeze(['queued', 'printing', 'printed', 'failed', 'uncertain']);

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 500;
const MAX_KEY_LENGTH = 200;
const JOURNAL_COMPACT_AFTER = 1000;

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/**
 * Keys come from the browser, so normalise instead of trusting them: trim,
 * bound the length, and treat empty as "no dedupe requested".
 */
export function normalizeIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return null;
  return key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
}

/**
 * Decides whether a failed attempt is safe to retry.
 *
 * If any bytes reached a connected socket, the printer may already have put
 * them on paper. Retrying that automatically is exactly how a guest receives
 * two copies of one bill, so it is reported as `uncertain` and left for a human
 * to check. A refused connection never delivered anything, so it is `failed`
 * and safe to send again.
 */
export function classifyPrintError(error) {
  if (error?.delivered === true) return 'uncertain';
  if (error?.delivered === false) return 'failed';
  const code = String(error?.code || '').toUpperCase();
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PRINT_OUTCOME_UNCERTAIN'].includes(code)) return 'uncertain';
  return 'failed';
}

function publicJob(job) {
  return {
    id: job.id,
    idempotencyKey: job.idempotencyKey,
    title: job.title,
    transport: job.transport,
    target: job.target || null,
    meta: job.meta || {},
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    error: job.error || null,
    hasPayload: Boolean(job.payloadBase64),
    createdAt: iso(job.createdAt),
    updatedAt: iso(job.updatedAt),
    lastAttemptAt: iso(job.lastAttemptAt),
    printedAt: iso(job.printedAt),
    nextAttemptAt: iso(job.nextAttemptAt),
  };
}

export function createDurableQueue({
  dir,
  logger = null,
  now = () => Date.now(),
  retentionMs = DEFAULT_RETENTION_MS,
  maxRecords = DEFAULT_MAX_RECORDS,
  maxAttempts = 3,
} = {}) {
  if (!dir) throw new Error('A durable print queue needs a directory to persist into.');

  fs.mkdirSync(dir, { recursive: true });
  const journalPath = path.join(dir, 'journal.ndjson');
  const snapshotPath = path.join(dir, 'snapshot.json');

  const jobs = new Map();
  const keyIndex = new Map();
  let handle = null;
  let closed = false;
  let eventCount = 0;
  let recoveredCount = 0;

  const warn = (message, details) => { try { logger?.warn?.(message, details); } catch (_) { /* logging must never break printing */ } };
  const info = (message, details) => { try { logger?.info?.(message, details); } catch (_) { /* ignore */ } };

  function openHandle() {
    if (!handle) handle = fs.openSync(journalPath, 'a');
    return handle;
  }

  function append(event) {
    if (closed) return;
    const fd = openHandle();
    fs.writeSync(fd, `${JSON.stringify(event)}\n`);
    // fsync, not just write: an accepted job must survive a power cut and not
    // only a clean process exit.
    try { fs.fsyncSync(fd); } catch (_) { /* some filesystems do not support it */ }
    eventCount += 1;
  }

  function indexJob(job) {
    if (job.idempotencyKey) keyIndex.set(job.idempotencyKey, job.id);
  }

  function applyEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.t === 'accepted' && event.job?.id) {
      jobs.set(event.job.id, { ...event.job });
      indexJob(event.job);
      return;
    }
    if (event.t === 'update' && event.id) {
      const job = jobs.get(event.id);
      if (job) Object.assign(job, event.patch || {});
      return;
    }
    if (event.t === 'payload-dropped' && event.id) {
      const job = jobs.get(event.id);
      if (job) {
        job.payloadBase64 = null;
        job.payloadDropped = true;
      }
    }
  }

  function load() {
    try {
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      for (const job of snapshot?.jobs || []) {
        if (job?.id) {
          jobs.set(job.id, { ...job });
          indexJob(job);
        }
      }
    } catch (_) {
      // A missing snapshot is normal on first start.
    }

    let raw = '';
    try { raw = fs.readFileSync(journalPath, 'utf8'); } catch (_) { return; }

    let unreadable = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        applyEvent(JSON.parse(trimmed));
      } catch (_) {
        // A torn final line is exactly what a power cut mid-append looks like.
        // Dropping it keeps every earlier job intact.
        unreadable += 1;
      }
    }
    if (unreadable) warn('discarded unreadable print queue journal lines', { count: unreadable });
  }

  function compact() {
    const payload = { version: 1, savedAt: iso(now()), jobs: [...jobs.values()] };
    const tmp = `${snapshotPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, snapshotPath);
    if (handle !== null) {
      try { fs.closeSync(handle); } catch (_) { /* ignore */ }
      handle = null;
    }
    fs.writeFileSync(journalPath, '');
    eventCount = 0;
  }

  function patchJob(job, patch) {
    const updatedAt = now();
    Object.assign(job, patch, { updatedAt });
    append({ t: 'update', id: job.id, patch: { ...patch, updatedAt } });
    return job;
  }

  function dropPayload(job) {
    job.payloadBase64 = null;
    job.payloadDropped = true;
    append({ t: 'payload-dropped', id: job.id });
  }

  /**
   * Records a job and returns it. `duplicate: true` means a record with the same
   * idempotency key already exists; the caller decides what to tell the client.
   * A previously failed job is reused, because nothing reached the printer and
   * keeping one row per document makes the queue readable.
   */
  function enqueue({
    idempotencyKey = null,
    transport = 'network_ip',
    target = null,
    payloadBase64 = '',
    title = null,
    meta = {},
    attemptLimit = maxAttempts,
  } = {}) {
    const key = normalizeIdempotencyKey(idempotencyKey);

    if (key) {
      const existing = jobs.get(keyIndex.get(key));
      if (existing) {
        if (existing.status === 'failed') {
          const reactivated = patchJob(existing, {
            status: 'queued',
            transport,
            target,
            payloadBase64,
            title,
            meta,
            attempts: 0,
            error: null,
            nextAttemptAt: null,
            printedAt: null,
          });
          return { job: reactivated, duplicate: false, reactivated: true };
        }
        return { job: existing, duplicate: true };
      }
    }

    const timestamp = now();
    const job = {
      id: crypto.randomUUID(),
      idempotencyKey: key,
      transport,
      target,
      payloadBase64,
      title,
      meta,
      status: 'queued',
      attempts: 0,
      maxAttempts: attemptLimit,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastAttemptAt: null,
      printedAt: null,
      nextAttemptAt: null,
    };

    jobs.set(job.id, job);
    indexJob(job);
    append({ t: 'accepted', job: { ...job } });
    return { job, duplicate: false };
  }

  function markAttempt(id) {
    const job = jobs.get(id);
    if (!job) return null;
    return patchJob(job, {
      status: 'printing',
      attempts: job.attempts + 1,
      lastAttemptAt: now(),
      error: null,
    });
  }

  function markPrinted(id) {
    const job = jobs.get(id);
    if (!job) return null;
    const updated = patchJob(job, {
      status: 'printed',
      printedAt: now(),
      nextAttemptAt: null,
      error: null,
    });
    // The ESC/POS bytes are only needed while a job can still be sent. Keeping
    // every receipt body for a week would fill the disk for no benefit.
    dropPayload(updated);
    return updated;
  }

  function markFailed(id, error) {
    const job = jobs.get(id);
    if (!job) return null;
    return patchJob(job, {
      status: 'failed',
      error: { code: String(error?.code || 'PRINT_FAILED'), message: String(error?.message || 'The printer did not accept the job.'), at: now() },
    });
  }

  function markUncertain(id, error) {
    const job = jobs.get(id);
    if (!job) return null;
    return patchJob(job, {
      status: 'uncertain',
      error: { code: String(error?.code || 'PRINT_OUTCOME_UNCERTAIN'), message: String(error?.message || 'The printer did not confirm the job.'), at: now() },
    });
  }

  function scheduleRetry(id, delayMs) {
    const job = jobs.get(id);
    if (!job) return null;
    return patchJob(job, {
      status: 'queued',
      nextAttemptAt: now() + Math.max(0, Number(delayMs) || 0),
    });
  }

  /** Oldest queued job that is due and still has attempts left, with its payload. */
  function nextQueued({ attemptLimit = maxAttempts } = {}) {
    const timestamp = now();
    const candidates = [...jobs.values()].filter((job) =>
      job.status === 'queued' &&
      Boolean(job.payloadBase64) &&
      (!job.nextAttemptAt || job.nextAttemptAt <= timestamp) &&
      job.attempts < Math.max(1, Number(job.maxAttempts || attemptLimit)));
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.createdAt - b.createdAt);
    return candidates[0];
  }

  /** A queued job that can never be attempted again must not look pending forever. */
  function failExhausted({ attemptLimit = maxAttempts } = {}) {
    const limit = Math.max(1, Number(attemptLimit) || maxAttempts);
    let failed = 0;
    for (const job of jobs.values()) {
      if (job.status !== 'queued' || job.attempts < limit) continue;
      patchJob(job, {
        status: 'failed',
        error: {
          code: 'PRINT_ATTEMPTS_EXHAUSTED',
          message: `The printer did not accept this job after ${job.attempts} attempts. Check the printer, then reprint from the printer queue.`,
          at: now(),
        },
      });
      failed += 1;
    }
    return failed;
  }

  /**
   * Deliberate, staff-initiated reprint. Never automatic: an `uncertain` job may
   * already be on paper, so only a human can decide to send it again.
   */
  function requeue(id) {
    const job = jobs.get(String(id || ''));
    if (!job) {
      const error = new Error('That print job is no longer in the queue on this computer.');
      error.code = 'PRINT_JOB_NOT_FOUND';
      throw error;
    }
    if (job.status === 'printed') {
      const error = new Error('That print job already printed. Print a new copy from the app instead of resending it, so the receipt keeps its own record.');
      error.code = 'PRINT_JOB_ALREADY_PRINTED';
      throw error;
    }
    if (!job.payloadBase64) {
      const error = new Error('The print data for this job was already cleared. Print a new copy from the app instead.');
      error.code = 'PRINT_JOB_PAYLOAD_MISSING';
      throw error;
    }
    return patchJob(job, { status: 'queued', attempts: 0, error: null, nextAttemptAt: null });
  }

  function counts() {
    const result = { queued: 0, printing: 0, printed: 0, failed: 0, uncertain: 0, total: 0 };
    for (const job of jobs.values()) {
      if (result[job.status] !== undefined) result[job.status] += 1;
      result.total += 1;
    }
    return result;
  }

  function list({ status = null, limit = 100 } = {}) {
    const items = [...jobs.values()]
      .filter((job) => !status || job.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Number(limit) || 100))
      .map(publicJob);
    return items;
  }

  function get(id) {
    const job = jobs.get(String(id || ''));
    return job ? publicJob(job) : null;
  }

  function getInternal(id) {
    return jobs.get(String(id || '')) || null;
  }

  /** Drops old history so the service runs for months without disk maintenance. */
  function prune() {
    const cutoff = now() - Math.max(0, Number(retentionMs) || 0);
    let removed = 0;
    for (const [id, job] of [...jobs.entries()]) {
      const finished = job.status === 'printed' || job.status === 'failed';
      if (finished && (job.updatedAt || job.createdAt) < cutoff) {
        jobs.delete(id);
        if (job.idempotencyKey && keyIndex.get(job.idempotencyKey) === id) keyIndex.delete(job.idempotencyKey);
        removed += 1;
      }
    }
    if (jobs.size > maxRecords) {
      const removable = [...jobs.values()]
        .filter((job) => job.status === 'printed' || job.status === 'failed')
        .sort((a, b) => a.updatedAt - b.updatedAt);
      while (jobs.size > maxRecords && removable.length) {
        const job = removable.shift();
        jobs.delete(job.id);
        if (job.idempotencyKey && keyIndex.get(job.idempotencyKey) === job.id) keyIndex.delete(job.idempotencyKey);
        removed += 1;
      }
    }
    if (removed) compact();
    return removed;
  }

  function close() {
    if (closed) return;
    closed = true;
    if (handle !== null) {
      try { fs.closeSync(handle); } catch (_) { /* ignore */ }
      handle = null;
    }
  }

  load();

  // Anything still marked `printing` was interrupted by a stop, crash or power
  // cut. There is no honest way to know whether paper came out, so record that
  // and never resend it automatically.
  for (const job of jobs.values()) {
    if (job.status !== 'printing') continue;
    patchJob(job, {
      status: 'uncertain',
      error: {
        code: 'AGENT_RESTARTED_DURING_PRINT',
        message: 'The print agent stopped while this job was being sent, so it may or may not have printed. Check the paper, then reprint from the printer queue if it is missing.',
        at: now(),
      },
    });
    recoveredCount += 1;
  }

  if (recoveredCount) warn('recovered print jobs interrupted by a restart', { count: recoveredCount });
  if (eventCount > JOURNAL_COMPACT_AFTER) compact();
  info('print queue loaded', { dir, jobs: jobs.size, recovered: recoveredCount });

  return {
    dir,
    recoveredCount,
    enqueue,
    markAttempt,
    markPrinted,
    markFailed,
    markUncertain,
    scheduleRetry,
    nextQueued,
    failExhausted,
    requeue,
    counts,
    list,
    get,
    getInternal,
    prune,
    compact,
    close,
    get size() { return jobs.size; },
  };
}
