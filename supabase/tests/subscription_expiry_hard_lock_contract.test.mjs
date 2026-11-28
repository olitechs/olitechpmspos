import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Forward-only hard-lock contract.
//
// Pins the corrective migration independently from the original Phase 2/4
// migrations. It must reassert the canonical server-authoritative evaluator,
// expose it only to authenticated sessions, and reinstall operational write
// guards without editing or renumbering applied migration files.

const migration = readFileSync(
  new URL('../migrations/20261128150000_subscription_expiry_hard_lock.sql', import.meta.url),
  'utf8',
);

test('the forward migration reasserts one date-aware entitlement evaluator', () => {
  assert.match(migration, /alter table public\.property_subscriptions\s+add column if not exists manual_extension_until timestamptz/i);
  assert.match(migration, /function public\.fn_property_entitlement\(p_property_id uuid default null\)/i);
  assert.match(migration, /elsif s\.current_period_ends_at >= now\(\) then/i);
  assert.match(migration, /elsif s\.grace_ends_at is not null and s\.grace_ends_at >= now\(\) then/i);
  assert.match(migration, /v_state := 'expired';/i);
  assert.doesNotMatch(
    migration,
    /if p\.status='active' and p\.package<>'none' and s\.status='active' then\s*\n\s*allowed:=true;/i,
  );

  for (const state of [
    'platform_owner', 'trial', 'active', 'expiring_soon', 'grace_period',
    'expired', 'suspended', 'cancelled', 'manually_extended', 'no_subscription', 'pending',
  ]) {
    assert.match(migration, new RegExp(`'${state}'`), `state ${state}`);
  }
});

test('module access and the operational gate consume the computed entitlement', () => {
  assert.match(migration, /function public\.fn_get_my_subscription_entitlement\(\)/i);
  assert.match(migration, /select public\.fn_property_entitlement\(null\);/i);
  assert.match(migration, /function public\.fn_assert_property_operational\(p_property_id uuid\)/i);
  assert.match(migration, /if coalesce\(\(v_ent ->> 'allowed'\)::boolean, false\) is not true then/i);
  assert.match(migration, /Property operations are blocked: subscription state is %\./i);
  assert.match(migration, /v_ent := public\.fn_property_entitlement\(p_property_id\);/i);
  assert.match(migration, /allowed := coalesce\(\(v_ent ->> 'allowed'\)::boolean, false\);/i);
  assert.match(migration, /'entitlement_state',v_ent ->> 'state'/i);
});

test('reasserted RPCs are authenticated-only and anon/public are revoked', () => {
  for (const fn of [
    'fn_property_entitlement\\(uuid\\)',
    'fn_get_my_subscription_entitlement\\(\\)',
    'fn_assert_property_operational\\(uuid\\)',
    'fn_subscription_access\\(uuid,text\\)',
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn} to authenticated;`, 'i'), fn);
    assert.match(migration, new RegExp(`revoke execute on function public\\.${fn} from anon, public;`, 'i'), fn);
  }
  assert.match(migration, /revoke execute on function public\.fn_assert_property_row_operational\(\) from anon, public;/i);
});

test('the forward migration reinstalls operational row guards', () => {
  assert.match(migration, /function public\.fn_assert_property_row_operational\(\)/i);
  assert.match(migration, /perform public\.fn_assert_property_operational\(v_property_id\)/i);
  assert.match(migration, /if auth\.uid\(\) is null then\s*\r?\n\s*return coalesce\(NEW, OLD\);/i);

  for (const table of [
    'reservations', 'folio_charges', 'payments', 'night_audits',
    'pos_receipts', 'pos_shifts', 'cashier_shifts',
    'stock_movements', 'purchase_orders', 'inventory_productions',
  ]) {
    assert.match(migration, new RegExp(`'${table}'`), `operational table ${table} must be guarded`);
  }
  assert.match(migration, /before insert or update or delete/i);
  assert.match(migration, /trg_assert_operational/);

  for (const table of ['staff', 'audit_logs', 'property_subscriptions', 'properties', 'subscription_events']) {
    assert.doesNotMatch(migration, new RegExp(`'${table}'`), `${table} must not be write-guarded`);
  }
});

test('the migration is forward-only and reloads the schema cache last', () => {
  assert.doesNotMatch(migration, /\bdrop table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /update public\.property_subscriptions\s+set\s+status/i);
  assert.match(migration, /notify\s+pgrst\s*,\s*'reload schema';\s*$/i);
});
