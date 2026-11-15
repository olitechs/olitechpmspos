import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, fromMinor, percentOfMinor, inclusiveTaxMinor } from './money.js';

test('amounts round-trip through integer minor units without a float tail', () => {
  assert.equal(fromMinor(toMinor(0.1) + toMinor(0.2)), 0.3);
  assert.equal(toMinor(19.99) * 3, 5997);
  assert.equal(fromMinor(toMinor(19.99) * 3), 59.97);
  assert.equal(fromMinor(toMinor(1.005)), 1.01);
  assert.equal(fromMinor(toMinor('500')), 500);
});

test('invalid or empty input is treated as zero rather than NaN', () => {
  assert.equal(toMinor(''), 0);
  assert.equal(toMinor(null), 0);
  assert.equal(toMinor(undefined), 0);
  assert.equal(toMinor('not a number'), 0);
  assert.equal(fromMinor(Number.NaN), 0);
});

test('VAT is computed on minor units for both tax modes', () => {
  assert.equal(percentOfMinor(10000, 16), 1600);
  assert.equal(fromMinor(percentOfMinor(toMinor(1250.5), 16)), 200.08);
  assert.equal(inclusiveTaxMinor(11600, 16), 1600);
  assert.equal(fromMinor(inclusiveTaxMinor(toMinor(1160), 16)), 160);
});

test('a zero or invalid rate produces no tax instead of NaN', () => {
  assert.equal(percentOfMinor(10000, 0), 0);
  assert.equal(percentOfMinor(10000, 'x'), 0);
  assert.equal(inclusiveTaxMinor(10000, -100), 0);
});
