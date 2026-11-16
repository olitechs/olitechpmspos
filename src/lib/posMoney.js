// POS money display helpers.
//
// The POS shows amounts in three places (the running ticket, the bill table and
// the settlement totals). They must read the same way, so formatting lives here
// instead of being repeated as inline toLocaleString() calls.
//
// Storage stays in integer minor units (see src/lib/money.js); this module only
// formats already-converted amounts.

const KES_FORMAT = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// "1,234.50" - for columns that carry the currency in their heading.
export function formatAmount(value) {
  const amount = Number(value);
  return KES_FORMAT.format(Number.isFinite(amount) ? amount : 0);
}

// "KES 1,234.50" - for totals, confirmations and free-standing sentences.
export function formatKes(value) {
  return `KES ${formatAmount(value)}`;
}
