import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../migrations/20261022180000_phase1_staff_session_expiry_scope.sql', import.meta.url),
  'utf8',
);
const regression = await readFile(
  new URL('./phase1_staff_session_security_regression.sql', import.meta.url),
  'utf8',
);

test('staff sessions use additive expiry, hard expiry, module scope, and revocation fields', () => {
  for (const column of ['module text', 'expires_at timestamptz', 'hard_expires_at timestamptz', 'revoked_at timestamptz']) {
    assert.ok(migration.includes(column), `missing session field: ${column}`);
  }
  assert.match(migration, /ADD COLUMN IF NOT EXISTS module text/);
  assert.match(migration, /now\(\) \+ interval '30 minutes'/);
  assert.match(migration, /now\(\) \+ interval '8 hours'/);
});

test('session refresh fails closed and cannot extend beyond hard expiry', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.touch_active_staff_session\(\)/);
  assert.match(migration, /IF auth\.uid\(\) IS NULL THEN\s+RETURN false/s);
  assert.match(migration, /ss\.expires_at > now\(\)/);
  assert.match(migration, /ss\.hard_expires_at > now\(\)/);
  assert.match(migration, /ss\.revoked_at IS NULL/);
  assert.match(migration, /LEAST\(now\(\) \+ interval '30 minutes', ss\.hard_expires_at\)/);
  assert.match(migration, /RETURN v_rows = 1/);
});

test('module authorization checks the selected active staff session and assigned module', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_staff_session_allows_module/);
  assert.match(migration, /lower\(ss\.module\) = lower\(trim\(coalesce\(p_module, ''\)\)\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_staff_module_access/);
  assert.match(migration, /IF NOT public\.fn_staff_session_allows_module\(p_property_id, v_module\) THEN\s+RETURN false/s);
  assert.match(migration, /s\.is_active IS TRUE/);
  assert.match(migration, /p\.status = 'active'/);
});

test('direct RLS staff-role policies are rewritten with module-specific guards', () => {
  assert.ok(migration.includes('DO $module_guard_policies
  for (const table of ['pos_shifts', 'pos_table_sessions', 'pos_kitchen_orders', 'stores', 'payments', 'folio_charges']) {
    assert.ok(migration.includes(`'${table}'`), `missing module policy mapping: ${table}`);
  }
  assert.match(regression, /direct staff-role RLS predicates are module guarded/);
});

test('PIN verification sets session module and bounded lifetime; clear revokes session', () => {
  assert.match(migration, /INSERT INTO public\.staff_sessions\s*\(user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at\)/);
  assert.match(migration, /module = EXCLUDED\.module/);
  assert.match(migration, /revoked_at = NULL/);
  assert.match(migration, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
});

test('SQL regression covers valid module, wrong module, expired, hard-expired, revoked, and no-session cases', () => {
  for (const phrase of [
    'valid session was rejected for its assigned module',
    'staff session was accepted for wrong module',
    'expired session still authorizes module access',
    'hard-expired session was refreshed',
    'revoked session still authorizes module access',
    'caller without a session received successful refresh',
    'ROLLBACK;',
  ]) {
    assert.ok(regression.includes(phrase), `missing SQL regression assertion: ${phrase}`);
  }
});
));
  assert.ok(migration.includes('regexp_replace('));
  for (const table of ['pos_shifts', 'pos_table_sessions', 'pos_kitchen_orders', 'stores', 'payments', 'folio_charges']) {
    assert.ok(migration.includes(`'${table}'`), `missing module policy mapping: ${table}`);
  }
  assert.match(regression, /direct staff-role RLS predicates are module guarded/);
});

test('PIN verification sets session module and bounded lifetime; clear revokes session', () => {
  assert.match(migration, /INSERT INTO public\.staff_sessions\s*\(user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at\)/);
  assert.match(migration, /module = EXCLUDED\.module/);
  assert.match(migration, /revoked_at = NULL/);
  assert.match(migration, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
});

test('SQL regression covers valid module, wrong module, expired, hard-expired, revoked, and no-session cases', () => {
  for (const phrase of [
    'valid session was rejected for its assigned module',
    'staff session was accepted for wrong module',
    'expired session still authorizes module access',
    'hard-expired session was refreshed',
    'revoked session still authorizes module access',
    'caller without a session received successful refresh',
    'ROLLBACK;',
  ]) {
    assert.ok(regression.includes(phrase), `missing SQL regression assertion: ${phrase}`);
  }
});
