import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/20261104180000_phase3_pos_folio_room_planner_hardening.sql', import.meta.url), 'utf8');
const posIntegration = await readFile(new URL('../migrations/20261008041101_phase3_pos_pms_integration.sql', import.meta.url), 'utf8');
const splitPayments = await readFile(new URL('../migrations/20261008071500_phase3_split_payments_and_indexes.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
const planner = await readFile(new URL('../../src/components/pms/RoomPlanner.jsx', import.meta.url), 'utf8');
const billPayment = await readFile(new URL('../../src/components/pos/BillPayment.jsx', import.meta.url), 'utf8');

test('room-charge validation locks the reservation and rejects cross-property or checked-out stays', () => {
  assert.match(migration, /where r\.id = new\.reservation_id\s+for update/i);
  assert.match(migration, /v_property_id is distinct from new\.property_id/i);
  assert.match(migration, /v_status <> 'checked-in'/i);
  assert.match(migration, /before insert or update of property_id, reservation_id, source/i);
});

test('existing POS RPC keeps receipt idempotency and creates folio charges only for room tender', () => {
  assert.match(posIntegration, /create unique index if not exists pos_receipts_property_idempotency_key_uidx/i);
  assert.match(posIntegration, /if p_payment_method='room' then/i);
  assert.match(posIntegration, /insert into public\.folio_charges/i);
  assert.match(splitPayments, /create unique index if not exists pos_receipts_property_idempotency_key_uidx/i);
  assert.match(splitPayments, /if p_method='room' then|if v_method='room' then/i);
});

test('receipt and folio charge retain reciprocal references in the existing ledger', () => {
  assert.match(migration, /new\.folio_charge_id is not null/i);
  assert.match(migration, /where id = new\.folio_charge_id\s+and property_id = new\.property_id\s+and reservation_id = new\.reservation_id\s+and source = 'pos'/i);
  assert.match(migration, /POS receipt /i);
  assert.match(service, /async listReceiptsForReservation\(reservationId\)/);
});

test('room planner folio can display saved itemised POS receipt data without changing calendar layout', () => {
  assert.match(planner, /pmsService\.getFolio\(rv\.id\)/);
  assert.match(planner, /listReceiptsForReservation/);
  assert.match(planner, /items/);
  assert.match(planner, /folio_charge_id/);
});

test('POS room charge picker preserves room metadata, supports searching, and confirms the guest', () => {
  assert.match(service, /room_number: row\.room_number/);
  assert.match(billPayment, /filteredStays=activeStays\.filter/);
  assert.match(billPayment, /Search guest, room or reservation/);
  assert.match(billPayment, /window\.confirm\('Confirm room charge/);
  assert.match(billPayment, /paymentMethod==='room'\?chargeReservationId:null/);
  assert.match(billPayment, /p_payment_method/);
});
