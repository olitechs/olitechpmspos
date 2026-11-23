import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pms = readFileSync(new URL('./pmsService.js', import.meta.url), 'utf8');
const shifts = readFileSync(new URL('./shiftService.js', import.meta.url), 'utf8');
const bill = readFileSync(new URL('../components/pos/BillPayment.jsx', import.meta.url), 'utf8');

test('POS payment shift lookup matches the property-wide active shift source', () => {
  const start = pms.indexOf('async getOpenCashierShift(propertyId)');
  const end = pms.indexOf('\n\tasync openCashierShift', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const lookup = pms.slice(start, end);
  assert.match(lookup, /\.eq\('property_id', propertyId\)/);
  assert.match(lookup, /\.eq\('status', 'open'\)/);
  assert.match(lookup, /\.order\('opened_at', \{ ascending: false \}\)/);
  assert.doesNotMatch(lookup, /opened_by|auth\.getUser/);

  const currentStart = shifts.indexOf('async getCurrentShift(propertyId)');
  const currentEnd = shifts.indexOf('\n  },', currentStart);
  const currentLookup = shifts.slice(currentStart, currentEnd);
  assert.match(currentLookup, /\.eq\('property_id', propertyId\)/);
  assert.match(currentLookup, /\.eq\('status', 'open'\)/);
  assert.doesNotMatch(currentLookup, /opened_by/);
});

test('POS bill settlement uses the shared property shift and keeps the no-shift guard', () => {
  assert.match(bill, /pmsService\.getOpenCashierShift\(propertyId\)/);
  assert.match(bill, /No open POS shift\. Open a shift before taking payments\./);
  assert.match(bill, /shiftId: currentShift\.id/);
});
