import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Grace-period configuration and renewal contract (Phase 3).
//
// Pins: grace duration comes from platform configuration (never invented in
// code), grace always follows expiry, renewal is the single confirmed path
// that recomputes dates and restores access with a full audit trail.

const migration = readFileSync(
  new URL('../migrations/20261117181000_subscription_grace_config_and_renewal.sql', import.meta.url),
  'utf8',
);
const countdown = readFileSync(new URL('../../src/lib/subscriptionCountdown.js', import.meta.url), 'utf8');

test('grace configuration exists, is single-row and not directly writable by clients', () => {
  assert.match(migration, /create table if not exists public\.platform_grace_config/i);
  assert.match(migration, /id integer primary key default 1 check \(id = 1\)/i);
  assert.match(migration, /grace_days integer check \(grace_days is null or grace_days between 0 and 365\)/i);
  assert.match(migration, /revoke all on public\.platform_grace_config from anon, authenticated/i);
  assert.match(migration, /insert into public\.platform_grace_config \(id, grace_days\)\s*\r?\n\s*values \(1, null\)/i);
});

test('no grace duration is invented: unconfigured means no automatic grace', () => {
  assert.match(
    migration,
    /when p_period_end is null or public\.fn_configured_grace_days\(\) is null then null/i,
  );
  assert.match(migration, /p_period_end \+ make_interval\(days => public\.fn_configured_grace_days\(\)\)/i);
});

test('configuring the grace period is a platform-only, audited decision', () => {
  assert.match(migration, /function public\.platform_set_grace_period_days/i);
  assert.match(migration, /Only a platform owner can configure the grace period\./i);
  assert.match(migration, /Grace days must be between 0 and 365/i);
  assert.match(migration, /A reason of at least 10 characters is required\./i);
  assert.match(migration, /'platform_grace_config_updated'/i);
});

test('renewal is the confirmed path that fixes the dates and restores access', () => {
  assert.match(migration, /function public\.platform_renew_subscription/i);
  assert.match(migration, /Only a platform owner can renew subscriptions\./i);
  assert.match(migration, /The new period end must be in the future\./i);
  assert.match(migration, /A renewal note of at least 5 characters is required/i);
  // Renewal recomputes grace from configuration — never from stale values.
  // The VALUES clause derives grace from the configured duration and the
  // upsert takes that computed value, so both paths land on fresh dates.
  assert.match(migration, /public\.fn_default_grace_end\(p_new_period_end\)/i);
  assert.match(migration, /grace_ends_at = excluded\.grace_ends_at/i);
  assert.match(migration, /manual_extension_until = null/i);
  assert.match(migration, /status = 'active'/i);
  // Full audit + idempotent event.
  assert.match(migration, /'property_subscription_renewed'/i);
  assert.match(migration, /'subscription_renewed',\s*\r?\n\s*'platform_admin'/i);
  assert.match(migration, /on conflict \(provider, external_event_id\) do nothing/i);
  // Returns the recomputed entitlement so callers verify the result.
  assert.match(migration, /'entitlement', public\.fn_property_entitlement\(p_property_id\)/i);
});

test('presentation helpers use the shared Africa/Nairobi convention and never authorize', () => {
  assert.match(countdown, /import \{ PMS_TIME_ZONE \} from '@\/lib\/pmsDateUtils';/);
  assert.match(countdown, /timeZone: PMS_TIME_ZONE/);
  assert.match(countdown, /server is authoritative about expiry/i);
  // No browser-clock authorization: only presentation and tick scheduling.
  assert.doesNotMatch(countdown, /Date\.now\(\)\s*<|isAfter|isBefore/);
});

test('new functions are granted to authenticated and revoked from anon and public', () => {
  assert.match(migration, /grant execute on function public\.platform_set_grace_period_days\(integer, text\) to authenticated;/i);
  assert.match(migration, /revoke execute on function public\.platform_set_grace_period_days\(integer, text\) from anon, public;/i);
  assert.match(migration, /grant execute on function public\.platform_renew_subscription\(uuid, timestamptz, text\) to authenticated;/i);
  assert.match(migration, /revoke execute on function public\.platform_renew_subscription\(uuid, timestamptz, text\) from anon, public;/i);
  assert.match(migration, /notify pgrst,'reload schema';/i);
});
