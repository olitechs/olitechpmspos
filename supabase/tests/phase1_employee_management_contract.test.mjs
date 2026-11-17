import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const baseMigration = read('../migrations/20261117105534_phase1_employee_management_licensing.sql');
const workspaceMigration = read('../migrations/20261117130000_enforce_employee_permission_scope.sql');
const helperMigration = read('../migrations/20261117130500_enforce_legacy_workspace_permission_helpers.sql');
const ownerMigration = read('../migrations/20261117131500_platform_owner_permission_consistency.sql');
const authService = read('../../src/services/authService.js');
const permissionCatalog = read('../../src/lib/permissions.js');
const routes = read('../../src/routes/AppRoutes.jsx');
const appShell = read('../../src/components/layout/AppShell.jsx');
const frontOfficeShell = read('../../src/components/layout/FrontOfficeShell.jsx');
const topNav = read('../../src/components/layout/TopAppNav.jsx');

test('employee management schema keeps RLS enabled and credential tables private', () => {
  for (const table of ['employee_permission_codes','employee_departments','employee_roles','employee_invitations','manager_credentials','manager_auth_attempts','module_access_grants','employee_access_audit','employee_licence_config','employee_licence_addons','manager_authorization_tickets']) {
    assert.match(baseMigration, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'));
  }
  assert.match(baseMigration, /revoke all on public\\.manager_credentials from public, anon, authenticated/i);
  assert.match(baseMigration, /revoke select\\(token_hash\\) on public\\.employee_invitations from anon, authenticated/i);
});

test('effective employee permissions are constrained by explicit assigned workspaces', () => {
  assert.match(workspaceMigration, /c\\.workspace = any\\(v_assigned\\)/i);
  assert.match(workspaceMigration, /if v_staff\\.role_id is not null then/i);
  assert.match(workspaceMigration, /if not found then v_role_codes := '\{\}'::text\\[\\]/i);
  assert.match(workspaceMigration, /c\\.workspace = any\\(v_assigned\\)/i);
  assert.match(workspaceMigration, /g\\.revoked_at is null and g\\.expires_at > now\\(\\)/i);
});

test('legacy workspace helpers use permission codes rather than role labels', () => {
  assert.match(helperMigration, /fn_employee_workspaces\\(p_property_id\\)/i);
  assert.match(helperMigration, /fn_employee_has_permission\\(p_property_id,'stores\\.inventory\\.view'\\)/i);
  assert.match(helperMigration, /stores\\.stock\\.receive/i);
  assert.match(helperMigration, /back_office\\.items\\.manage/i);
  assert.match(helperMigration, /pos\\.menu\\.manage/i);
  assert.doesNotMatch(helperMigration, /current_staff_role\\(p_property_id\\) in/i);
});

test('platform owners retain access and catalogue management requires its permission', () => {
  assert.match(ownerMigration, /public\\.is_platform_owner\\(\\) or public\\.property_role\\(p_property_id\\) in \\('owner','admin'\\)/i);
  assert.match(ownerMigration, /back_office\\.items\\.manage/i);
  assert.match(ownerMigration, /fn_subscription_module_allowed\\(p_property_id,'backoffice'\\)/i);
});

test('frontend workspace access fails closed for employees without an active staff identity and permission summary', () => {
  assert.match(authService, /export function canUseApp\\(user, app\\)/);
  assert.match(authService, /if \\(!user\\.staff \\|\\| user\\.staff\\.is_active === false \\|\\| !user\\.permissions\\) return false;/);
  assert.match(authService, /codes\\.includes\\(accessCode\\)/);
  assert.match(authService, /export function hasPermissionCode\\(user, code\\)/);
  assert.match(authService, /export function canAccessPath\\(user, pathname\\)/);
  assert.match(authService, /getPackageModules\\(pkg\\)\\.includes\\(app\\)/);
});

test('permission editor exposes granular workspace permission codes', () => {
  assert.match(permissionCatalog, /back_office\\.items\\.manage/);
  assert.match(permissionCatalog, /pos\\.menu\\.manage/);
  assert.match(permissionCatalog, /PERMISSION_CODES/);
});

test('workspace navigation is filtered by effective permissions and workspace tabs by route access', () => {
  assert.match(appShell, /hasPermissionCode\\(user,/);
  assert.match(frontOfficeShell, /permissionForItem/);
  assert.match(topNav, /MAIN_NAV\\.filter\\(\\(a\\) => canUseApp\\(user, a\\.id\\)\\)/);
  assert.match(routes, /canAccessPath\\(user,window\\.location\\.pathname\\)/);
});
