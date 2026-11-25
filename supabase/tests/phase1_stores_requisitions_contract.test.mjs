import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const schema = read('../migrations/20261123090000_phase1_stores_requisitions_schema.sql');
const posting = read('../migrations/20261123091000_phase1_stores_posting_service.sql');
const settings = read('../migrations/20261123092000_phase1_stores_settings_costcentres.sql');
const requisitions = read('../migrations/20261123092100_phase1_stores_requisition_functions.sql');
const issues = read('../migrations/20261123092200_phase1_stores_issue_functions.sql');
const dashboard = read('../migrations/20261123092300_phase1_stores_dashboard_notifications.sql');
const roles = read('../migrations/20261123093000_phase1_stores_permissions_roles.sql');
const seed = read('../migrations/20261123094000_phase1_stores_cost_centres_seed.sql');

const service = read('../../src/services/storesService.js');
const requestPage = read('../../src/components/stores/RequestStockPage.jsx');
const requisitionPage = read('../../src/components/stores/RequisitionsPage.jsx');
const issuePage = read('../../src/components/stores/IssueNotesPage.jsx');
const costCentresPage = read('../../src/components/stores/CostCentresPage.jsx');
const reportsPage = read('../../src/components/stores/StoresReportsPage.jsx');
const appRoutes = read('../../src/routes/AppRoutes.jsx');
const nav = read('../../src/data/modules/navArchitecture.js');
const authService = read('../../src/services/authService.js');
const appShell = read('../../src/components/layout/AppShell.jsx');
const reportDefinitions = read('../../src/services/reportDefinitions.js');

test('phase 1 Stores schema creates every document, configuration and audit table', () => {
  for (const table of [
    'stores_settings', 'cost_centres', 'requisitions', 'requisition_lines',
    'issue_notes', 'issue_note_lines', 'cost_centre_par_templates',
    'cost_centre_par_lines', 'stores_document_audit', 'stores_notifications',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`), `missing table ${table}`);
  }

  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.issue_note_lines[\s\S]*?unit_cost numeric/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.issue_note_lines[\s\S]*?total_cost numeric/);
  assert.match(schema, /REVOKE ALL ON public\.issue_note_lines FROM anon, authenticated;/);
  assert.match(schema, /-- issue_note_lines: intentionally no table read grant\./);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.stores_document_audit[\s\S]*?before jsonb[\s\S]*?after jsonb/);
});

test('every stock change goes through the location-aware ledger service', () => {
  for (const fn of [
    'fn_stores_resolve_location', 'fn_stores_ensure_projection',
    'fn_stores_weighted_average_cost', 'fn_stores_convert_qty',
    'fn_stores_post_movement', 'fn_stores_post_move',
  ]) {
    assert.match(posting, new RegExp(`CREATE OR REPLACE FUNCTION stock_internal\\.${fn}`), `missing ${fn}`);
  }
  assert.match(posting, /INSERT INTO public\.stock_movements/);
  assert.match(posting, /fn_apply_stock_movement/);
  assert.match(issues, /PERFORM stock_internal\.fn_stores_post_movement/);
  assert.match(issues, /PERFORM stock_internal\.fn_stores_post_move/);
  assert.match(issues, /stock_internal\.fn_stores_allocate_number\(\s*p_property_id, 'stores_issue', 'ISS'/);
  assert.match(requisitions, /stock_internal\.fn_stores_allocate_number\(\s*p_property_id, 'stores_requisition', 'REQ'/);

  // Saving, submitting, approving, rejecting and cancelling must not post.
  const nonPosting = requisitions.slice(0, requisitions.indexOf('fn_stores_list_requisitions'));
  assert.doesNotMatch(nonPosting, /fn_stores_post_movement|fn_stores_post_move/);
});

test('permission, entitlement, RLS and segregation of duties are enforced server-side', () => {
  for (const permission of [
    'stores.requisition.create', 'stores.requisition.view', 'stores.requisition.approve',
    'stores.requisition.issue', 'stores.requisition.receive', 'stores.issue.void',
    'stores.costs.view', 'stores.costcentre.manage',
  ]) {
    assert.match(roles, new RegExp(`'${permission.replaceAll('.', '\\.')}'`), `missing permission ${permission}`);
  }

  assert.match(settings, /fn_subscription_module_allowed\(p_property_id, 'store'\)/);
  assert.match(settings, /fn_employee_has_permission\(p_property_id, p_permission\)/);
  assert.match(requisitions, /Segregation of duties: the requester cannot approve their own requisition/);
  assert.match(issues, /Segregation of duties: the issuer cannot confirm receipt/);
  assert.match(issues, /fn_stores_can_view_costs/);
  assert.match(issues, /v_include_costs/);
  assert.match(roles, /'Storekeeper'[\s\S]*?Cannot approve requisitions, see costs or manage cost centres/);
  assert.match(seed, /PERFORM stock_internal\.fn_stores_ensure_settings/);
});

test('document lifecycle enforces idempotency and receipt confirmation changes no stock', () => {
  assert.match(requisitions, /idempotency_key/);
  assert.match(issues, /idempotency_key/);
  assert.match(issues, /Confirm receipt \(no stock change; discrepancies are recorded only\)/);

  const receiptBody = issues.slice(
    issues.indexOf('fn_stores_confirm_issue_receipt'),
    issues.indexOf('fn_stores_void_issue'),
  );
  assert.doesNotMatch(receiptBody, /fn_stores_post_movement|fn_stores_post_move/);
  assert.match(receiptBody, /discrepancy_qty = qty - v_received/);
  assert.match(issues, /compensat/);
});

test('frontend service calls only the server-authoritative RPCs', () => {
  for (const rpc of [
    'fn_stores_get_settings', 'fn_stores_update_settings', 'fn_stores_list_cost_centres',
    'fn_stores_upsert_cost_centre', 'fn_stores_list_locations', 'fn_stores_list_par_templates',
    'fn_stores_save_par_template', 'fn_stores_list_requisitions', 'fn_stores_requisition_detail',
    'fn_stores_save_requisition', 'fn_stores_submit_requisition', 'fn_stores_decide_requisition',
    'fn_stores_cancel_requisition', 'fn_stores_requisition_products', 'fn_stores_issue_requisition',
    'fn_stores_direct_issue', 'fn_stores_confirm_issue_receipt', 'fn_stores_void_issue',
    'fn_stores_list_issue_notes', 'fn_stores_issue_note_detail', 'fn_stores_dashboard',
    'fn_stores_list_notifications', 'fn_stores_mark_notifications_read',
  ]) {
    assert.match(service, new RegExp(`rpc\\('${rpc.replaceAll('.', '\\.')}'`), `missing RPC wrapper ${rpc}`);
  }
  assert.doesNotMatch(service, /\.from\(/);
});

test('Stores screens, routes, navigation and path rules are registered and permission-gated', () => {
  for (const page of [requestPage, requisitionPage, issuePage, costCentresPage, reportsPage]) {
    assert.match(page, /storesService/);
  }

  for (const route of ['requisitions', 'request-stock', 'issue-notes', 'reports/requisitions', 'inventory/cost-centres']) {
    assert.ok(appRoutes.includes(`path="${route}"`), `missing route ${route}`);
  }

  for (const path of ['/stores/requisitions', '/stores/request-stock', '/stores/issue-notes', '/stores/reports/requisitions']) {
    assert.ok(nav.includes(`'${path}'`), `missing navigation entry ${path}`);
  }

  assert.ok(authService.includes("requisitions(?:\\/|$)/, 'stores.requisition.view'"));
  assert.ok(authService.includes("request-stock(?:\\/|$)/, 'stores.requisition.create'"));
  assert.ok(authService.includes("issue-notes(?:\\/|$)/, 'stores.requisition.receive'"));
  assert.ok(authService.includes('backoffice\\/inventory\\/cost-centres'));

  assert.match(appShell, /requisitions: 'stores\.requisition\.view'/);
  assert.match(appShell, /'issue-notes': 'stores\.requisition\.receive'/);
  assert.match(appShell, /'request-stock': 'stores\.requisition\.create'/);

  // The cost centres rule must precede the generic backoffice inventory rule.
  const costCentreRule = authService.indexOf('backoffice\\/inventory\\/cost-centres');
  const genericRule = authService.indexOf('backoffice\\/inventory(?:');
  assert.ok(costCentreRule > -1 && genericRule > -1 && costCentreRule < genericRule);
});

test('reports exclude issue costs and cost snapshots stay behind the cost permission', () => {
  assert.match(reportDefinitions, /buildStoresRequisitionRegisterDefinition/);
  assert.match(reportDefinitions, /buildStoresIssueRegisterDefinition/);
  assert.match(reportDefinitions, /Cost values are deliberately excluded from this register/);
  assert.match(issuePage, /detail\.can_view_costs/);
  assert.match(issuePage, /discrepancy_qty/);
});

test('Storekeeper dashboard reads the new Stores summary instead of claiming no workflow', () => {
  const dashboardPage = read('../../src/pages/StorekeeperDashboard.jsx');
  assert.match(dashboardPage, /storesService\.dashboard/);
  assert.match(dashboardPage, /recentRequisitions/);
  assert.match(dashboardPage, /to="\/stores\/request-stock"/);
  assert.doesNotMatch(dashboardPage, /No requisition entity\/workflow/);
  assert.match(dashboard, /fn_stores_dashboard/);
  assert.match(dashboard, /fn_stores_list_notifications/);
});
