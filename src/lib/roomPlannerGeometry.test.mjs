import test from 'node:test';
import assert from 'node:assert/strict';
import { getStayBarGeometry, getPastStayOpacity, getPaymentStatusFromAmounts } from './roomPlannerGeometry.js';

test('check-in and check-out both use mid-day boundaries', () => {
  assert.deepEqual(getStayBarGeometry({ startIndex: 2, span: 3, dayWidth: 56, roomColumnWidth: 225 }), {
    left: 2 * 56 + 225 + 28, width: 3 * 56, continuesBefore: false, continuesAfter: false,
  });
});

test('clipped stays align to the visible edge and show continuation metadata', () => {
  assert.deepEqual(getStayBarGeometry({ startIndex: 0, span: 4, dayWidth: 56, roomColumnWidth: 225, continuesBefore: true, continuesAfter: true }), {
    left: 225, width: 4 * 56, continuesBefore: true, continuesAfter: true,
  });
});

test('adjacent stays meet at mid-day without overlap', () => {
  const first = getStayBarGeometry({ startIndex: 0, span: 2, dayWidth: 56, roomColumnWidth: 225 });
  const second = getStayBarGeometry({ startIndex: 2, span: 1, dayWidth: 56, roomColumnWidth: 225 });
  assert.equal(first.left + first.width, second.left);
});

test('past stays fade the fill layer only, not their text', () => {
  assert.equal(getPastStayOpacity('2026-11-07', '2026-11-08'), 0.55);
  assert.equal(getPastStayOpacity('2026-11-09', '2026-11-08'), 1);
});

test('payment status is derived from amounts', () => {
  assert.equal(getPaymentStatusFromAmounts(0, 100), 'not_paid');
  assert.equal(getPaymentStatusFromAmounts(25, 100), 'partially_paid');
  assert.equal(getPaymentStatusFromAmounts(100, 100), 'fully_paid');
});
