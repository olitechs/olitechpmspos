import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const design = await read('docs/architecture/PHASE-1-FOUNDATION-SECURITY-DESIGN.md');
const reconciliation = await read('docs/audits/PHASE-1-RECONCILIATION-REGISTER-20261019.md');
const migration = await read('supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql');
const authService = await read('src/services/authService.js');

test('Phase 1 design documents fail-closed tenant authorization and server-side enforcement', () => {
  for (const required of [
    'auth.uid()',
    'property membership',
    'RLS policy pattern',
    'SECURITY DEFINER review checklist',
    'Service/query boundaries',
    'Audit logging contract',
    'Offline-sync foundation',
    'server must deduplicate by idempotency key',
  ]) {
    assert.ok(design.toLowerCase().includes(required.toLowerCase()), `missing design contract: ${required}`);
  }
  assert.match(design, /Current disposition:.*authorization design specified/is);
});

test('Phase 0 provenance and production security drift remain explicit blockers', () => {
  for (const version of [
    '20261003114200',
    '20261003114849',
    '20261003114909',
    '20261008022614',
    '20261008023412',
    '20261008042951',
  ]) {
    assert.ok(reconciliation.includes(version), `missing unresolved migration ledger entry: ${version}`);
  }
  assert.match(reconciliation, /BLOCKED FOR DATABASE ROLLOUT/);
  assert.match(reconciliation, /Do not infer applied/);
});

test('tracked RPC remediation binds pending-property creation to the caller', () => {
  for (const required of [
    'p_user_id IS DISTINCT FROM v_actor_id',
    'public.is_member_of_property(p_property_id)',
    'public.current_staff_role(p_property_id) IS NOT NULL',
    's.enabled IS TRUE',
    "p.status = 'active'",
    'REVOKE ALL ON FUNCTION public.fn_list_pos_menu(uuid) FROM PUBLIC, anon',
    'REVOKE ALL ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text) FROM PUBLIC, anon',
  ]) {
    assert.ok(migration.includes(required), `missing RPC security guard: ${required}`);
  }
});

test('PIN helpers reject weak formats and do not use Math.random as a fallback', () => {
  assert.ok(authService.includes('PIN length must be between 4 and 6 digits'));
  assert.ok(authService.includes('Secure PIN generation is not available in this browser'));
  assert.ok(authService.includes('Secure PIN hashing is not available in this browser'));
  assert.equal(authService.includes('Math.random()'), false);
});
