import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Subscription expiry reconciliation contract (Phase 5).
//
// Pins the scheduled half of subscription enforcement:
//   * only property_subscriptions.status is written (a renewal must restore
//     access, and an operator suspension must stay distinguishable),
//   * only rows with an explicit period end are actioned — missing expiries and
//     impossible grace configurations are reported, never invented or fixed,
//   * manual extensions and property-level states win,
//   * the run is idempotent, audited and event-logged,
//   * the schedule is best-effort: request-time enforcement never depends on
//     pg_cron existing.

const path = new URL(
  '../migrations/20261117190000_subscription_suspension_reconciliation.sql',
  import.meta.url,
);
const sql = readFileSync(path, 'utf8');
const flat = sql.replace(/\s+/g, ' ').trim();
const functionBody = flat.slice(
  flat.indexOf('create or replace function public.platform_reconcile_subscription_suspensions'),
  flat.indexOf('grant execute on function public.platform_reconcile_subscription_suspensions'),
);
const scheduleBlock = flat.slice(flat.indexOf('do $$', flat.indexOf('grant execute on function')));

test('the reconciler exists with a dry-run switch and is server-side only', () => {
  assert.match(functionBody, /p_dry_run boolean default false/i);
  assert.match(functionBody, /p_property_id uuid default null/i);
  assert.match(functionBody, /language plpgsql security definer set search_path = public/i);
  assert.match(
    flat,
    /grant execute on function public\.platform_reconcile_subscription_suspensions\(boolean, uuid\) to authenticated, service_role;/i,
  );
  assert.match(
    flat,
    /revoke execute on function public\.platform_reconcile_subscription_suspensions\(boolean, uuid\) from anon, public;/i,
  );
  assert.match(flat, /notify pgrst,'reload schema';/i);
});

test('only a platform owner (or a scheduled system caller) may run it', () => {
  assert.match(
    functionBody,
    /if auth\.uid\(\) is not null and not public\.is_platform_owner\(\) then raise exception 'Only a platform owner can reconcile subscription status\.'/i,
  );
  // A signed-in session always carries auth.uid(), so the system exemption is
  // unreachable from a browser request.
  assert.doesNotMatch(functionBody, /auth\.uid\(\) is null and/i);
  assert.match(functionBody, /if p_property_id is not null and not exists \(select 1 from public\.properties where id = p_property_id\) then raise exception 'Property not found\.'/i);
});

test('the only write is the subscription status — properties.status is never touched', () => {
  assert.match(functionBody, /update public\.property_subscriptions set status = 'suspended', updated_at = now\(\), updated_by = auth\.uid\(\)/i);
  assert.doesNotMatch(flat, /update public\.properties\b/i);
  assert.doesNotMatch(flat, /set status = 'suspended'[\s\S]{0,120}current_period_ends_at =/i);

  // Everything the subscription row needs to be renewable afterwards survives.
  const updateStatement = functionBody.slice(
    functionBody.indexOf("update public.property_subscriptions set status = 'suspended'"),
    functionBody.indexOf('insert into public.audit_logs'),
  );
  ['plan_code', 'trial_ends_at', 'current_period_ends_at', 'grace_ends_at', 'manual_extension_until', 'enabled_modules'].forEach((column) => {
    assert.ok(!updateStatement.includes(`${column} =`), `${column} must not be rewritten by the reconciler`);
  });
});

test('no business data is deleted, moved or archived', () => {
  assert.doesNotMatch(flat, /delete from/i);
  assert.doesNotMatch(flat, /truncate/i);
  assert.doesNotMatch(flat, /drop table/i);
});

test('only explicit paid periods are actioned; data gaps are reported instead', () => {
  // Explicit period end required — a null expiry is a data gap, not an expiry.
  assert.match(
    functionBody,
    /if v_row\.current_period_ends_at is null then[\s\S]*?'flag', 'missing_expiry'[\s\S]*?continue;/i,
  );
  assert.match(functionBody, /only rows with an explicit current_period_ends_at are actioned|no subscription expiry is configured/i);

  // Impossible grace configuration is reported, never silently repaired.
  assert.match(
    functionBody,
    /if v_row\.grace_ends_at is not null and v_row\.grace_ends_at < v_row\.current_period_ends_at then[\s\S]*?'flag', 'grace_invalid'[\s\S]*?continue;/i,
  );

  // No invented dates anywhere.
  assert.doesNotMatch(functionBody, /coalesce\(\s*v_row\.current_period_ends_at\s*,\s*now\(\)\s*\)/i);
  assert.doesNotMatch(functionBody, /current_period_ends_at\s*=\s*(now\(\)|current_date)/i);
});

test('manual extensions and property-level states win over elapsed dates', () => {
  const manualIndex = functionBody.indexOf('v_row.manual_extension_until is not null and v_row.manual_extension_until >= now()');
  const trialIndex = functionBody.indexOf("if v_row.status = 'trial' then");
  const missingExpiryIndex = functionBody.indexOf('if v_row.current_period_ends_at is null then');
  const actionIndex = functionBody.indexOf("update public.property_subscriptions set status = 'suspended'");
  assert.ok(manualIndex > 0 && manualIndex < actionIndex, 'a live manual extension must short-circuit before the write');
  assert.ok(trialIndex > 0 && trialIndex < actionIndex, 'trials are reported, not suspended');
  // A trial has a trial_ends_at, not a billing period end: it must be handled
  // before the missing-expiry check or every trial would be misreported.
  assert.ok(trialIndex < missingExpiryIndex, 'trials are classified before the missing-expiry gap check');
  assert.match(functionBody, /'flag', 'trial_missing_end'/i);
  assert.match(functionBody, /'flag', 'trial_expired'/i);
  assert.match(
    functionBody,
    /if v_row\.property_status is distinct from 'active' then[\s\S]*?'flag', 'property_not_active'[\s\S]*?continue;/i,
  );
  assert.match(functionBody, /if v_row\.status in \('suspended', 'cancelled'\) then continue;/i);
  assert.match(functionBody, /if v_row\.status not in \('active', 'past_due'\) then continue;/i);
  assert.match(functionBody, /if v_row\.current_period_ends_at >= now\(\) then continue;/i);
  assert.match(functionBody, /if v_row\.grace_ends_at is not null and v_row\.grace_ends_at >= now\(\) then continue;/i);
});

test('the run is idempotent, audited and event-logged', () => {
  assert.match(
    functionBody,
    /v_event_id := 'suspension_' \|\| v_row\.property_id::text \|\| '_' \|\| to_char\(v_row\.current_period_ends_at, 'YYYYMMDDHH24MISS'\)/i,
  );
  assert.match(functionBody, /'subscription_suspended', 'system_reconcile', v_event_id/i);
  assert.match(functionBody, /on conflict \(provider, external_event_id\) do nothing/i);
  assert.match(functionBody, /'property_subscription_suspended_expired'/i);
  assert.match(functionBody, /insert into public\.audit_logs\(actor_id, action, property_id, old_value, new_value\)/i);
});

test('a dry run reports what would happen without writing', () => {
  const dryRunIndex = functionBody.indexOf('if p_dry_run then continue;');
  const writeIndex = functionBody.indexOf("update public.property_subscriptions set status = 'suspended'");
  assert.ok(dryRunIndex > 0 && dryRunIndex < writeIndex, 'the dry-run exit must precede the write');
  assert.match(functionBody, /'action', case when p_dry_run then 'would_suspend' else 'suspended' end/i);
  assert.match(functionBody, /'dry_run', coalesce\(p_dry_run, false\)/i);
});

test('the hourly schedule is best-effort so request-time enforcement never depends on it', () => {
  assert.match(scheduleBlock, /if not exists \(select 1 from pg_available_extensions where name = 'pg_cron'\) then raise warning/i);
  assert.match(scheduleBlock, /exception when others then raise warning 'pg_cron could not be enabled/i);
  assert.match(scheduleBlock, /exception when others then raise warning 'subscription reconciliation could not be scheduled/i);
  assert.match(scheduleBlock, /'olitechs_subscription_reconcile'/i);
  assert.match(scheduleBlock, /'5 \* \* \* \*'/i);
  assert.match(scheduleBlock, /select cron\.schedule\(/i);
  assert.match(flat, /request-time enforcement never depends on this job|request-time enforcement never depends on it/i);
  // The scheduling block must never abort the migration.
  assert.doesNotMatch(scheduleBlock, /raise exception/i);
});
