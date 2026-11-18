import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Signup & ownership client-alignment contract (upgrade pack Task 2).
//
// The live database hardening (20261109065637) made ownership claims
// server-enforced. This pins the CLIENT half: signup must rely on the server
// flow (auth trigger + idempotent ensure RPC), and no client code may insert
// into property_users or mutate property status/package directly.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const authService = readFileSync(join(root, 'src/services/authService.js'), 'utf8');
const hardening = readFileSync(
  join(root, 'supabase/migrations/20261109065637_harden_property_signup_and_ownership.sql'),
  'utf8',
);

function collectSource(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      collectSource(p, out);
    } else if (/\.(jsx?|mjs)$/.test(entry) && !/\.test\.(jsx?|mjs)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

test('signup creates the pending property on the server, never from the browser', () => {
  assert.match(authService, /supabase\.auth\.signUp\(/);
  assert.match(authService, /pending_owner_signup: true/);
  assert.match(authService, /pending_business_name/);
  // No session yet: explicitly no insert happens from the anonymous browser.
  assert.match(authService, /nothing to insert from this anonymous browser request/);
  // With a session: idempotent server RPC repairs partial deployments only.
  assert.match(authService, /ensure_my_pending_property/);
  assert.doesNotMatch(
    authService.slice(authService.indexOf('async register('), authService.indexOf('async login(') > 0 ? authService.indexOf('async login(') : undefined),
    /\.from\('property_users'\)[\s\S]{0,80}\.insert\(/,
  );
});

test('no client code inserts into property_users', () => {
  const offenders = [];
  for (const file of collectSource(join(root, 'src'))) {
    const s = readFileSync(file, 'utf8');
    if (/\.from\('property_users'\)[\s\S]{0,120}\.(insert|upsert)\(/.test(s)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'property_users writes must go through server RPCs/policies');
});

test('no client code writes property status or package directly', () => {
  const offenders = [];
  for (const file of collectSource(join(root, 'src'))) {
    const s = readFileSync(file, 'utf8');
    if (/\.from\('properties'\)[\s\S]{0,120}\.(insert|update|upsert)\(/.test(s)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'property status/package changes must go through platform RPCs');
});

test('live-DB hardening objects are pinned in version control', () => {
  // Self-claim: only your own created property, only while it has no owner.
  assert.match(hardening, /function public\.can_self_claim_owner\(p_property_id uuid\)/i);
  assert.match(hardening, /p\.id = p_property_id and p\.created_by = auth\.uid\(\)/);
  assert.match(hardening, /and not exists \(select 1 from public\.property_users pu\s*\r?\n\s*where pu\.property_id = p_property_id and pu\.role = 'owner'\)/);
  // Insert policy: platform owner, the property's owner/admin, or the
  // constrained self-claim path.
  assert.match(hardening, /public\.is_platform_owner\(\)\s*\r?\n\s*or public\.property_role\(property_id\) in \('owner','admin'\)/i);
  assert.match(hardening, /user_id = \(select auth\.uid\(\)\) and role = 'owner'\s*\r?\n\s*and public\.can_self_claim_owner\(property_id\)/i);
  // Internal provisioning functions are not client-executable.
  assert.match(hardening, /revoke execute on function public\.create_pending_property_for_user\(uuid,text,text,text\) from public, anon, authenticated;/i);
  assert.match(hardening, /revoke execute on function public\.handle_new_user\(\) from public, anon, authenticated;/i);
  // status/package guard trigger + owner/admin update policy.
  assert.match(hardening, /Only a platform owner can change status or package\./i);
  assert.match(hardening, /create trigger trg_guard_property_status_package\s*\r?\n\s*before update on public\.properties/i);
  assert.match(hardening, /create policy properties_update_owner_admin on public\.properties for update/i);
});
