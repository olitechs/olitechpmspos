import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preflight = readFileSync(
  new URL('../../supabase/tests/phase7_1_wastage_production_parity_preflight.sql', import.meta.url),
  'utf8',
);

test('production parity preflight is read-only and checks the complete wastage RPC contract', () => {
  assert.match(preflight, /Safe to run against production/);
  assert.match(preflight, /20261120130000/);
  assert.match(preflight, /fn_submit_inventory_wastage/);
  assert.match(preflight, /fn_decide_inventory_wastage/);
  assert.match(preflight, /legacy_direct_post_revoked/);
  assert.match(preflight, /wastage_lifecycle_columns/);
  assert.match(preflight, /location_posting_context/);
  assert.match(preflight, /default_location_trigger_enabled/);
  assert.match(preflight, /wastage_direct_dml_revoked/);
  assert.match(preflight, /wastage_permissions_seeded/);
  assert.match(preflight, /SELECT check_name, passed, observed, expected/);
  assert.doesNotMatch(preflight, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\s+(?:INTO|TABLE|FUNCTION|SCHEMA|INDEX|ROLE|ON)?/i);
});
