/**
 * Turns the property's recent print jobs into per-printer health that a
 * receptionist can act on: did this printer work in the last week, is it
 * failing now, and what did the last failure actually say.
 *
 * Pure functions only, so the wording and the thresholds are testable without
 * a browser, a printer or Supabase. The query itself lives in
 * `printerHistory.js`.
 */

export const HISTORY_WINDOW_DAYS = 7;
export const HISTORY_MAX_JOBS = 200;

const DAY_MS = 86400000;
const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

const timestamp = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
};

export function historyWindowStart(now = new Date(), days = HISTORY_WINDOW_DAYS) {
  const time = now instanceof Date ? now.getTime() : Date.parse(now);
  const base = Number.isFinite(time) ? time : Date.now();
  return new Date(base - Math.max(1, Number(days) || HISTORY_WINDOW_DAYS) * DAY_MS);
}

export function jobStatusLabel(status) {
  if (status === 'printed') return 'Printed';
  if (status === 'failed') return 'Did not print';
  if (status === 'printing') return 'Printing';
  if (status === 'queued') return 'Waiting';
  if (status === 'cancelled') return 'Cancelled';
  return 'Unknown';
}

export function jobTone(status) {
  if (status === 'printed') return 'ok';
  if (status === 'failed') return 'danger';
  if (status === 'queued' || status === 'printing') return 'warning';
  return 'idle';
}

/** A printer error is one readable line: no stack traces, no embedded newlines. */
export function tidyError(message, limit = 160) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const max = Math.max(20, Number(limit) || 160);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function groupJobsByPrinter(jobs = []) {
  const grouped = {};
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job?.printer_id) continue;
    (grouped[job.printer_id] ||= []).push(job);
  }
  return grouped;
}

export function recentPrinterJobs(jobs = [], limit = 5) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job && job.id)
    .sort((a, b) => (timestamp(b.created_at) || 0) - (timestamp(a.created_at) || 0))
    .slice(0, Math.max(1, Number(limit) || 5));
}

/**
 * @param {Array<object>} jobs rows from `fnb_print_jobs` for one printer
 * @returns {{
 *   tone:'ok'|'warning'|'danger'|'idle', headline:string, detail:string,
 *   counts:{printed:number,failed:number,waiting:number}, decided:number,
 *   successRate:number|null, streak:number, lastPrintedAt:string|null,
 *   lastFailureAt:string|null, lastError:string, windowDays:number,
 *   since:string, total:number
 * }}
 */
export function summarizePrinterHistory(jobs = [], { now = new Date(), days = HISTORY_WINDOW_DAYS } = {}) {
  const windowDays = Math.max(1, Number(days) || HISTORY_WINDOW_DAYS);
  const sinceMs = historyWindowStart(now, windowDays).getTime();
  const recent = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => {
      const created = timestamp(job?.created_at);
      return created !== null && created >= sinceMs;
    })
    .sort((a, b) => (timestamp(b.created_at) || 0) - (timestamp(a.created_at) || 0));

  const counts = { printed: 0, failed: 0, waiting: 0 };
  let lastPrintedAt = null;
  let lastFailureAt = null;
  let lastError = '';

  for (const job of recent) {
    if (job.status === 'printed') {
      counts.printed += 1;
      if (!lastPrintedAt) lastPrintedAt = job.printed_at || job.created_at;
    } else if (job.status === 'failed') {
      counts.failed += 1;
      if (!lastFailureAt) {
        lastFailureAt = job.created_at;
        lastError = tidyError(job.error_message);
      }
    } else if (job.status === 'queued' || job.status === 'printing') {
      counts.waiting += 1;
    }
  }

  const decided = counts.printed + counts.failed;
  const successRate = decided ? Math.round((counts.printed / decided) * 100) : null;

  // Newest-first: a run of failures at the top means the printer is broken now,
  // not that it had a bad afternoon three days ago.
  let streak = 0;
  for (const job of recent) {
    if (job.status === 'failed') streak += 1;
    else if (job.status === 'printed') break;
  }

  let tone;
  let headline;
  let detail;

  if (!decided && !counts.waiting) {
    tone = 'idle';
    headline = `No print jobs in the last ${windowDays} days.`;
    detail = 'Jobs appear here after the first ticket is sent to this printer.';
  } else if (streak >= 2 || (decided >= 3 && counts.failed > counts.printed)) {
    tone = 'danger';
    headline = streak >= 2
      ? `${plural(streak, 'job')} in a row did not print.`
      : `${counts.failed} of ${decided} jobs did not print.`;
    detail = lastError || 'Check the printer is switched on and on the network, then reprint.';
  } else if (counts.failed || counts.waiting) {
    tone = 'warning';
    headline = counts.failed
      ? `${plural(counts.failed, 'job')} did not print in the last ${windowDays} days.`
      : `${plural(counts.waiting, 'job')} waiting to print.`;
    detail = lastError || (counts.waiting
      ? 'The agent is sending it now.'
      : 'Everything else printed. Reprint the missing one if the guest is waiting.');
  } else {
    tone = 'ok';
    headline = `All ${plural(decided, 'job')} printed in the last ${windowDays} days.`;
    detail = '';
  }

  return {
    tone,
    headline,
    detail,
    counts,
    decided,
    successRate,
    streak,
    lastPrintedAt,
    lastFailureAt,
    lastError,
    windowDays,
    since: historyWindowStart(now, windowDays).toISOString(),
    total: recent.length,
  };
}

/** Per-printer summaries plus a small tally for the page header. */
export function summarizeAllPrinters(printers = [], jobs = [], options = {}) {
  const byPrinter = groupJobsByPrinter(jobs);
  const summaries = {};
  const totals = { ok: 0, warning: 0, danger: 0, idle: 0 };

  for (const printer of Array.isArray(printers) ? printers : []) {
    if (!printer?.id) continue;
    const summary = summarizePrinterHistory(byPrinter[printer.id] || [], options);
    summaries[printer.id] = summary;
    totals[summary.tone] += 1;
  }

  return { byPrinter, summaries, totals, attention: totals.warning + totals.danger };
}
