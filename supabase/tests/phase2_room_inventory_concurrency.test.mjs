import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261101090000_phase2_room_inventory_concurrency.sql', import.meta.url),
  'utf8',
);

test('reservation writes serialize on a property-scoped transaction lock', () => {
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*?pms-room-inventory:/i);
  assert.match(migration, /security definer[\s\S]*?set search_path = pg_catalog, public[\s\S]*?set row_security = off/i);
});

test('reservation guard enforces half-open overlap for booked and checked-in stays', () => {
  assert.match(migration, /r\.status::text in \('booked', 'checked-in'\)/i);
  assert.match(migration, /r\.arrival < new\.departure[\s\S]*?new\.arrival < r\.departure/i);
  assert.match(migration, /r\.id is distinct from new\.id/i);
  assert.match(migration, /errcode = '23P01'/i);
});

test('reservation guard also rejects room closures without changing checked-out history', () => {
  assert.match(migration, /from public\.room_closures c[\s\S]*?c\.start_date < new\.departure[\s\S]*?new\.arrival < c\.end_date/i);
  assert.match(migration, /new\.status::text not in \('booked', 'checked-in'\)/i);
});

test('closure writes serialize with reservations and reject active-stay conflicts', () => {
  assert.match(migration, /create or replace function public\.fn_guard_room_closure_overlap/i);
  assert.match(migration, /r\.arrival < new\.end_date[\s\S]*?new\.start_date < r\.departure/i);
  assert.match(migration, /room_closures_reservation_overlap_guard[\s\S]*?before insert or update of property_id, room_id, start_date, end_date/i);
});

test('inventory guards are installed as triggers and are not exposed as client RPCs', () => {
  assert.match(migration, /reservations_room_inventory_overlap_guard[\s\S]*?before insert or update of property_id, room_id, arrival, departure, status/i);
  assert.match(migration, /revoke all on function public\.fn_guard_room_reservation_overlap\(\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.fn_guard_room_closure_overlap\(\) from public, anon, authenticated/i);
  assert.match(migration, /notify pgrst, 'reload schema'[\s\S]*?commit;\s*$/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\./i);
});
