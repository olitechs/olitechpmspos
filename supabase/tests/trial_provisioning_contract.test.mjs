import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 7-day auto-trial contract.
//
// The trial is adapted to the existing property-scoped billing model:
// property_subscriptions stays the single source of truth and
// fn_property_entitlement stays the only access authority. This test pins the
// forward provisioning migration plus the presentation contract (banner,
// urgency, billing CTA, existing-package plan cards).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../migrations/20261128160000_trial_provisioning.sql');
const banner = read('../../src/components/subscription/TrialBanner.jsx');
const panel = read('../../src/components/admin/SubscriptionPanel.jsx');
const appShell = read('../../src/components/layout/AppShell.jsx');
const access = read('../../src/lib/subscriptionAccess.js');

test('approval provisions a 7-day Professional trial on the existing table', () => {
  assert.match(migration, /create or replace function public\.approve_property\(/i);
  assert.match(migration, /insert into public\.property_subscriptions\(/i);
  assert.match(migration, /now\(\) \+ interval '7 days'/i);
  assert.match(migration, /'trial'/i);
  assert.doesNotMatch(migration, /create table[^;]*subscriptions/i);
  assert.doesNotMatch(migration, /workspace_id/i);
  assert.doesNotMatch(migration, /subscription_status\s+as\s+enum/i);
});

test('re-approval preserves a live paid period or an unexpired trial', () => {
  assert.match(migration, /v_sub\.status in \('active', 'past_due'\)/i);
  assert.match(migration, /v_sub\.current_period_ends_at >= now\(\)/i);
  assert.match(migration, /v_sub\.status = 'trial'/i);
  assert.match(migration, /v_sub\.trial_ends_at >= now\(\)/i);
  assert.match(migration, /if v_preserve then/i);
  // Preserve branch must not clear paid dates.
  const preserveBranch = migration.match(/if v_preserve then([\s\S]*?)else/i)?.[1] || '';
  assert.match(preserveBranch, /update public\.property_subscriptions\s+set plan_code = v_plan,/i);
  assert.doesNotMatch(preserveBranch, /current_period_ends_at = null/i);
  assert.doesNotMatch(preserveBranch, /trial_ends_at = /i);
});

test('cancelled, suspended and expired rows are unlocked with a fresh trial', () => {
  const preservePredicate = migration.match(/v_preserve :=[\s\S]*?;/i)?.[0] || '';
  assert.doesNotMatch(preservePredicate, /'cancelled'/i);
  assert.doesNotMatch(preservePredicate, /'suspended'/i);
  assert.match(migration, /on conflict\(property_id\) do update set[\s\S]*?status = 'trial'/i);
  assert.match(migration, /trial_ends_at = excluded\.trial_ends_at/i);
  assert.match(migration, /current_period_ends_at = null/i);
});

test('the trial RPC is authenticated-only and forward-only', () => {
  assert.match(
    migration,
    /grant execute on function public\.approve_property\(uuid, public\.property_package\) to authenticated;/i,
  );
  assert.match(
    migration,
    /revoke execute on function public\.approve_property\(uuid, public\.property_package\) from anon, public;/i,
  );
  assert.doesNotMatch(migration, /\bdrop table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /update public\.property_subscriptions\s+set\s+status/i);
  assert.match(migration, /notify\s+pgrst\s*,\s*'reload schema';\s*$/i);
});

test('the trial banner is mounted in the app shell and driven by server data', () => {
  assert.match(appShell, /import TrialBanner from '@\/components\/subscription\/TrialBanner';/);
  assert.match(appShell, /<TopAppNav workspace=\{workspace\} \/>\s*\r?\n\s*<TrialBanner \/>/);
  assert.match(banner, /seconds_remaining/);
  assert.match(banner, /evaluated_at/);
  assert.match(banner, /trial_ends_at/);
});

test('the banner is hidden outside a trial and urgent under 48 hours', () => {
  assert.match(banner, /const URGENT_SECONDS = 48 \* 60 \* 60;/);
  assert.match(banner, /if \(!isTrial\) return null;/);
  assert.match(banner, /\['trial', 'expiring_soon'\]\.includes\(access\.state\)/);
  assert.match(banner, /const urgent = seconds <= URGENT_SECONDS;/);
  assert.match(banner, /danger-soft/);
  assert.match(banner, /warning-soft/);
});

test('the banner uses the approved countdown copy and billing CTA', () => {
  assert.match(banner, /Free Trial — /);
  assert.match(banner, /remaining/);
  assert.match(banner, /Trial expires in /);
  assert.match(banner, /Upgrade Now/);
  assert.match(banner, /Subscribe Now/);
});

test('the banner opens the request form for owners and admins only', () => {
  assert.match(banner, /<SubscriptionRequestModal/);
  assert.match(banner, /requestKind=\{urgent \? 'subscribe' : 'upgrade'\}/);
  assert.match(banner, /canManageBilling/);
  assert.match(banner, /'owner', 'admin'/);
  assert.doesNotMatch(banner, /<Link/);
});

test('the billing panel shows the approved current-plan preview', () => {
  assert.match(panel, /Billing &amp; Subscription/);
  assert.match(panel, /Current Plan/);
  assert.match(panel, /FREE TRIAL/);
  assert.match(panel, /Trial started/);
  assert.match(panel, /Trial ends/);
  assert.match(panel, /Days left/);
  assert.match(panel, /Hours left/);
  assert.match(panel, /Properties/);
  assert.match(panel, /TRIAL_DAYS=7;/);
  assert.match(panel, /of \{TRIAL_DAYS\} trial days used/);
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /View Plans/);
  assert.match(panel, /1 \/ \$\{TRIAL_PROPERTY_ALLOWANCE\}/);
});

test('the billing panel shows the approved four-plan grid and billing toggle', () => {
  assert.match(panel, /Available Plans/);
  assert.match(panel, /Billing Cycle:/);
  assert.match(panel, /Save 20%/);
  assert.match(panel, /PLAN_CARDS/);
  for (const plan of ['starter', 'standard', 'professional', 'enterprise']) {
    assert.match(panel, new RegExp(`id:'${plan}'`), `plan card ${plan}`);
  }
  assert.match(panel, /monthly:3500,annual:2800/);
  assert.match(panel, /monthly:7000,annual:5600/);
  assert.match(panel, /monthly:14000,annual:11200/);
  assert.match(panel, /properties:'Unlimited'/);
  assert.doesNotMatch(panel, /id:'premium'/);
});

test('subscription requests are submitted through the form to both support addresses', () => {
  assert.match(access, /SUBSCRIPTION_SUPPORT_EMAILS = \['info@olitechs\.co\.ke', 'olitechs2025@gmail\.com'\]/);
  assert.match(panel, /<SubscriptionRequestModal/);
  assert.match(panel, /Send subscription request/);
  assert.match(panel, /openRequest\('renewal',plan\)/);
  assert.match(panel, /openRequest\(currentPlan===card\.id\?'renewal':'upgrade',card\.id\)/);
  assert.doesNotMatch(panel, /subscriptionRenewalMailto/);
  assert.doesNotMatch(panel, /href=\{renewalHref/);
});
