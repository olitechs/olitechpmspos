import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_SUPPORT_EMAILS,
  evaluateSubscriptionAccess,
  isSubscriptionBlockedForUser,
  isSubscriptionLockout,
  subscriptionRenewalMailto,
} from './subscriptionAccess.js';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const elapsed = '2026-11-27T10:00:00Z';
const future = '2026-12-27T10:00:00Z';

function user({ entitlement = null, subscription = null, property = { id: 'p1', name: 'Test Hotel', status: 'active', package: 'enterprise' } } = {}) {
  return { property, subscription, entitlement, propertyRole: 'owner' };
}

test('stored active cannot override elapsed entitlement dates', () => {
  const result = evaluateSubscriptionAccess(user({
    entitlement: {
      state: 'active',
      allowed: true,
      subscription_status: 'active',
      period_ends_at: elapsed,
      grace_ends_at: elapsed,
    },
  }), NOW);

  assert.equal(result.blocked, true);
  assert.equal(result.state, 'expired');
  assert.equal(result.source, 'server_dates');
  assert.equal(result.reason, 'explicit_billing_dates_elapsed');
  assert.equal(isSubscriptionBlockedForUser(user({
    entitlement: {
      state: 'active',
      allowed: true,
      subscription_status: 'active',
      period_ends_at: elapsed,
      grace_ends_at: elapsed,
    },
  })), true);
});

test('elapsed server-exposed dates fail closed even when entitlement RPC is missing', () => {
  const result = evaluateSubscriptionAccess(user({
    subscription: {
      status: 'active',
      current_period_ends_at: elapsed,
      grace_ends_at: elapsed,
    },
  }), NOW);

  assert.equal(result.blocked, true);
  assert.equal(result.state, 'expired');
  assert.equal(result.source, 'subscription_dates');
  assert.equal(isSubscriptionLockout(user({
    subscription: {
      status: 'active',
      current_period_ends_at: elapsed,
      grace_ends_at: elapsed,
    },
  })), true);
});

test('a verification outage only blocks when explicit dates have elapsed', () => {
  const unavailable = { state: 'unavailable', allowed: false, reason: 'entitlement_unavailable' };

  const expired = evaluateSubscriptionAccess(user({
    entitlement: unavailable,
    subscription: { status: 'active', current_period_ends_at: elapsed, grace_ends_at: elapsed },
  }), NOW);
  assert.equal(expired.blocked, true);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.source, 'subscription_dates');

  const noDates = evaluateSubscriptionAccess(user({
    entitlement: unavailable,
    subscription: { status: 'active', current_period_ends_at: null, grace_ends_at: null },
  }), NOW);
  assert.equal(noDates.blocked, false);
  assert.equal(noDates.source, 'legacy_missing_expiry');
  assert.equal(isSubscriptionLockout(user({
    entitlement: unavailable,
    subscription: { status: 'active', current_period_ends_at: null, grace_ends_at: null },
  })), false);

  const validDates = evaluateSubscriptionAccess(user({
    entitlement: unavailable,
    subscription: { status: 'active', current_period_ends_at: future, grace_ends_at: null },
  }), NOW);
  assert.equal(validDates.blocked, false);
  assert.equal(validDates.source, 'subscription_dates');
});

test('valid active periods, configured grace and manual extensions remain allowed', () => {
  const active = evaluateSubscriptionAccess(user({
    entitlement: { state: 'active', allowed: true, period_ends_at: future, grace_ends_at: null },
  }), NOW);
  assert.equal(active.blocked, false);
  assert.equal(active.state, 'active');

  const grace = evaluateSubscriptionAccess(user({
    entitlement: { state: 'grace_period', allowed: true, period_ends_at: elapsed, grace_ends_at: future },
  }), NOW);
  assert.equal(grace.blocked, false);
  assert.equal(grace.state, 'grace_period');

  const manual = evaluateSubscriptionAccess(user({
    subscription: {
      status: 'expired',
      current_period_ends_at: elapsed,
      grace_ends_at: elapsed,
      manual_extension_until: future,
    },
  }), NOW);
  assert.equal(manual.blocked, false);
  assert.equal(manual.state, 'manually_extended');
});

test('a stale manually_extended label cannot bypass elapsed dates', () => {
  const result = evaluateSubscriptionAccess(user({
    entitlement: {
      state: 'manually_extended',
      allowed: true,
      subscription_status: 'active',
      period_ends_at: elapsed,
      grace_ends_at: elapsed,
      manual_extension_until: elapsed,
    },
  }), NOW);

  assert.equal(result.blocked, true);
  assert.equal(result.state, 'expired');
  assert.equal(result.source, 'server_dates');
});

test('pending and onboarding properties stay on the approval screen', () => {
  const pendingUser = user({
    property: { id: 'p2', name: 'Pending Hotel', status: 'pending', package: 'none' },
    entitlement: { state: 'pending', allowed: false, reason: 'property_pending' },
  });
  const result = evaluateSubscriptionAccess(pendingUser, NOW);
  assert.equal(result.blocked, true);
  assert.equal(result.state, 'pending');
  assert.equal(isSubscriptionLockout(pendingUser), false);

  const noProperty = { entitlement: { state: 'no_property', allowed: false }, propertyRole: null };
  assert.equal(isSubscriptionBlockedForUser(noProperty), true);
  assert.equal(isSubscriptionLockout(noProperty), false);
});

test('suspended and cancelled states are lockout states', () => {
  for (const state of ['suspended', 'cancelled']) {
    const current = user({ entitlement: { state, allowed: false } });
    assert.equal(evaluateSubscriptionAccess(current, NOW).blocked, true);
    assert.equal(isSubscriptionLockout(current), true);
  }
});

test('legacy approved properties without explicit dates keep existing behavior', () => {
  const result = evaluateSubscriptionAccess(user({
    subscription: { status: 'active', current_period_ends_at: null, grace_ends_at: null },
  }), NOW);
  assert.equal(result.blocked, false);
  assert.equal(result.source, 'legacy_missing_expiry');
  assert.equal(result.missingExpiry, true);
  assert.equal(isSubscriptionLockout(user({
    subscription: { status: 'active', current_period_ends_at: null, grace_ends_at: null },
  })), false);
});

test('renewal mailto addresses both OliTechs inboxes with property context', () => {
  const href = subscriptionRenewalMailto({
    propertyName: 'Test Hotel',
    propertyId: 'p1',
    packageName: 'enterprise',
    state: 'expired',
    periodEndsAt: 'Nov 27, 2026',
    graceEndsAt: 'Nov 27, 2026',
  });

  assert.deepEqual(SUBSCRIPTION_SUPPORT_EMAILS, ['info@olitechs.co.ke', 'olitechs2025@gmail.com']);
  assert.ok(href.startsWith(`mailto:${SUBSCRIPTION_SUPPORT_EMAILS.join(',')}?`));
  assert.match(href, /subject=Subscribe%20or%20renew%20OliTechs%20subscription/);
  assert.match(href, /Test%20Hotel/);
  assert.match(href, /p1/);
  assert.match(href, /enterprise/);
});
