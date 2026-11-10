import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20261110190000_front_office_minibar_consumption.sql', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/pages/FrontOfficeMinibar.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

test('minibar posting uses one atomic stock and folio transaction', () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /fn_apply_stock_movement/);
  assert.match(migration, /insert into public\.folio_charges/);
  assert.match(migration, /status not in \('checked-in'\)/);
  assert.match(migration, /current_stock<p_quantity/);
  assert.match(migration, /property_id=p_property_id/);
  assert.match(migration, /revoke execute .* from public,anon/i);
  assert.match(migration, /grant execute .* to authenticated/i);
});

test('minibar page calls the authoritative RPC and scopes reads by property', () => {
  assert.match(page, /fn_post_minibar_consumption/);
  assert.match(page, /\.eq\('property_id',propertyId\)/);
  assert.match(page, /\.eq\('status','checked-in'\)/);
  assert.ok(app.includes('path="services/minibar" element={<FrontOfficeMinibar/>}'));
});
