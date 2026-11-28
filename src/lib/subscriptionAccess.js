// Subscription access resolution.
//
// The database entitlement is authoritative. This module only converts the
// server response into a UI decision. It also contains a deliberately narrow
// fail-closed fallback for older deployments where the entitlement RPC is
// missing: if the property already exposes explicit billing dates and every
// cutoff has elapsed, the workspace is blocked instead of staying open on a
// stale stored `active` status. A property with no dates at all keeps the
// established legacy behaviour so a schema-cache blip cannot lock every
// hotel out at once.

export const SUBSCRIPTION_SUPPORT_EMAILS = ['info@olitechs.co.ke', 'olitechs2025@gmail.com'];

const ALLOWED_STATES = new Set([
  'platform_owner', 'trial', 'active', 'expiring_soon', 'grace_period', 'manually_extended',
]);
const BLOCKED_STATES = new Set([
  'no_property', 'no_subscription', 'pending', 'expired', 'suspended', 'cancelled',
]);

function normaliseState(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function result({ blocked, state, source, reason, periodEndsAt = null, graceEndsAt = null, manualExtensionUntil = null, missingExpiry = false }) {
  return {
    blocked,
    allowed: !blocked,
    state,
    source,
    reason: reason || state,
    periodEndsAt,
    graceEndsAt,
    manualExtensionUntil,
    missingExpiry,
  };
}

function propertyState(user, entitlement) {
  return normaliseState(firstValue(
    entitlement?.property_status,
    user?.property?.status,
    user?.propertyStatus,
  ));
}

function subscriptionOf(user) {
  return user?.subscription && typeof user.subscription === 'object' ? user.subscription : null;
}

function storedStatus(user, entitlement) {
  return normaliseState(firstValue(
    entitlement?.subscription_status,
    subscriptionOf(user)?.status,
    subscriptionOf(user)?.subscription_status,
  ));
}

// Explicit timestamps already returned by the server. The entitlement row is
// preferred because it is evaluated with the database clock; the raw
// subscription row is the fallback when the RPC is unavailable.
function explicitDates(entitlement, subscription) {
  return {
    manualExtensionUntil: firstValue(entitlement?.manual_extension_until, subscription?.manual_extension_until),
    graceEndsAt: firstValue(entitlement?.grace_ends_at, subscription?.grace_ends_at),
    periodEndsAt: firstValue(
      entitlement?.period_ends_at,
      entitlement?.effective_end,
      entitlement?.current_period_ends_at,
      subscription?.current_period_ends_at,
      subscription?.period_ends_at,
    ),
    trialEndsAt: firstValue(entitlement?.trial_ends_at, subscription?.trial_ends_at),
  };
}

function hasAnyDate(dates) {
  return Object.values(dates).some((value) => timestamp(value) !== null);
}

function dateDecision(dates, now) {
  const manual = timestamp(dates.manualExtensionUntil);
  if (manual !== null && manual > now) return { expired: false, state: 'manually_extended' };

  const grace = timestamp(dates.graceEndsAt);
  if (grace !== null && grace > now) return { expired: false, state: 'grace_period' };

  const cutoffs = [dates.periodEndsAt, dates.trialEndsAt]
    .map(timestamp)
    .filter((value) => value !== null);
  if (!cutoffs.length) return { expired: false, state: null, missingExpiry: true };

  return cutoffs.every((value) => value <= now)
    ? { expired: true, state: 'expired' }
    : { expired: false, state: null };
}

/**
 * Resolve whether a property may use operational workspaces.
 *
 * @param {object} user AuthContext user, including entitlement/subscription/property.
 * @param {number|string|Date} [referenceTime] Test hook; production defaults to now.
 */
export function evaluateSubscriptionAccess(user, referenceTime = Date.now()) {
  if (user?.isPlatformOwner || normaliseState(user?.platformRole) === 'platform_owner') {
    return result({ blocked: false, state: 'platform_owner', source: 'platform_owner' });
  }

  const entitlement = user?.entitlement && typeof user.entitlement === 'object'
    ? user.entitlement
    : null;
  const subscription = subscriptionOf(user);
  const dates = explicitDates(entitlement, subscription);
  const evaluatedAt = timestamp(entitlement?.evaluated_at);
  const fallbackNow = timestamp(referenceTime) ?? Date.now();
  const now = evaluatedAt ?? fallbackNow;
  const decision = dateDecision(dates, now);
  const commonDates = {
    periodEndsAt: dates.periodEndsAt,
    graceEndsAt: dates.graceEndsAt,
    manualExtensionUntil: dates.manualExtensionUntil,
  };

  const property = propertyState(user, entitlement);
  if (['pending', 'rejected', 'suspended', 'inactive'].includes(property)) {
    const state = property === 'rejected' ? 'cancelled' : property;
    return result({ blocked: true, state, source: 'property_status', ...commonDates });
  }

  const status = storedStatus(user, entitlement);
  if (['suspended', 'cancelled'].includes(status)) {
    return result({ blocked: true, state: status, source: 'subscription_status', ...commonDates });
  }

  if (entitlement) {
    const reported = normaliseState(entitlement.state);

    // An entitlement RPC outage is represented as `unavailable` by the auth
    // layer. It must not become a blanket lockout: only explicit dates that
    // have actually elapsed are authoritative. Properties without any explicit
    // dates keep their established legacy behaviour.
    if (reported === 'unavailable') {
      if (decision.expired) {
        return result({
          blocked: true,
          state: 'expired',
          source: 'subscription_dates',
          reason: 'explicit_billing_dates_elapsed',
          ...commonDates,
        });
      }
      if (decision.state === 'grace_period' || decision.state === 'manually_extended') {
        return result({
          blocked: false,
          state: decision.state,
          source: 'subscription_dates',
          ...commonDates,
        });
      }
      if (!hasAnyDate(dates)) {
        const legacyActive = normaliseState(user?.property?.package) !== 'none'
          && property === 'active';
        return result({
          blocked: !(legacyActive || ['trial', 'active', 'past_due'].includes(status)),
          state: status || (legacyActive ? 'active' : 'no_subscription'),
          source: 'legacy_missing_expiry',
          reason: 'no_explicit_expiry_configured',
          missingExpiry: true,
          ...commonDates,
        });
      }
      return result({
        blocked: false,
        state: status || decision.state || 'active',
        source: 'subscription_dates',
        reason: 'entitlement_unavailable_dates_valid',
        ...commonDates,
      });
    }

    const reportedAllowed = entitlement.allowed === true && ALLOWED_STATES.has(reported);
    // A reported grace/manual state is only honoured while its own server
    // timestamp is still in the future. A stale `manually_extended` label must
    // not become a permanent bypass after the extension expires.
    const futureOverride = ['grace_period', 'manually_extended'].includes(reported)
      && ['grace_period', 'manually_extended'].includes(decision.state);
    const staleDates = decision.expired && !futureOverride;

    if (staleDates) {
      return result({
        blocked: true,
        state: 'expired',
        source: 'server_dates',
        reason: 'explicit_billing_dates_elapsed',
        ...commonDates,
      });
    }
    if (!reportedAllowed || BLOCKED_STATES.has(reported)) {
      return result({
        blocked: true,
        state: reported || 'expired',
        source: 'entitlement',
        reason: firstValue(entitlement.reason, entitlement.state, 'subscription_blocked'),
        ...commonDates,
      });
    }
    return result({
      blocked: false,
      state: decision.state || reported || 'active',
      source: 'entitlement',
      reason: firstValue(entitlement.reason, reported, 'subscription_active'),
      missingExpiry: entitlement.missing_expiry === true,
      ...commonDates,
    });
  }

  // No entitlement RPC response: use only explicit dates that the server
  // already exposed through fn_get_subscription / the subscription overview.
  if (decision.expired) {
    return result({
      blocked: true,
      state: 'expired',
      source: 'subscription_dates',
      reason: 'explicit_billing_dates_elapsed',
      ...commonDates,
    });
  }
  if (decision.state === 'grace_period' || decision.state === 'manually_extended') {
    return result({
      blocked: false,
      state: decision.state,
      source: 'subscription_dates',
      ...commonDates,
    });
  }
  if (!subscription) {
    const legacyActive = normaliseState(user?.property?.package) !== 'none'
      && property === 'active';
    return result({
      blocked: !legacyActive,
      state: legacyActive ? 'active' : 'no_subscription',
      source: 'property_status',
      missingExpiry: legacyActive,
      ...commonDates,
    });
  }
  if (!hasAnyDate(dates) && ['trial', 'active', 'past_due'].includes(status)) {
    return result({
      blocked: false,
      state: status || 'active',
      source: 'legacy_missing_expiry',
      reason: 'no_explicit_expiry_configured',
      missingExpiry: true,
      ...commonDates,
    });
  }
  if (['trial', 'active', 'past_due'].includes(status)) {
    return result({
      blocked: false,
      state: status || 'active',
      source: 'subscription_dates',
      ...commonDates,
    });
  }

  return result({
    blocked: true,
    state: status || 'expired',
    source: 'subscription_status',
    ...commonDates,
  });
}

export function isSubscriptionBlockedForUser(user) {
  return evaluateSubscriptionAccess(user).blocked;
}

// Onboarding states stay on the approval screen. Only terminal billing /
// property states show the hard lockout screen. This distinction prevents a
// pending property application from being told to "renew" before approval.
export function isSubscriptionLockout(user) {
  if (user?.isPlatformOwner || normaliseState(user?.platformRole) === 'platform_owner') return false;
  if (normaliseState(firstValue(user?.property?.status, user?.propertyStatus)) === 'pending') return false;

  const access = evaluateSubscriptionAccess(user);
  if (!access.blocked) return false;
  const unavailable = access.state === 'unavailable' || access.reason === 'entitlement_unavailable';
  return ['expired', 'suspended', 'cancelled', 'unavailable'].includes(access.state)
    || unavailable
    || ['server_dates', 'subscription_dates'].includes(access.source);
}

export function subscriptionRenewalMailto({
  propertyName = '',
  propertyId = '',
  packageName = '',
  state = '',
  periodEndsAt = null,
  graceEndsAt = null,
} = {}) {
  const subject = 'Subscribe or renew OliTechs subscription';
  const lines = [
    'Hello OliTechs,',
    '',
    'Please subscribe / renew this property so operational access can be restored.',
    '',
    `Property: ${propertyName || '—'}`,
    `Property ID: ${propertyId || '—'}`,
    `Package: ${packageName || '—'}`,
    `Current access state: ${state || 'expired'}`,
    `Period ended: ${periodEndsAt || '—'}`,
    `Grace period ended: ${graceEndsAt || '—'}`,
    '',
    'Regards,',
  ];
  return `mailto:${SUBSCRIPTION_SUPPORT_EMAILS.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
