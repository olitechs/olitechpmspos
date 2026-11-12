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

export function printOutcomeMessage(outcome) {
  if (outcome === 'uncertain') return 'This job may already have printed. Check the paper before reprinting.';
  if (outcome === 'pending') return 'This job is still queued or printing at the agent.';
  return 'The printer did not accept this job.';
}
