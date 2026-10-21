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
    assert.ok(migration.includes(column), 'missing session field: ' + column);
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
  assert.match(migration, /IF NOT public\.fn_subscription_module_allowed\(p_property_id, v_module\) THEN\s+RETURN false/s);
});

test('direct RLS staff-role policies are rewritten with module-specific guards', () => {
  assert.ok(migration.includes('DO $module_guard_policies$'));
  assert.ok(migration.includes('regexp_replace('));
  for (const table of ['pos_shifts', 'pos_table_sessions', 'pos_kitchen_orders', 'stores', 'payments', 'folio_charges']) {
    assert.ok(migration.includes("'" + table + "'"), 'missing module policy mapping: ' + table);
  }
  assert.match(regression, /direct staff-role RLS predicates are module guarded/);
});

test('subscription access evaluation is read-only and preserves status/module rules', () => {
  const start = migration.indexOf('create or replace function public.fn_subscription_access');
  const end = migration.indexOf('DO $module_guard_policies$', start);
  assert.ok(start >= 0 && end > start, 'subscription access function must be present before RLS policy guards');
  const subscriptionFunction = migration.slice(start, end);
  assert.equal(subscriptionFunction.includes('insert into public.property_subscriptions'), false);
  assert.match(subscriptionFunction, /subscription_not_configured/);
  assert.match(subscriptionFunction, /s\.status\s*=\s*'trial'/);
  assert.match(subscriptionFunction, /s\.status\s*=\s*'past_due'/);
  assert.match(subscriptionFunction, /grace_ends_at/);
  assert.match(subscriptionFunction, /v_entitlement_module/);
  assert.match(regression, /subscription access evaluation has no provisioning side effect/);
});

test('high-risk RPCs enforce tenant, module, booking-state, and least-privilege guards', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.fn_public_booking_engine_config/);
  assert.match(migration, /s\\.enabled IS TRUE/);
  assert.match(migration, /p\\.status = 'active'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.fn_list_pos_menu/);
  assert.match(migration, /public\\.fn_staff_module_access\\(p_property_id, 'pos'\\) IS TRUE/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.fn_current_pos_shift/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\\.create_pending_property_for_user\\(uuid, text, text, text\\)\\s+FROM PUBLIC, anon, authenticated/s);
  assert.match(regression, /POS menu and shift RPCs enforce property\\/module authorization/);
  assert.match(regression, /low-level property creation helper is not directly executable/);
  assert.match(regression, /public booking config requires enabled engine/);
  assert.match(regression, /inactive property booking config denied/);
});

test('PIN verification sets session module and bounded lifetime; clear revokes session', () => {
  assert.match(migration, /INSERT INTO public\.staff_sessions\s*\(user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at\)/);
  assert.match(migration, /module = EXCLUDED\.module/);
  assert.match(migration, /revoked_at = NULL/);
  assert.match(migration, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
});

test('SQL regression covers session and subscription denial cases with rollback', () => {
  for (const phrase of [
    'valid session was rejected for its assigned module',
    'staff session was accepted for wrong module',
    'staff session crossed into another property',
    'changed staff module assignment invalidates the session',
    'email/property membership retains only its assigned module scope',
    'expired session still authorizes module access',
    'hard-expired session was refreshed',
    'revoked session still authorizes module access',
    'caller without a session received successful refresh',
    'direct staff-role RLS predicates are module guarded',
    'subscription access evaluation has no provisioning side effect',
    'POS menu and shift RPCs enforce property/module authorization',
    'low-level property creation helper is not directly executable',
    'public booking config requires enabled engine',
    'inactive property booking config denied',
    'valid trial access preserved',
    'expired trial remains denied',
    'past-due grace period preserved',
    'suspended grace period preserved',
    'cancelled subscription remains denied',
    'ROLLBACK;',
  ]) {
    assert.ok(regression.includes(phrase), 'missing SQL regression assertion: ' + phrase);
  }
});
