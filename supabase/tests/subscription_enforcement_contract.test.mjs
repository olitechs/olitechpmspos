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

test('the session carries the server-computed entitlement and defers when missing', () => {
  assert.match(authService, /fn_get_my_subscription_entitlement/i);
  assert.match(authService, /entitlement,?\s*\r?\n/);
  assert.match(authService, /entitlement: entitlementRow \|\| null|entitlement = entitlementRow \|\| null/i);
  // Missing entitlement (older deployment) does not lock the session locally.
  assert.match(authService, /if \(!ent \|\| typeof ent !== 'object'\) return false;/);
  assert.match(authService, /return ent\.allowed !== true;/);
  assert.match(authService, /if \(isSubscriptionBlocked\(user\)\) return false;\s*\r?\n\s*const pkg/);
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

test('every protected workspace renders the suspension screen for a blocked entitlement', () => {
  // The gate runs before the workspace/role checks so no workspace bypasses it.
  const gate = appRoutes.indexOf('isSubscriptionBlocked(user)');
  const canUseGate = appRoutes.indexOf('if(!canUseApp(user,app))');
  assert.ok(gate > -1 && canUseGate > -1 && gate < canUseGate, 'entitlement gate must run before workspace checks');
  assert.match(appRoutes, /isSubscriptionBlocked\(user\)\)\{return isRenewalPath\(window\.location\.pathname\)\?<SubscriptionBillingOnlyScreen\/>:<SubscriptionSuspendedScreen\/>;\}/);
  assert.match(appRoutes, /import SubscriptionSuspendedScreen, \{ SubscriptionBillingOnlyScreen \}/);
  // All four workspaces remain behind the same guard.
  for (const workspace of ['backoffice', 'frontoffice', 'stores', 'pos']) {
    assert.match(appRoutes, new RegExp(`<Route element=\\{<ProtectedRoute app="${workspace}"\\/>\\}>`));
  }
});

test('the suspension screen shows status details and keeps only renewal, billing and support actions', () => {
  assert.match(suspendedScreen, /to="\/backoffice\/settings\/billing"/);
  assert.match(suspendedScreen, /mailto:support@olitechs\.com/);
  assert.match(suspendedScreen, /formatSubscriptionDate\(ent\.period_ends_at\)/);
  assert.match(suspendedScreen, /formatSubscriptionDate\(ent\.grace_ends_at\)/);
  assert.match(suspendedScreen, /describeRemaining\(graceSeconds\)/);
  assert.match(suspendedScreen, /Your data is preserved/i);
  // No operational navigation is rendered by the screen itself.
  assert.doesNotMatch(suspendedScreen, /Sidebar|TopAppNav|MAIN_NAV|BackOfficeLayout|POSLayout|StoresLayout/);
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
