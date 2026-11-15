// Money helpers for the POS money path.
//
// Binary floating point cannot represent values such as 0.10 exactly, so adding
// line amounts and percentages in `Number` space can leave a tail like
// 0.30000000000000004. That tail is what used to reach the sale RPC, the VAT
// snapshot and the printed receipt.
//
// The rule here is: compute in integer minor units (cents), and convert back to
// a two-decimal `Number` only at the persistence/presentation boundary. The
// database columns are numeric(_,2), so a value built this way is exactly the
// value stored and printed.

export const MINOR_PER_UNIT = 100;

// Converts a shilling amount to integer minor units (cents).
// `toFixed(6)` first removes the binary tail (1.005 * 100 evaluates to
// 100.49999999999999) without inventing precision the caller did not supply.
export function toMinor(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(Number((amount * MINOR_PER_UNIT).toFixed(6)));
}

// Converts integer minor units back to a two-decimal amount for storage/printing.
export function fromMinor(minor) {
  const amount = Number(minor);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount) / MINOR_PER_UNIT;
}

// Percentage of an amount held in minor units, e.g. 16% of KES 120.00.
export function percentOfMinor(minor, percent) {
  const amount = Number(minor);
  const rate = Number(percent);
  if (!Number.isFinite(amount) || !Number.isFinite(rate)) return 0;
  return Math.round((amount * rate) / 100);
}

// Tax already contained in a tax-inclusive amount, e.g. the VAT portion of a
// KES 116.00 inclusive bill at 16% (KES 16.00).
export function inclusiveTaxMinor(minor, percent) {
  const amount = Number(minor);
  const rate = Number(percent);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= -100) return 0;
  return Math.round((amount * rate) / (100 + rate));
}
