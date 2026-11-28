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

test('the lockout screen shows computed/stored status and the renewal request form', () => {
  assert.match(suspendedScreen, /to="\/backoffice\/settings\/billing"/);
  assert.match(suspendedScreen, /SUBSCRIPTION_SUPPORT_EMAILS\.join\(' and '\)/);
  assert.match(suspendedScreen, /<SubscriptionRequestModal/);
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
  assert.match(subscriptionPanel, /<SubscriptionRequestModal/);
  // No operational navigation is rendered by the screen itself.
  assert.doesNotMatch(suspendedScreen, /Sidebar|TopAppNav|MAIN_NAV|BackOfficeLayout|POSLayout|StoresLayout/);
});


test('expired sign-in sessions land on the suspension screen and open the renewal form', () => {
  assert.match(appRoutes, /if\(isSubscriptionLockout\(user\)\)return <SubscriptionSuspendedScreen\/>/);
  assert.match(suspendedScreen, /<SubscriptionRequestModal/);
  assert.match(suspendedScreen, /Renew Subscription/);
  assert.match(suspendedScreen, /SUBSCRIPTION_SUPPORT_EMAILS\.join\(' and '\)/);
  assert.doesNotMatch(suspendedScreen, /pmsService\.requestSubscriptionRenewal\(user\.property\.id\)/);
  assert.doesNotMatch(suspendedScreen, /subscriptionRenewalMailto/);
  const edge = readFileSync(new URL('../functions/subscription-renewal-request/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /const RECIPIENTS = \['info@olitechs\.co\.ke', 'olitechs2025@gmail\.com'\]/);
  assert.match(edge, /Only the property owner or administrator/);
  assert.match(edge, /subscription_renewal_requests/);
});

test('subscription request form submissions reach the platform inbox and info@', () => {
  const modal = readFileSync(new URL('../../src/components/subscription/SubscriptionRequestModal.jsx', import.meta.url), 'utf8');
  const pmsService = readFileSync(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
  const platformService = readFileSync(new URL('../../src/services/platformService.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/20261128173000_subscription_request_form.sql', import.meta.url), 'utf8');
  const migrationReadme = readFileSync(new URL('../migrations/README.md', import.meta.url), 'utf8');
  const adminRoute = readFileSync(new URL('../../src/lib/AdminRoute.jsx', import.meta.url), 'utf8');
  const adminLayout = readFileSync(new URL('../../src/pages/admin/AdminLayout.jsx', import.meta.url), 'utf8');
  const inbox = readFileSync(new URL('../../src/pages/admin/AdminSubscriptionRequests.jsx', import.meta.url), 'utf8');
  const edge = readFileSync(new URL('../functions/subscription-renewal-request/index.ts', import.meta.url), 'utf8');

  assert.match(modal, /useForm/);
  assert.match(modal, /zodResolver\(requestSchema\)/);
  for (const field of ['packageName', 'billingCycle', 'phone', 'notes']) {
    assert.match(modal, new RegExp(field), `form field ${field}`);
  }
  assert.match(modal, /\['owner', 'admin'\]\.includes\(role\)/);
  assert.match(modal, /pmsService\.requestSubscriptionRenewal\(\{/);
  assert.match(pmsService, /request_kind:payload\.requestKind/);
  assert.match(pmsService, /package_name:payload\.packageName/);
  assert.match(pmsService, /billing_cycle:payload\.billingCycle/);
  assert.match(pmsService, /phone:payload\.phone/);
  assert.match(pmsService, /notes:payload\.notes/);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_kind/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS requested_package/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS billing_cycle/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS contact_phone/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS request_notes/i);
  assert.match(migration, /create or replace function public\.admin_list_subscription_requests\(\)/i);
  assert.match(migration, /where public\.is_platform_owner\(\)/i);
  assert.match(migration, /grant execute on function public\.admin_list_subscription_requests\(\) to authenticated/i);
  assert.match(migration, /revoke execute on function public\.admin_list_subscription_requests\(\) from anon, public/i);
  assert.match(migrationReadme, /20261128173000 — Subscription request form/);
  assert.match(migrationReadme, /table remains service-role only/i);

  assert.match(platformService, /rpc\('admin_list_subscription_requests'\)/);
  assert.match(inbox, /platformService\.listSubscriptionRequests\(\)/);
  assert.match(appRoutes, /<Route path="\/admin\/subscription-requests" element=\{<AdminSubscriptionRequests\/>\}\/>/);
  assert.match(adminRoute, /'\/admin\/subscription-requests'/);
  assert.match(adminLayout, /label: 'Subscription Requests'/);

  assert.match(edge, /request_kind/);
  assert.match(edge, /billing_cycle/);
  assert.match(edge, /contact_phone/);
  assert.match(edge, /request_notes/);
  assert.match(edge, /admin\/subscription-requests/);
  assert.match(edge, /Only the property owner or administrator/);
  assert.doesNotMatch(edge, /if \(!expired\(subscription\)\)/);
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

test('homepage demo CTAs open a public request form without weakening subscription requests', () => {
  const home = readFileSync(new URL('../../src/pages/PublicHome.jsx', import.meta.url), 'utf8');
  const modal = readFileSync(
    new URL('../../src/components/subscription/PublicDemoRequestModal.jsx', import.meta.url),
    'utf8',
  );
  const pmsService = readFileSync(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
  const platformService = readFileSync(new URL('../../src/services/platformService.js', import.meta.url), 'utf8');
  const inbox = readFileSync(new URL('../../src/pages/admin/AdminSubscriptionRequests.jsx', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/20261128190000_public_demo_requests.sql', import.meta.url), 'utf8');
  const migrationReadme = readFileSync(new URL('../migrations/README.md', import.meta.url), 'utf8');
  const edge = readFileSync(new URL('../functions/public-demo-request/index.ts', import.meta.url), 'utf8');
  const subscriptionModal = readFileSync(
    new URL('../../src/components/subscription/SubscriptionRequestModal.jsx', import.meta.url),
    'utf8',
  );

  // Every public CTA opens the same modal; no CTA silently falls back to a
  // contact link or the authenticated-only subscription form.
  assert.match(home, /import PublicDemoRequestModal from '@\/components\/subscription\/PublicDemoRequestModal'/);
  assert.match(home, /const \[demoOpen, setDemoOpen\] = useState\(false\)/);
  assert.match(home, /const openDemo = \(\) => \{/);
  assert.match(home, /<PublicDemoRequestModal open=\{demoOpen\} onOpenChange=\{setDemoOpen\} \/>/);
  assert.match(home, /className="marketing-button" onClick=\{openDemo\}>Request a Demo/);
  assert.match(home, /hero-actions[\s\S]*onClick=\{openDemo\}/);
  assert.match(home, /<button type="button" onClick=\{openDemo\}>Talk to Our Team<\/button>/);
  assert.match(home, /<button type="button"[\s\S]*onClick=\{openDemo\}>Let’s talk ↗<\/button>/);
  assert.match(home, /final-cta-actions[\s\S]*<button type="button" onClick=\{openDemo\}>Request a Demo ↗/);
  assert.match(home, /footer-inner[\s\S]*<button type="button" onClick=\{openDemo\}>Request a Demo/);
  assert.match(home, /mobile-nav-panel[\s\S]*<button type="button" onClick=\{openDemo\}>Request a Demo/);
  assert.doesNotMatch(home, /href="#contact"/);

  // The public form is anonymous and independent from the owner/admin form.
  assert.match(modal, /useForm/);
  assert.match(modal, /zodResolver\(demoRequestSchema\)/);
  assert.doesNotMatch(modal, /useAuth/);
  assert.doesNotMatch(modal, /<SubscriptionRequestModal/);
  assert.doesNotMatch(modal, /from '@\/components\/subscription\/SubscriptionRequestModal'/);
  for (const field of ['fullName', 'email', 'propertyName', 'phone', 'packageName', 'billingCycle', 'notes']) {
    assert.match(modal, new RegExp(field), `demo form field ${field}`);
  }
  assert.match(modal, /pmsService\.requestDemo\(\{/);
  assert.match(subscriptionModal, /\['owner', 'admin'\]\.includes\(role\)/);
  assert.match(subscriptionModal, /pmsService\.requestSubscriptionRenewal\(\{/);

  assert.match(pmsService, /functions\.invoke\('public-demo-request'/);
  assert.match(pmsService, /full_name:payload\.fullName/);
  assert.match(pmsService, /property_name:payload\.propertyName/);
  assert.match(pmsService, /package_name:payload\.packageName/);

  // Public submissions cannot reuse the authenticated subscription guard.
  assert.doesNotMatch(edge, /authHeader\.startsWith\('Bearer '\)/);
  assert.doesNotMatch(edge, /Only the property owner or administrator/);
  assert.match(edge, /Please enter your name\./);
  assert.match(edge, /Enter a valid email address\./);
  assert.match(edge, /Please enter your property or business name\./);
  assert.match(edge, /from\('demo_requests'\)/);
  assert.match(edge, /const RECIPIENTS = \['info@olitechs\.co\.ke', 'olitechs2025@gmail\.com'\]/);
  assert.match(edge, /Idempotency-Key.*demo-request/);
  assert.match(edge, /OliTechs platform inbox and \$\{RECIPIENTS\[0\]\}/);
  assert.doesNotMatch(edge, /subscription_renewal_requests/);

  assert.match(migration, /create table if not exists public\.demo_requests/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.demo_requests from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.demo_requests to service_role/i);
  assert.match(migration, /create or replace function public\.admin_list_demo_requests\(\)/i);
  assert.match(migration, /where public\.is_platform_owner\(\)/i);
  assert.match(migration, /grant execute on function public\.admin_list_demo_requests\(\) to authenticated/i);
  assert.match(migration, /revoke execute on function public\.admin_list_demo_requests\(\) from anon, public/i);
  assert.doesNotMatch(migration, /alter table public\.subscription_renewal_requests/i);
  assert.match(migrationReadme, /20261128190000 — Public demo requests/);

  assert.match(platformService, /rpc\('admin_list_demo_requests'\)/);
  assert.match(inbox, /platformService\.listDemoRequests\(\)/);
  assert.match(inbox, /Demo requests/);
});

test('request dialog forms keep the scrolling body inside the panel height', () => {
  const subscriptionModal = readFileSync(
    new URL('../../src/components/subscription/SubscriptionRequestModal.jsx', import.meta.url),
    'utf8',
  );
  const demoModal = readFileSync(
    new URL('../../src/components/subscription/PublicDemoRequestModal.jsx', import.meta.url),
    'utf8',
  );
  const dialog = readFileSync(new URL('../../src/components/ui/dialog.jsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const scrollFormClass = /<form onSubmit=\{handleSubmit\(onSubmit\)\} noValidate className="flex min-h-0 flex-1 flex-col">/;

  // The form is a direct flex child of the panel. Without min-h-0/flex-1 the
  // form keeps its content height, the panel clips it, and the body cannot
  // scroll on short viewports.
  assert.match(subscriptionModal, scrollFormClass);
  assert.match(demoModal, scrollFormClass);
  assert.match(dialog, /cn\("modal-panel font-body/);
  assert.match(dialog, /cn\("modal-body scroll-shadow-y/);
  assert.match(dialog, /cn\("modal-footer/);
  assert.match(styles, /\.modal-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?max-height:\s*calc\(100dvh[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.modal-body\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(styles, /\.modal-header\s*\{\s*flex:\s*0 0 auto;/);
  assert.match(styles, /\.modal-footer\s*\{\s*flex:\s*0 0 auto;/);
});
