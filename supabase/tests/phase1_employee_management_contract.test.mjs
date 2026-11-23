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

test('employee management schema protects employee and credential records', () => {
  assert.ok(baseMigration.includes('create table if not exists public.employee_permission_codes'));
  assert.ok(baseMigration.includes('alter table public.employee_roles enable row level security'));
  assert.ok(baseMigration.includes('revoke select(token_hash) on public.employee_invitations from anon, authenticated'));
  assert.ok(baseMigration.includes('revoke all on public.manager_credentials from public, anon, authenticated'));
});

test('custom role permissions are constrained by explicit assigned workspaces', () => {
  assert.ok(workspaceMigration.includes('if v_staff.role_id is not null then'));
  assert.ok(workspaceMigration.includes('c.workspace = any(v_assigned)'));
  assert.ok(workspaceMigration.includes('g.expires_at > now()'));
  assert.ok(workspaceMigration.includes('where c.code like \'%.access\''));
});

test('legacy database helpers check granular permission codes instead of staff role labels', () => {
  assert.ok(helperMigration.includes("fn_employee_has_permission(p_property_id,'stores.inventory.view')"));
  assert.ok(helperMigration.includes("'stores.stock.receive'"));
  assert.ok(helperMigration.includes("'back_office.items.manage'"));
  assert.ok(helperMigration.includes("'pos.menu.manage'"));
  assert.ok(!helperMigration.includes('current_staff_role(p_property_id) in'));
});

test('platform owners retain full permissions and catalogue access is permission-gated', () => {
  assert.ok(ownerMigration.includes('public.is_platform_owner() or public.property_role(p_property_id)'));
  assert.ok(ownerMigration.includes("'back_office.items.manage'"));
  assert.ok(ownerMigration.includes("fn_subscription_module_allowed(p_property_id,'backoffice')"));
});

test('employee workspace access requires active staff and uses explicit workspace assignments when permission grants are empty', () => {
  assert.ok(authService.includes('export function canUseApp(user, app)'));
  assert.ok(authService.includes('if (!user.staff || user.staff.is_active === false) return false;'));
  assert.ok(authService.includes('assignedWorkspaceModules(user).includes(workspace)'));
  assert.ok(authService.includes('return !!normalizedWorkspace && assigned.includes(normalizedWorkspace);'));
  assert.ok(authService.includes('codes.includes(accessCode)'));
  assert.ok(authService.includes('export function hasPermissionCode(user, code)'));
  assert.ok(authService.includes('export function canAccessPath(user, pathname)'));
  assert.ok(authService.includes('getPackageModules(pkg).includes(app)'));
});

test('permission editor exposes granular permissions and each shell filters navigation', () => {
  assert.ok(permissionCatalog.includes('back_office.items.manage'));
  assert.ok(permissionCatalog.includes('pos.menu.manage'));
  assert.ok(appShell.includes('hasPermissionCode(user,'));
  assert.ok(frontOfficeShell.includes('permissionForItem'));
  assert.ok(topNav.includes('MAIN_NAV.filter((a) => canUseApp(user, a.id))'));
  assert.ok(routes.includes('canAccessPath(user,window.location.pathname)'));
});

const storekeeperFix = read('../templates/storekeeper_full_stores_workspace_access.sql');

test('Storekeeper PIN-session resolution retains the verified current staff identity path', () => {
  assert.ok(storekeeperFix.includes('s.id = coalesce(p_staff_id, public.current_staff_id(p_property_id))'));
  assert.ok(storekeeperFix.includes('public.current_staff_id(p_property_id)'));
  assert.ok(storekeeperFix.includes('s.is_active = true'));
  assert.ok(storekeeperFix.includes('s.property_id = p_property_id'));
});

test('Storekeeper normal authenticated login resolves staff by auth user id without a PIN session', () => {
  assert.ok(storekeeperFix.includes('p_staff_id is null'));
  assert.ok(storekeeperFix.includes('public.current_staff_id(p_property_id) is null'));
  assert.ok(storekeeperFix.includes('s.user_id = auth.uid()'));
  assert.ok(storekeeperFix.includes('if auth.uid() is null or not (public.is_platform_owner() or public.is_member_of_property(p_property_id))'));
});

test('Storekeeper receives all seven Stores permissions and remains workspace-scoped', () => {
  for (const code of [
    'stores.access',
    'stores.inventory.view',
    'stores.stock.receive',
    'stores.stock.issue',
    'stores.stock.transfer',
    'stores.stock.adjust',
    'stores.suppliers.manage',
  ]) {
    assert.ok(storekeeperFix.includes(code), `missing Storekeeper permission: ${code}`);
  }
  assert.ok(storekeeperFix.includes('c.workspace = any(v_assigned)'));
  assert.ok(storekeeperFix.includes('g.expires_at > now()'));
  const builtInStorekeeperPermissions = storekeeperFix.split('set permission_codes = array[')[1]?.split(']::text[]')[0] || '';
  assert.ok(!builtInStorekeeperPermissions.includes('back_office.'));
  const seededStorekeeperRole = storekeeperFix.split(\"(p_property_id,'Storekeeper',\")[1]?.split('),')[0] || '';
  assert.ok(seededStorekeeperRole.includes('stores.suppliers.manage'));
  assert.ok(!seededStorekeeperRole.includes('back_office.'));
});

test('Stores sidebar maps every Storekeeper module to its granular permission', () => {
  assert.ok(appShell.includes("inventory: 'stores.inventory.view'"));
  assert.ok(appShell.includes("purchasing: 'stores.suppliers.manage'"));
  assert.ok(appShell.includes("transfers: 'stores.stock.transfer'"));
  assert.ok(appShell.includes("counts: 'stores.stock.adjust'"));
  assert.ok(appShell.includes("reports: 'stores.inventory.view'"));
});
