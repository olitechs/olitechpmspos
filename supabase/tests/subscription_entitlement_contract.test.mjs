import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Subscription entitlement engine contract (Phase 2).
//
// Pins the security-critical properties of the single entitlement evaluator:
// the stored 'active' subscription status must never override elapsed dates,
// all states must be derivable from database values only, and every new
// permission surface stays revoked from anon/public.

const engine = readFileSync(
  new URL('../migrations/20261117180000_subscription_entitlement_engine.sql', import.meta.url),
  'utf8',
);

test('the entitlement engine exists as a single evaluator with self-resolution', () => {
  assert.match(engine, /function public\.fn_property_entitlement\(p_property_id uuid default null\)/i);
  assert.match(engine, /select pu\.property_id into p_property_id[\s\S]*?from public\.property_users pu[\s\S]*?where pu\.user_id = auth\.uid\(\)/i);
  assert.match(engine, /raise exception 'Not authorized';/);
});

test("an 'active' stored status can never override elapsed dates", () => {
  // The old rule (0042 / 20261012160000) granted access purely from status.
  // The engine must gate the active branch on the actual period end.
  assert.doesNotMatch(
    engine,
    /if p\.status='active' and p\.package<>'none' and s\.status='active' then\s*\n\s*allowed:=true;/i,
  );
  assert.match(engine, /elsif s\.current_period_ends_at >= now\(\) then/i);
  assert.match(engine, /elsif s\.grace_ends_at is not null and s\.grace_ends_at >= now\(\) then/i);
  // Elapsed period with no usable grace lands in the expired state.
  assert.match(engine, /v_state := 'expired';/i);
});

test('all required entitlement states are produced by the engine', () => {
  for (const state of [
    'platform_owner', 'trial', 'active', 'expiring_soon', 'grace_period',
    'expired', 'suspended', 'cancelled', 'manually_extended', 'no_subscription', 'pending',
  ]) {
    assert.match(engine, new RegExp(`'${state}'`), `state ${state}`);
  }
  assert.match(engine, /if s\.current_period_ends_at < now\(\) \+ interval '7 days' then/i);
  assert.match(engine, /v_state := 'manually_extended';/);
});

test('legacy rows without expiry keep working but are flagged, never auto-suspended', () => {
  assert.match(engine, /add column if not exists manual_extension_until timestamptz/i);
  assert.match(engine, /v_missing_expiry := true;/);
  // The engine never writes to property_subscriptions (read-only evaluator).
  assert.doesNotMatch(
    engine.slice(engine.indexOf('fn_property_entitlement'), engine.indexOf('fn_get_my_subscription_entitlement')),
    /insert into public\.property_subscriptions/i,
  );
});

test('subscription access delegates the date decision to the engine', () => {
  assert.match(engine, /v_ent := public\.fn_property_entitlement\(p_property_id\);/);
  assert.match(engine, /allowed := coalesce\(\(v_ent ->> 'allowed'\)::boolean, false\);/);
  // Module normalization and the dashboard exception are preserved.
  assert.match(engine, /when 'pos_devices' then 'store'/);
  assert.match(engine, /if allowed and v_entitlement_module='dashboard' then/i);
  assert.match(engine, /'entitlement_state',v_ent ->> 'state'/);
});

test('the operational gate raises for blocked properties and exempts platform admins', () => {
  assert.match(engine, /function public\.fn_assert_property_operational\(p_property_id uuid\)/i);
  assert.match(engine, /if public\.is_platform_owner\(\) then\s*\n\s*return;\s*\n\s*end if;/i);
  assert.match(engine, /Property operations are blocked: subscription state is %\./i);
});

test('manual extensions are audited platform-only decisions with a reason', () => {
  assert.match(
    engine,
    /p_manual_extension_until timestamptz default null,\s*\r?\n\s*p_override_reason text default null/i,
  );
  assert.match(engine, /length\(btrim\(p_override_reason\)\) < 10/i);
  assert.match(engine, /'manual_extension',\s*\r?\n\s*'platform_admin'/i);
  assert.match(engine, /'override_reason', p_override_reason/);
});

test('impossible date combinations are rejected on new writes', () => {
  assert.match(engine, /Trial end date cannot be after the subscription period end\./i);
  assert.match(engine, /Grace period must end on or after the subscription period end\./i);
});

test('new functions are granted to authenticated and revoked from anon and public', () => {
  for (const fn of [
    'fn_property_entitlement\\(uuid\\)',
    'fn_get_my_subscription_entitlement\\(\\)',
    'fn_assert_property_operational\\(uuid\\)',
    'fn_subscription_access\\(uuid,text\\)',
  ]) {
    assert.match(engine, new RegExp(`grant execute on function public\\.${fn} to authenticated;`, 'i'), fn);
    assert.match(engine, new RegExp(`revoke execute on function public\\.${fn} from anon, public;`, 'i'), fn);
  }
  assert.match(engine, /notify pgrst,'reload schema';/i);
});
