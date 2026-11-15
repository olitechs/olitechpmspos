import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bill = readFileSync(new URL('./BillPayment.jsx', import.meta.url), 'utf8');

test('bill totals are derived from integer minor units before they are persisted', () => {
  assert.ok(bill.includes("import*as money from'@/lib/money';"));
  assert.ok(bill.includes('const subtotalMinor=useMemo('));
  assert.ok(bill.includes('const totalMinor='));
  assert.ok(bill.includes('discountAmount:discount'));
  // The old float arithmetic rounded at the very end, after the drift had
  // already accumulated; it must not come back.
  assert.ok(!bill.includes('Math.round(subtotal*100)'));
  assert.ok(!bill.includes('Math.round((discounted+vat)*100)'));
});

test('split allocations are compared and persisted in integer cents', () => {
  assert.ok(bill.includes('splitTotalMinor!==totalMinor'));
  assert.ok(bill.includes('amount:money.fromMinor(money.toMinor(p.amount))'));
});

test('the running ticket and the session total are normalised to two decimals', () => {
  const orderTaking = readFileSync(new URL('./OrderTaking.jsx', import.meta.url), 'utf8');
  const container = readFileSync(new URL('./POSContainer.jsx', import.meta.url), 'utf8');
  assert.ok(orderTaking.includes('fromMinor(toMinor(orderLines.reduce'));
  assert.ok(container.includes('fromMinor(toMinor(lines.reduce'));
});
