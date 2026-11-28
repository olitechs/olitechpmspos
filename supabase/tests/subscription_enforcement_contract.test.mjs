import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Subscription enforcement contract (Phase 4).
//
// Pins the all-workspaces enforcement chain: the session carries the
// server-computed entitlement, every protected workspace renders the
// suspension screen for a blocked entitlement (with only renewal/billing
// reachable), the database gains row-level write guards on the core
// operational tables, and an open browser tab revalidates silently.

const guards = readFileSync(
  new URL('../migrations/20261117182000_subscription_operational_write_guards.sql', import.meta.url),
  'utf8',
);
const authService = readFileSync(new URL('../../src/services/authService.js', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../../src/lib/AuthContext.jsx', import.meta.url), 'utf8');
const appRoutes = readFileSync(new URL('../../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const suspendedScreen = readFileSync(
  new URL('../../src/components/auth/SubscriptionSuspendedScreen.jsx', import.meta.url),
  'utf8',
);
const subscriptionAccess = readFileSync(
  new URL('../../src/lib/subscriptionAccess.js', import.meta.url),
  'utf8',
);
const subscriptionPanel = readFileSync(
  new URL('../../src/components/admin/SubscriptionPanel.jsx', import.meta.url),
  'utf8',
);

test('a generic row guard raises for blocked properties and exempts system contexts', () => {
  assert.match(guards, /function public\.fn_assert_property_row_operational\(\)/i);
  assert.match(guards, /perform public\.fn_assert_property_operational\(v_property_id\)/i);
  // Platform owners keep full access; background/service-role contexts
  // (auth.uid() is null) are exempt; user requests always carry a JWT.
  assert.match(guards, /if auth\.uid\(\) is null then\s*\r?\n\s*return coalesce\(NEW, OLD\);/i);
  assert.match(guards, /revoke execute on function public\.fn_assert_property_row_operational\(\) from anon, public;/i);
});

test('write guards cover the core operational tables across all workspaces', () => {
  for (const table of [
    'reservations', 'guests', 'rooms', 'folio_charges', 'payments',
    'pos_receipts', 'pos_receipt_payments', 'pos_shifts', 'pos_shift_payments',
    'pos_kitchen_orders', 'pos_table_sessions', 'pos_void_items',
    'cashier_shifts', 'cashier_adjustments', 'cashier_refunds',
    'suppliers', 'products', 'stock_movements', 'stock_usage',
    'stock_adjustments', 'stock_transfers', 'purchase_orders', 'goods_receipts',
    'inventory_counts', 'inventory_movements', 'inventory_wastage', 'inventory_productions',
    'housekeeping_tasks', 'laundry_orders', 'maintenance_tickets', 'night_audits',
  ]) {
    assert.match(
      guards,
      new RegExp(`'${table}'`),
      `operational table ${table} must be guarded`,
    );
  }
  // Triggers cover insert/update/delete before the row lands.
  assert.match(guards, /before insert or update or delete/i);
  assert.match(guards, /trg_assert_operational/);
});

test('auth-identity and audit surfaces are deliberately not write-guarded', () => {
  for (const table of ['staff', 'audit_logs', 'property_subscriptions', 'properties', 'subscription_events']) {
    assert.doesNotMatch(guards, new RegExp(`'${table}'`), `${table} must not be write-guarded`);
  }
});

test('the session carries the entitlement and narrows outages to elapsed dates', () => {
  assert.match(authService, /fn_get_my_subscription_entitlement/i);
  assert.match(authService, /entitlement,?\s*\r?\n/);
  assert.match(authService, /entitlement: entitlementRow \|\| null|entitlement = entitlementRow \|\| null/i);
  assert.match(authService, /state: 'unavailable',[\s\S]*?allowed: false,[\s\S]*?reason: 'entitlement_unavailable'/);
  assert.match(authService, /import \{ isSubscriptionBlockedForUser \} from '@\/lib\/subscriptionAccess';/);
  assert.match(authService, /return isSubscriptionBlockedForUser\(user\);/);
  assert.match(authService, /if \(isSubscriptionBlocked\(user\)\) return false;\s*\r?\n\s*const pkg/);
  assert.match(subscriptionAccess, /export function evaluateSubscriptionAccess\(user, referenceTime = Date\.now\(\)\)/);
  assert.match(subscriptionAccess, /reported === 'unavailable'/);
  assert.match(subscriptionAccess, /source: 'server_dates'/);
  assert.match(subscriptionAccess, /source: 'subscription_dates'/);
  assert.match(subscriptionAccess, /source: 'legacy_missing_expiry'/);
  assert.match(subscriptionAccess, /entitlement\.allowed === true && ALLOWED_STATES\.has\(reported\)/);
});
test('renewal, billing and support paths stay reachable for a blocked property', () => {
  assert.match(authService, /export function isRenewalPath\(pathname\)/);
  assert.ok(
    authService.includes("/^\\/backoffice\\/(?:settings\\/)?billing$/"),
    'billing path exemption must be pinned',
  );
  assert.ok(
    authService.includes("/^\\/backoffice\\/help(?:\\/\|$)/"),
    'support/help path exemption must be pinned',
  );
});

test('lockout renders across protected and public routes while pending stays on approval', () => {
  // The gate runs before the workspace/role checks so no workspace bypasses it.
  const gate = appRoutes.indexOf('isSubscriptionLockout(user)');
  const canUseGate = appRoutes.indexOf('if(!canUseApp(user,app))');
  assert.ok(gate > -1 && canUseGate > -1 && gate < canUseGate, 'lockout gate must run before workspace checks');
  assert.match(appRoutes, /isSubscriptionLockout\(user\)\)\{return isRenewalPath\(window\.location\.pathname\)\?<SubscriptionBillingOnlyScreen\/>:<SubscriptionSuspendedScreen\/>;\}/);
  assert.match(appRoutes, /if\(isSubscriptionLockout\(user\)\)return <SubscriptionSuspendedScreen\/>;/);
  assert.match(appRoutes, /return allowed\?<Navigate to=\{allowed\.path\} replace\/>:<PendingApproval\/>;/);
  assert.match(appRoutes, /import \{ isSubscriptionLockout \} from "@\/lib\/subscriptionAccess";/);
  assert.match(appRoutes, /import SubscriptionSuspendedScreen, \{ SubscriptionBillingOnlyScreen \}/);
  assert.match(subscriptionAccess, /if \(normaliseState\(firstValue\(user\?\.property\?\.status, user\?\.propertyStatus\)\) === 'pending'\) return false;/);
  // All four workspaces remain behind the same guard.
  for (const workspace of ['backoffice', 'frontoffice', 'stores', 'pos']) {
    assert.match(appRoutes, new RegExp(`<Route element=\\{<ProtectedRoute app="${workspace}"\\/>\\}>`));
  }
});

test('the lockout screen shows computed/stored status and both renewal emails', () => {
  assert.match(suspendedScreen, /to="\/backoffice\/settings\/billing"/);
  assert.match(suspendedScreen, /SUBSCRIPTION_SUPPORT_EMAILS\.join\(' and '\)/);
  assert.match(suspendedScreen, /subscriptionRenewalMailto\(\{/);
  assert.match(suspendedScreen, /formatSubscriptionDate\(periodEndsAt\)/);
  assert.match(suspendedScreen, /formatSubscriptionDate\(graceEndsAt\)/);
  assert.match(suspendedScreen, /describeRemaining\(graceSeconds\)/);
  assert.match(suspendedScreen, /Computed access status/);
  assert.match(suspendedScreen, /Stored subscription status/);
  assert.match(suspendedScreen, /does not override the subscription expiry and grace dates/);
  assert.match(suspendedScreen, /Your data is preserved/i);
  assert.doesNotMatch(suspendedScreen, /mailto:support@olitechs\.com/);
  assert.match(subscriptionAccess, /info@olitechs\.co\.ke', 'olitechs2025@gmail\.com/);
  assert.match(subscriptionPanel, /SUBSCRIPTION_SUPPORT_EMAILS\.join\(' and '\)/);
  assert.match(subscriptionPanel, /Computed access status/);
  assert.match(subscriptionPanel, /does not override elapsed subscription or grace dates/);
  assert.match(subscriptionPanel, /subscriptionRenewalMailto\(\{/);
  // No operational navigation is rendered by the screen itself.
  assert.doesNotMatch(suspendedScreen, /Sidebar|TopAppNav|MAIN_NAV|BackOfficeLayout|POSLayout|StoresLayout/);
});


test('expired sign-in sessions land on the suspension screen and can request renewal by email', () => {
  assert.match(appRoutes, /if\(isSubscriptionLockout\(user\)\)return <SubscriptionSuspendedScreen\/>/);
  assert.match(suspendedScreen, /pmsService\.requestSubscriptionRenewal\(user\.property\.id\)/);
  assert.match(suspendedScreen, /Renew Subscription/);
  assert.match(suspendedScreen, /info@olitechs\.co\.ke/);
  assert.match(suspendedScreen, /olitech2025@gmail\.com/);
  const edge = readFileSync(new URL('../functions/subscription-renewal-request/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /const RECIPIENTS = \['info@olitechs\.co\.ke', 'olitechs2025@gmail\.com'\]/);
  assert.match(edge, /Only the property owner or administrator/);
  assert.match(edge, /subscription_renewal_requests/);
});

test('the billing-only shell renders the subscription panel without workspace navigation', () => {
  assert.match(suspendedScreen, /export function SubscriptionBillingOnlyScreen\(\)/);
  assert.match(suspendedScreen, /<SubscriptionPanel \/>/);
  assert.doesNotMatch(
    suspendedScreen,
    /SubscriptionBillingOnlyScreen[\s\S]*Sidebar|SubscriptionBillingOnlyScreen[\s\S]*TopAppNav/,
  );
});

test('an open tab revalidates the entitlement silently on focus, visibility and an interval', () => {
  assert.match(authContext, /const refreshUser = useCallback\(async \(\)/);
  assert.match(authContext, /document\.visibilityState !== 'visible'\) return;/);
  assert.match(authContext, /window\.addEventListener\('focus', recheck\)/);
  assert.match(authContext, /document\.addEventListener\('visibilitychange', recheck\)/);
  assert.match(authContext, /setInterval\(recheck, FOCUS_RECHECK_MS\)/);
  // Silent revalidation must not flip the full-screen auth loading flag.
  const refreshBlock = authContext.slice(
    authContext.indexOf('const refreshUser'),
    authContext.indexOf('useEffect(() => {\n    if (!user || user.isPlatformOwner) return undefined;'),
  );
  assert.ok(refreshBlock.includes('refreshUser') && !refreshBlock.includes('setIsLoadingAuth(true)'));
});
