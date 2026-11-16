import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, formatKes } from './posMoney.js';

test('POS amounts always render with two decimals and thousands separators', () => {
  assert.equal(formatAmount(0), '0.00');
  assert.equal(formatAmount(7.5), '7.50');
  assert.equal(formatAmount(1234.5), '1,234.50');
  assert.equal(formatAmount(1234567.891), '1,234,567.89');
  // The ticket previously printed 1234.5 as "1,234.5" and 1234 as "1,234",
  // so the same column mixed one, two and three decimal places.
  assert.equal(formatAmount(1234), '1,234.00');
});

test('invalid amounts fall back to zero instead of NaN on the ticket', () => {
  assert.equal(formatAmount(undefined), '0.00');
  assert.equal(formatAmount(null), '0.00');
  assert.equal(formatAmount(''), '0.00');
  assert.equal(formatAmount('not a number'), '0.00');
  assert.equal(formatAmount(Number.NaN), '0.00');
});

test('only totals and sentences carry the currency prefix', () => {
  assert.equal(formatKes(0), 'KES 0.00');
  assert.equal(formatKes(2500), 'KES 2,500.00');
  assert.ok(!formatAmount(2500).includes('KES'));
});
