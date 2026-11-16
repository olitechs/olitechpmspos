import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Rooms.jsx', import.meta.url), 'utf8');
const reservations = readFileSync(new URL('../modules/Reservations.jsx', import.meta.url), 'utf8');

test('the planner route renders only the calendar, full height', () => {
  assert.match(source, /\/\^\\\/frontoffice\\\/room-planner\\\/\?\$\/\.test\(pathname\)/);
  assert.ok(source.includes('h-[100dvh]'));
  const plannerIndex = source.indexOf('<RoomPlanner rooms={pms.rooms}');
  assert.ok(plannerIndex >= 0, 'planner route must mount RoomPlanner');
  assert.ok(!source.includes("t === 'planner'"), 'the internal planner tab state is gone');
});

test('the rooms route renders only Room Types & Setup with no tab bar', () => {
  const managementIndex = source.indexOf('<RoomManagement onChanged={pms.reload} />');
  assert.ok(managementIndex >= 0, 'rooms route must mount RoomManagement');
  assert.ok(!source.includes('Room operations'), 'the old tab-bar label is gone');
  assert.ok(!source.includes('RoomPanel'), 'the reservations-tab-only room panel import is gone');
  assert.ok(source.includes('usePms()'), 'PMS data still feeds both screens');
});

test('check-in and cancel-booking live on the routed Reservations page', () => {
  assert.ok(reservations.includes('pms.checkInReservation'), 'check-in stays reachable from Reservations');
  assert.ok(reservations.includes('pms.removeReservation'), 'cancel-booking stays reachable from Reservations');
});

test('removing a reservation asks for confirmation first (moved from the old Rooms tab)', () => {
  const confirmIndex = reservations.indexOf('window.confirm(');
  const removeIndex = reservations.indexOf('pms.removeReservation(r.id)');
  assert.ok(confirmIndex >= 0, 'the cancel action must be guarded by a confirmation');
  assert.ok(confirmIndex < removeIndex, 'confirmation must run before the removal');
  assert.ok(reservations.includes('The reservation will be marked cancelled'), 'the original confirm wording is preserved');
});
