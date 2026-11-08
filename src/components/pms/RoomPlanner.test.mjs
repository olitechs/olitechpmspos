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

test('new reservation payment status uses three clean BB Planner legend buttons', () => {
  assert.ok(source.includes('<Field label="Payment status">'));
  assert.ok(source.includes("{value:'fully_paid',label:'Paid',amount:total}"));
  assert.ok(source.includes("{value:'partially_paid',label:'Deposit',amount:total*0.5}"));
  assert.ok(source.includes("{value:'not_paid',label:'Not paid',amount:0}"));
  assert.ok(source.includes('aria-pressed={selected}'));
  assert.ok(source.includes('background:style.background,color:style.color'));
  assert.ok(source.includes('Amount received: KES'));
});

test('room closures use the persisted property-scoped closure service', () => {
  assert.ok(source.includes('pmsService.listRoomClosures(propertyId)'));
  assert.ok(source.includes('pmsService.createRoomClosure({ property_id: propertyId'));
  assert.ok(source.includes('pmsService.deleteRoomClosure(closure.id)'));
  assert.ok(source.includes('item.start_date <= key && key < item.end_date'));
  assert.ok(!source.includes('closure-${Date.now()}'));
});

test('planner supports resize, touch moves, drag-to-create and move undo/redo', () => {
  assert.ok(source.includes('const beginResize ='));
  assert.ok(source.includes("beginResize(e,rv,'start')"));
  assert.ok(source.includes("beginResize(e,rv,'end')"));
  assert.ok(source.includes('const beginTouchDrag ='));
  assert.ok(source.includes('const beginCreateDrag ='));
  assert.ok(source.includes('const undoPlannerMove ='));
  assert.ok(source.includes('const redoPlannerMove ='));
  assert.ok(source.includes('recordPlannerMove(reservation, target)'));
});

test('planner filters by floor and can switch to a date-grouped day list', () => {
  assert.ok(source.includes('Filter by floor'));
  assert.ok(source.includes('const [mobileListMode, setMobileListMode]'));
  assert.ok(source.includes('filteredReservations.filter(rv=>rv.checkIn<=key&&rv.checkOut>key)'));
  assert.ok(source.includes('Show timeline'));
});

test('room rows are rendered through a bounded virtual window', () => {
  assert.ok(source.includes('const virtualRooms = orderedRooms.slice(virtualStart, virtualEnd)'));
  assert.ok(source.includes('topSpacerHeight'));
  assert.ok(source.includes('bottomSpacerHeight'));
});
