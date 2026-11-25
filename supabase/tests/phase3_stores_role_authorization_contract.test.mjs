import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const reviewMigration = read('../migrations/20261125110000_phase3_stores_role_split_review.sql');
const roleMigration = read('../migrations/20261125111000_phase3_stores_role_templates.sql');
const roleTemplate = read('../templates/phase3_stores_role_authorization.sql');
const authService = read('../../src/services/authService.js');
const navArchitecture = read('../../src/data/modules/navArchitecture.js');
const sidebarNavigation = read('../../src/data/modules/sidebarNavigation.js');
const sidebar = read('../../src/components/shell/Sidebar.jsx');
const permissions = read('../../src/lib/permissions.js');
const employeeService = read('../../src/services/employeeService.js');
const rolesPanel = read('../../src/components/employees/RolesPermissionsPanel.jsx');
const employeeConsole = read('../../src/components/employees/EmployeeConsole.jsx');
const routes = read('../../src/routes/AppRoutes.jsx');
const wastageRuntime = read('./phase7_1_wastage_approval_runtime.sql');

const storekeeperCodes = [
  'stores.access', 'stores.inventory.view', 'stores.stock.receive',
  'stores.stock.issue', 'stores.stock.transfer', 'stores.stock.adjust',
  'stores.suppliers.manage', 'stores.production.post',
  'stores.requisition.view', 'stores.requisition.issue', 'stores.requisition.receive',
];
const managerOnlyCodes = [
  'stores.requisition.create', 'stores.requisition.approve', 'stores.issue.void',
  'stores.costs.view', 'stores.costcentre.manage', 'stores.inventory.valuation.view',
];

function roleCodes(role) {
  const body = roleMigration.split(`when '${role}' then array[`)[1];
  assert.ok(body, `missing role permission branch: ${role}`);
  return body.split(']::text[]')[0];
}

test('Phase 3 template mirror is synchronised with the forward-only migration', () => {
  assert.equal(roleTemplate, roleMigration);
});

test('dry-run role split review never reassigns staff', () => {
  assert.match(reviewMigration, /create table if not exists public\.stores_role_split_review/);
  assert.match(reviewMigration, /create or replace function public\.fn_refresh_stores_role_split_review\(p_property_id uuid\)/);
  assert.match(reviewMigration, /security definer/);
  assert.match(reviewMigration, /current_role, current_role_id/);
  assert.match(reviewMigration, /proposed_role, required_action/);
  assert.match(reviewMigration, /when 'store_manager' then 'store_manager'/);
  assert.match(reviewMigration, /when 'store_keeper' then 'storekeeper'/);
  assert.doesNotMatch(reviewMigration, /update\s+public\.staff/i);
  assert.doesNotMatch(reviewMigration, /delete\s+from\s+public\.staff/i);
  assert.match(reviewMigration, /Only property administrators can review role changes/);
});

test('approved role matrix preserves operations and excludes manager-only controls', () => {
  const keeper = roleCodes('storekeeper');
  for (const code of storekeeperCodes) assert.ok(keeper.includes(code), `Storekeeper missing ${code}`);
  assert.ok(keeper.includes('stores.stock.wastage.submit'));
  for (const code of managerOnlyCodes) assert.ok(!keeper.includes(code), `Storekeeper must not have ${code}`);
  assert.ok(!keeper.includes('stores.stock.wastage.approve'));

  const manager = roleCodes('store_manager');
  for (const code of [...storekeeperCodes, ...managerOnlyCodes]) {
    assert.ok(manager.includes(code), `Store Manager missing ${code}`);
  }
  assert.ok(manager.includes('stores.stock.wastage.approve'));
});

test('Accountant and Auditor templates are seeded and provisioned', () => {
  assert.match(roleMigration, /fn_seed_employee_roles/);
  assert.match(roleMigration, /'Accountant', 'backoffice'/);
  assert.match(roleMigration, /'Auditor', 'backoffice'/);
  assert.match(roleMigration, /back_office\.reports\.view/);
  assert.match(roleMigration, /stores\.inventory\.valuation\.view/);
  assert.match(roleMigration, /Read-only operational and cost reporting; no billing or stock writes/);
});

test('template reconciliation does not silently reassign employees', () => {
  assert.doesNotMatch(roleMigration, /update\s+public\.staff/i);
  assert.doesNotMatch(roleMigration, /insert\s+into\s+public\.staff/i);
  assert.doesNotMatch(roleMigration, /delete\s+from\s+public\.staff/i);
  assert.match(roleMigration, /'phase3_role_template_reconciled'/);
  assert.match(roleMigration, /'phase3_role_template_seeded'/);
});

test('built-in template edits require confirmation and are audited', () => {
  assert.match(roleMigration, /p_confirm_system_edit boolean default false/);
  assert.match(roleMigration, /Built-in role templates require explicit confirmation before editing/);
  assert.match(roleMigration, /employee_system_role_updated/);
  assert.match(roleMigration, /affected_staff/);
  assert.match(roleMigration, /old_value, new_value/);
  assert.match(roleMigration, /drop function if exists public\.fn_update_employee_role\(uuid, text, text, text\[\], text\)/);
});

test('role listing is property-scoped and resolver still enforces workspace assignment', () => {
  assert.match(roleMigration, /create or replace function public\.fn_list_employee_roles\(p_property_id uuid\)/);
  assert.match(roleMigration, /public\.is_member_of_property\(p_property_id\)/);
  assert.match(roleMigration, /c\.workspace = any\(v_assigned\)/);
  assert.match(roleMigration, /g\.expires_at > now\(\)/);
});

test('client role resolution splits Storekeeper from Store Manager', () => {
  assert.ok(authService.includes("'store_manager','storekeeper'"));
  assert.ok(authService.includes("storekeeper: 'Storekeeper'"));
  assert.ok(authService.includes('storekeeper:\'storekeeper\''));
  assert.ok(authService.includes('store_keeper:\'storekeeper\''));
  assert.doesNotMatch(authService, /storekeeper:'store_manager'/);
  assert.match(authService, /case 'store_manager': case 'storekeeper': return \['store'\]/);
  assert.ok(navArchitecture.includes("store_keeper:'storekeeper'"));
  assert.ok(navArchitecture.includes("storekeeper:'storekeeper'"));
  assert.ok(sidebar.includes('storekeeper:"Storekeeper"'));
});

test('navigation exposes operational Stores screens but not valuation to Storekeeper', () => {
  const nav = navArchitecture.split('export const STORES_NAV = [')[1].split('];')[0];
  for (const path of ['/stores', '/stores/requisitions', '/stores/issue-notes', '/stores/stock', '/stores/transfers']) {
    assert.ok(nav.includes(`'${path}'`), `missing Stores navigation path: ${path}`);
  }
  const valuation = nav.split("['Inventory Valuation'")[1].split('],')[0];
  assert.ok(valuation.includes("'store_manager'"));
  assert.ok(!valuation.includes("'storekeeper'"));
});

test('unified employee console preserves the legacy access-rights surface', () => {
  assert.match(employeeConsole, /import Roles from '@\/pages\/admin\/Roles'/);
  assert.match(employeeConsole, /id: 'access', label: 'Staff & access rights', path: '\/backoffice\/employees\/access-rights'/);
  assert.match(employeeConsole, /activeTab === 'access' && <Roles \/>/);
  assert.match(routes, /path="employees\/access-rights" element={<EmployeeConsole tab="access"\/>}/);
  assert.match(sidebarNavigation, /label:"Staff & access rights"/);
});

test('role editor shows package hints and requires explicit built-in edit confirmation', () => {
  assert.match(permissions, /store: 'Stores'/);
  assert.match(permissions, /WORKSPACE_TO_APP/);
  assert.match(rolesPanel, /getPackageModules\(propertyPackage\)/);
  assert.match(rolesPanel, /packageDisabled/);
  assert.match(rolesPanel, /cannot be used until the package is upgraded/);
  assert.match(rolesPanel, /window\.confirm/);
  assert.match(rolesPanel, /editing a built-in template/);
  assert.match(rolesPanel, /No employee is reassigned automatically/);
  assert.match(employeeService, /p_confirm_system_edit: confirmSystemEdit/);
  assert.match(employeeService, /refreshRoleSplitReview\(propertyId\)/);
});

test('wastage runtime test expects the Phase 3 permission split', () => {
  assert.match(wastageRuntime, /stores\.stock\.wastage\.submit/);
  assert.match(wastageRuntime, /stores\.requisition\.issue/);
  assert.match(wastageRuntime, /expected operational Stores permissions plus wastage submission, without valuation or approval/);
  assert.match(wastageRuntime, /NOT \('stores\.inventory\.valuation\.view' = ANY\(v_storekeeper_codes\)\)/);
});
