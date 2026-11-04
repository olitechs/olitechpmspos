import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RoomPlanner.jsx', import.meta.url), 'utf8');

test('room planner defaults to a 15-day window centred around today', () => {
  assert.ok(source.includes('export const getRollingPlannerRange = (today) =>'));
  assert.ok(source.includes('from: dateKey(subDays(today, 2))'));
  assert.ok(source.includes('to: dateKey(addDays(today, 12))'));
  assert.ok(source.includes('useState(initialRange)'));
});

test('today action restores the same 15-day window and month mode clears custom dates', () => {
  assert.ok(source.includes('const { from, to } = getRollingPlannerRange(todayDate)'));
  assert.ok(source.includes('const switchView = (mode) => { setViewMode(mode); setRange(null)'));
  assert.ok(source.includes('eachDayOfInterval({ start, end: addDays(start, 14) })'));
});

test('custom date ranges remain bounded to 31 days and reject reversed dates', () => {
  assert.ok(source.includes("if (to < from) { setRangeError('End date must be on or after start date.');"));
  assert.ok(source.includes("if (days > 31) { setRangeError('Maximum visible range is 31 days.');"));
});

test('new reservation payment status uses the Room Planner legend and maps choices to recorded amounts', () => {
  assert.ok(source.includes('Payment status · Room Planner legend'));
  assert.ok(source.includes("['not_paid','partially_paid','fully_paid'].map(status=>"));
  assert.ok(source.includes("background:style.background,color:style.color"));
  assert.ok(source.includes("amountPaid:status==='not_paid'?0:status==='fully_paid'?total:partialAmount"));
  assert.ok(source.includes('To record a payment or change the actual amount received, use Guest Folio'));
});
