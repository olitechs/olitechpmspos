import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./RoomPlanner.jsx', import.meta.url), 'utf8');

test('room planner defaults to a 15-day window centred around today', () => {
  assert.match(source, /export const getRollingPlannerRange = \\(today\\) =>/);
  assert.match(source, /from: dateKey\\(subDays\\(today, 2\\)\\)/);
  assert.match(source, /to: dateKey\\(addDays\\(today, 12\\)\\)/);
  assert.match(source, /useState\\(initialRange\\)/);
});

test('today action restores the same 15-day window and month mode clears custom dates', () => {
  assert.match(source, /const \\{ from, to \\} = getRollingPlannerRange\\(todayDate\\)/);
  assert.match(source, /const switchView = \\(mode\\) => \\{ setViewMode\\(mode\\); setRange\\(null\\)/);
  assert.match(source, /eachDayOfInterval\\(\\{ start, end: addDays\\(start, 14\\) \\}\\)/);
});

test('custom date ranges remain bounded to 31 days and reject reversed dates', () => {
  assert.match(source, /if \\(to < from\\) \\{ setRangeError\\('End date must be on or after start date\\.'/);
  assert.match(source, /if \\(days > 31\\) \\{ setRangeError\\('Maximum visible range is 31 days\\.'/);
});
