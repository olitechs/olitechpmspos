// Interprets what the local print agent reported about one print.
//
// The agent distinguishes three kinds of bad news, and they must not be
// collapsed into "failed":
//   - failed:    nothing reached the printer, so reprinting is safe.
//   - uncertain: bytes may already be on paper. Reprinting without checking
//                gives the guest two copies.
//   - pending:   the agent already has this job queued or printing (a duplicate
//                submit). It is not a failure and must not be recorded as one.
//
// Pure on purpose: the callers write this to the cloud job row, and the tests
// pin the mapping without a printer or a database.

export function classifyAgentPrintOutcome(result = {}) {
  if (result?.ok) return 'printed';
  const code = String(result?.code || '');
  if (code === 'PRINT_OUTCOME_UNCERTAIN' || result?.status === 'uncertain') return 'uncertain';
  if (code === 'PRINT_JOB_IN_PROGRESS' || result?.status === 'printing' || result?.status === 'queued') return 'pending';
  return 'failed';
}

/** The cloud job status that matches an outcome. */
export function durableJobStatus(outcome) {
  if (outcome === 'printed') return 'printed';
  if (outcome === 'uncertain') return 'uncertain';
  if (outcome === 'pending') return 'printing';
  return 'failed';
}

/**
 * Whether a result says the printer connection itself is broken. An uncertain
 * job proves the printer received something, and a pending one is still with
 * the agent, so neither may flip the printer to offline.
 */
export function outcomeAffectsConnection(outcome) {
  return outcome === 'failed';
}

/**
 * Collapses several copies/slips into one honest answer for a cashier dialog.
 * "ok" keeps its strict meaning (every copy printed), so callers that gate a
 * retry on it cannot claim a failure when paper may already exist.
 */
export function summarizePrintOutcomes(results = []) {
  const list = (Array.isArray(results) ? results : []).filter(Boolean);
  const counts = { printed: 0, uncertain: 0, pending: 0, failed: 0 };
  for (const result of list) {
    const outcome = result.outcome || classifyAgentPrintOutcome(result);
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
  const total = list.length;
  const outcome = counts.uncertain ? 'uncertain'
    : counts.failed ? 'failed'
      : counts.pending ? 'pending'
        : total ? 'printed' : 'failed';
  const noun = total === 1 ? 'copy' : 'copies';
  return {
    total,
    ...counts,
    outcome,
    ok: total > 0 && counts.printed === total,
    needsPaperCheck: counts.uncertain > 0,
    message: counts.uncertain
      ? `${counts.uncertain} of ${total} ${noun} may already have printed. Check the paper before reprinting.`
      : counts.failed
        ? `${counts.failed} of ${total} ${noun} did not print.`
        : total ? 'Everything printed.' : 'Nothing was sent to a printer.',
  };
}

/**
 * Chooses the copies still to send. A retry after a partial failure must not
 * send the copy that already came out; an explicit reprint (someone asked for
 * another copy) sends everything.
 */
export function copiesToPrint(copies = [], alreadyPrinted = [], { force = false } = {}) {
  const labels = Array.isArray(copies) ? copies : [];
  if (force) return [...labels];
  const done = new Set((Array.isArray(alreadyPrinted) ? alreadyPrinted : []).filter(Boolean));
  return labels.filter((label) => !done.has(label));
}

export function printOutcomeMessage(outcome) {
  if (outcome === 'uncertain') return 'This job may already have printed. Check the paper before reprinting.';
  if (outcome === 'pending') return 'This job is still queued or printing at the agent.';
  return 'The printer did not accept this job.';
}
