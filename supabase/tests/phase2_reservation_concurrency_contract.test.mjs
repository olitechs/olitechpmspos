import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261104100000_phase2_reservation_concurrency_hardening.sql', import.meta.url),
  'utf8',
);

test('availability serializes checks by property and room before conflict reads', () => {
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*?p_property_id::text\s*\|\|\s*':'\s*\|\|\s*p_room_id::text/i);
  assert.ok(migration.indexOf('pg_advisory_xact_lock') < migration.indexOf('from public.reservations r'));
  assert.match(migration, /r\.arrival < p_departure\s+and p_arrival < r\.departure/i);
  assert.match(migration, /r\.status in \('booked','checked-in'\)/i);
});

test('check-in locks the reservation before status validation and mutation', () => {
  const start = migration.indexOf('create or replace function public.fn_check_in_reservation');
  const checkin = migration.slice(start);
  assert.match(checkin, /where r\.id = p_reservation_id[\s\S]*?for update;/i);
  assert.ok(checkin.indexOf('for update;') < checkin.indexOf("if v_res.status <> 'booked'"));
  assert.ok(checkin.indexOf("if v_res.status <> 'booked'") < checkin.indexOf("set status = 'checked-in'"));
});

test('migration narrows RPC execution grants and is transaction-bounded', () => {
  assert.match(migration, /revoke execute on function public\.fn_check_room_availability\(uuid,uuid,date,date,uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.fn_check_room_availability\(uuid,uuid,date,date,uuid\) to authenticated, service_role/i);
  assert.match(migration, /begin;[\s\S]*commit;\s*$/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.(reservations|payments|folio_charges)/i);
});

test('same-day turnover remains allowed by half-open date overlap logic', () => {
  assert.match(migration, /r\.arrival < p_departure\s+and p_arrival < r\.departure/i);
});

const walkInMigration = await readFile(
  new URL('../migrations/20261104120000_phase2_walk_in_concurrency_hardening.sql', import.meta.url),
  'utf8',
);

test('walk-in check-in shares the serialized availability guard', () => {
  const start = walkInMigration.indexOf('create or replace function public.fn_walk_in_check_in');
  const walkIn = walkInMigration.slice(start);
  assert.match(walkIn, /fn_check_room_availability\([\s\S]*?p_property_id, p_room_id, p_check_in, p_check_out, null/i);
  assert.ok(walkIn.indexOf('fn_check_room_availability') < walkIn.indexOf('insert into public.reservations'));
  assert.match(walkIn, /status = 'available'/i);
  assert.match(walkInMigration, /begin;[\s\S]*commit;\s*$/i);
});
