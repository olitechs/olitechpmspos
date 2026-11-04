import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/20261104150000_phase1_reservation_registration.sql', import.meta.url), 'utf8');
const screen = await readFile(new URL('../../src/components/modules/Reservations.jsx', import.meta.url), 'utf8');
const service = await readFile(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../../src/data/PmsStore.jsx', import.meta.url), 'utf8');

test('reservation metadata migration is additive and keeps the legacy RPC intact', () => {
  assert.match(migration, /add column if not exists alternative_phone/i);
  assert.match(migration, /add column if not exists booking_details/i);
  assert.match(migration, /reservation-submit:/i);
  assert.match(migration, /booking_details->>'submissionId'/i);
  assert.match(migration, /rate_plans rp[\s\S]*?rp\.property_id = p_property_id and rp\.active = true/i);
  assert.match(migration, /guest-email:/i);
  assert.match(migration, /lower\(trim\(g\.email\)\) = v_email/i);
  assert.match(migration, /different guest profiles/i);
  assert.match(migration, /returning \* into v_res/i);
  assert.match(migration, /fn_record_front_desk_payment/i);
  assert.match(migration, /payment_status = 'not_paid'[\s\S]*?fn_record_front_desk_payment/i);
  assert.match(migration, /create or replace function public\.fn_create_reservation_bundle\([\s\S]*?p_details jsonb/i);
  assert.match(migration, /public\.fn_create_reservation_bundle\([\s\S]*?p_arrival, p_departure[\s\S]*?p_notes\s*\n\s*\)/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.(reservations|guests|payments|folio_charges)/i);
});

test('availability guard retains serialization and blocks unavailable operational rooms', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_property_id::text \|\| ':' \|\| p_room_id::text, 0\)\)/i);
  assert.match(migration, /v_room_status in \('maintenance','out_of_service','blocked'\)/i);
  assert.ok(migration.indexOf('pg_advisory_xact_lock') < migration.indexOf('from public.reservations r'));
  assert.match(migration, /return query select r\.\* from public\.reservations r[\s\S]*?booking_details->>'submissionId'/i);
  assert.match(migration, /room_closures[\s\S]*?start_date < p_departure and p_arrival < c\.end_date/i);
});

test('reservation form captures guest, stay, multi-room, booking and financial details', () => {
  for (const field of ['alternativePhone', 'residenceCountry', 'idType', 'kidsAges', 'roomIds', 'arrivalTime', 'departureTime', 'ratePlanId', 'externalReference', 'groupReference', 'services', 'discount', 'tax', 'depositMethod', 'specialRequests']) {
    assert.ok(screen.includes(field), `Expected reservation form to include ${field}`);
  }
  assert.match(screen, /booking: \{ submissionId, ratePlanId: data\.ratePlanId \|\| null/i);
  assert.match(screen, /Save & register another/i);
  assert.match(screen, /crypto\.randomUUID\(\)/);
  assert.match(screen, /Departure must be after arrival/i);
  assert.match(screen, /deposit of at least 50%/i);
});

test('PMS service forwards extended metadata through the overloaded transactional RPC', () => {
  assert.match(service, /p_details: details \|\| \{\}/);
  assert.match(service, /async listRatePlans\(propertyId\)/);
  assert.match(store, /roomIds: data\.roomIds\?\.length \? data\.roomIds : \[data\.roomId\]/);
  assert.match(store, /details: data\.details \|\| \{\}/);
});
