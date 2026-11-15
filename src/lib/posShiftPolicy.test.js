import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CASH_VARIANCE_THRESHOLD, normalizeCashVarianceThreshold, requiresManagerApproval } from './posShiftPolicy.js';

test('a missing or unusable threshold falls back to the default', () => {
  assert.equal(normalizeCashVarianceThreshold(null), DEFAULT_CASH_VARIANCE_THRESHOLD);
  assert.equal(normalizeCashVarianceThreshold(undefined), DEFAULT_CASH_VARIANCE_THRESHOLD);
  assert.equal(normalizeCashVarianceThreshold(''), DEFAULT_CASH_VARIANCE_THRESHOLD);
  assert.equal(normalizeCashVarianceThreshold('not a number'), DEFAULT_CASH_VARIANCE_THRESHOLD);
  assert.equal(normalizeCashVarianceThreshold(-1), DEFAULT_CASH_VARIANCE_THRESHOLD);
});

test('a configured threshold is honoured, including zero', () => {
  assert.equal(normalizeCashVarianceThreshold('0'), 0);
  assert.equal(normalizeCashVarianceThreshold(1200.5), 1200.5);
  assert.equal(normalizeCashVarianceThreshold(250), 250);
});

test('manager approval is required only above the configured tolerance', () => {
  assert.equal(requiresManagerApproval(500, 500), false);
  assert.equal(requiresManagerApproval(-500, 500), false);
  assert.equal(requiresManagerApproval(500.01, 500), true);
  assert.equal(requiresManagerApproval(-1201, 1200), true);
  assert.equal(requiresManagerApproval(0, 0), false);
  assert.equal(requiresManagerApproval(1, 0), true);
});
