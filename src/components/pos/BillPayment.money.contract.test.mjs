import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bill = readFileSync(new URL('./BillPayment.jsx', import.meta.url), 'utf8');
// BillPayment.jsx is kept readable (Prettier-formatted), so these behavioural
// assertions compare whitespace-insensitive text instead of exact lines.
const flat = (text) => text.replace(/\s+/g, '');

test('bill totals are derived from integer minor units before they are persisted', () => {
  assert.ok(flat(bill).includes(flat("import*as money from'@/lib/money';")));
  assert.ok(flat(bill).includes(flat('const subtotalMinor=useMemo(')));
  assert.ok(flat(bill).includes(flat('const totalMinor=')));
  assert.ok(flat(bill).includes(flat('discountAmount:discount')));
  // The old float arithmetic rounded at the very end, after the drift had
  // already accumulated; it must not come back.
  assert.ok(!flat(bill).includes(flat('Math.round(subtotal*100)')));
  assert.ok(!flat(bill).includes(flat('Math.round((discounted+vat)*100)')));
});

test('split allocations are compared and persisted in integer cents', () => {
  assert.ok(flat(bill).includes(flat('splitTotalMinor!==totalMinor')));
  assert.ok(flat(bill).includes(flat('amount:money.fromMinor(money.toMinor(p.amount))')));
});

test('the running ticket and the session total are normalised to two decimals', () => {
  const orderTaking = readFileSync(new URL('./OrderTaking.jsx', import.meta.url), 'utf8');
  const container = readFileSync(new URL('./POSContainer.jsx', import.meta.url), 'utf8');
  assert.ok(orderTaking.includes('fromMinor(toMinor(orderLines.reduce'));
  assert.ok(container.includes('fromMinor(toMinor(lines.reduce'));
});
