// Cash-reconciliation policy for closing a POS shift.
//
// The tolerance used to be the literal 500 in the close-shift dialog. It is a
// property setting now, so a site with a different cash volume can raise or
// lower the amount that a cashier may close on without a manager PIN.

export const DEFAULT_CASH_VARIANCE_THRESHOLD = 500;

// Anything that is not a usable amount falls back to the default rather than
// silently turning every shift into a manager-approval case.
export function normalizeCashVarianceThreshold(value) {
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_CASH_VARIANCE_THRESHOLD;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return DEFAULT_CASH_VARIANCE_THRESHOLD;
  return amount;
}

export function requiresManagerApproval(variance, threshold) {
  return Math.abs(Number(variance) || 0) > normalizeCashVarianceThreshold(threshold);
}
