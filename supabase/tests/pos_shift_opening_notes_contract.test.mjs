import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/20261114100000_pos_shift_opening_notes.sql', import.meta.url),
  'utf8',
);
const service = readFileSync(new URL('../../src/services/shiftService.js', import.meta.url), 'utf8');
const component = readFileSync(new URL('../../src/components/pos/CloseShiftModal.jsx', import.meta.url), 'utf8');

test('opening-shift notes are persisted on cashier_shifts', () => {
  assert.match(migration, /ALTER TABLE public\.cashier_shifts\s*\n\s*ADD COLUMN IF NOT EXISTS opening_notes text;/);
  assert.match(migration, /INSERT INTO public\.cashier_shifts\(property_id, staff_id, opened_by, opening_float, opening_notes\)/);
  assert.match(migration, /NULLIF\(trim\(COALESCE\(p_notes, ''\)\), ''\)/);
});

test('the open-shift RPC keeps one signature and stays restricted to authenticated staff', () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.fn_open_cashier_shift\(uuid, numeric\);/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_open_cashier_shift\(\s*\n\s*p_property_id uuid,\s*\n\s*p_opening_float numeric DEFAULT 0,\s*\n\s*p_notes text DEFAULT NULL\s*\n\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_open_cashier_shift\(uuid, numeric, text\) TO authenticated;/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.fn_open_cashier_shift\(uuid, numeric, text\) TO (anon|public)/);
});

test('the migration keeps the previous cashier shift guards', () => {
  assert.match(migration, /You already have an open cashier shift\./);
  assert.match(migration, /Only authorised cashier staff can open a cashier shift\./);
  assert.match(migration, /public\.is_member_of_property\(p_property_id\)/);
});

test('the service forwards notes only when present, so pre-migration databases still open note-free shifts', () => {
  assert.match(service, /async openShift\(\{ propertyId, openingCash, notes = '' \}\)/);
  assert.match(service, /if \(openingNotes\) payload\.p_notes = openingNotes;/);
  assert.match(service, /supabase\.rpc\('fn_open_cashier_shift', payload\)/);
});

test('the open-shift dialog sends its notes and the closing summary shows them back', () => {
  assert.match(component, /const shift = await shiftService\.openShift\(\{ propertyId, openingCash: openingFloat, notes \}\);/);
  assert.match(component, /report\.shift\?\.opening_notes/);
});
