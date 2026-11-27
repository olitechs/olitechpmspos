import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../migrations/20261127120000_phase4b_reporting_permission_and_reconciliation.sql');
const reportingService = read('../../src/services/reportingService.js');
const storekeeperDashboardService = read('../../src/services/storekeeperDashboardService.js');
const storesService = read('../../src/services/storesService.js');
const reportDefinitions = read('../../src/services/reportDefinitions.js');
const storesReportsPage = read('../../src/components/stores/StoresReportsPage.jsx');
const reportsPage = read('../../src/components/modules/Reports.jsx');
const documentExportMenu = read('../../src/components/shared/DocumentExportMenu.jsx');
const reportExportService = read('../../src/services/reportExportService.js');
const reportExportCore = read('../../src/services/reportExportCore.js');
const reportExportAuditCore = read('../../src/services/reportExportAuditCore.js');
const packExports = read('../../src/services/packExports/index.js');
const stockWorkbook = read('../../src/services/packExports/stockWorkbook.js');
const storePage = read('../../src/pages/Store.jsx');
const frontOfficeDashboard = read('../../src/pages/FrontOfficeDashboard.jsx');
const frontOfficeStatistics = read('../../src/pages/FrontOfficeStatistics.jsx');
const packExportDataService = read('../../src/services/packExportDataService.js');
const shiftService = read('../../src/services/shiftService.js');

test('Phase 4B is a forward-only correction migration with explicit deployment governance', () => {
  assert.match(migration, /^-- Phase 4B/m);
  assert.ok(migration.includes('Forward-only correction layer'));
  assert.ok(migration.includes('applied-state preflight'));
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+public\.staff\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE[\s\S]*?DROP\s+COLUMN/i);

  for (const name of [
    'fn_phase4b_management_report',
    'fn_phase4b_reconciliation_report',
    'fn_phase4b_stores_requisitions',
    'fn_phase4b_stores_issue_notes',
    'fn_phase4b_stores_transfers',
  ]) {
    assert.ok(migration.includes(`CREATE OR REPLACE FUNCTION public.${name}(`), `missing corrected RPC ${name}`);
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${name}`), `missing revoke for ${name}`);
    assert.ok(migration.includes(`GRANT EXECUTE ON FUNCTION public.${name}`), `missing grant for ${name}`);
  }
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test('corrected management RPC derives room and POS revenue from posted transactional sources', () => {
  assert.match(migration, /public\.fn_employee_has_permission\(p_property_id, 'back_office\.reports\.view'\)/);
  assert.match(migration, /FROM public\.folio_charges c[\s\S]*?c\.source = 'room'[\s\S]*?c\.reversal_of_id IS NULL[\s\S]*?rev\.reversal_of_id = c\.id/);
  assert.match(migration, /FROM public\.payments p[\s\S]*?p\.status = 'posted'/);
  assert.match(migration, /room_payments AS \([\s\S]*?p\.folio_charge_id IN \(SELECT id FROM room_charges\)/);
  assert.match(migration, /p\.folio_charge_id IS NULL[\s\S]*?p\.reservation_id IN \(SELECT reservation_id FROM room_charges\)[\s\S]*?p\.reservation_id NOT IN \(SELECT reservation_id FROM mixed_reservations\)/);
  assert.match(migration, /'room_payments_excluded_from_variance'/);
  assert.match(migration, /SELECT[\s\S]*?COALESCE\(SUM\(r\.subtotal\), 0\)[\s\S]*?FROM public\.pos_receipts r[\s\S]*?r\.status = 'posted'/);
  assert.match(migration, /v_pos_posted_total - \(v_pos_subtotal - v_pos_discount \+ v_pos_tax\)/);
  assert.match(migration, /'pos_net', round\(v_pos_posted_total - v_refunds, 2\)/);
  assert.match(migration, /FROM public\.pos_receipt_payments a[\s\S]*?JOIN public\.pos_receipts r ON r\.id = a\.receipt_id[\s\S]*?a\.property_id = p_property_id[\s\S]*?r\.property_id = p_property_id/);

  const voidBucket = migration.slice(migration.indexOf('INTO v_voids'), migration.indexOf('INTO v_split_total'));
  assert.match(voidBucket, /r\.status = 'voided'/);
  assert.match(voidBucket, /COALESCE\(r\.voided_at, r\.created_at\)/);
  assert.doesNotMatch(voidBucket, /r\.status = 'posted'/);
});

test('corrected management RPC masks valuation and exposes explicit reconciliation variances', () => {
  assert.match(migration, /public\.fn_employee_has_permission\(p_property_id, 'stores\.inventory\.valuation\.view'\)/);
  assert.match(migration, /jsonb_build_object\('valuation', NULL, 'valuation_restricted', true\)/);
  assert.match(migration, /'valuation_restricted', false/);
  for (const key of ['room_revenue_variance', 'pos_tax_discount_variance', 'pos_split_tender_variance', 'voids_excluded']) {
    assert.ok(migration.includes(`'${key}'`), `missing reconciliation key ${key}`);
  }
});

test('legacy management RPC is forward-corrected so fallback callers cannot receive valuation', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_management_report(');
  const end = migration.indexOf('REVOKE ALL ON FUNCTION public.fn_management_report', start);
  assert.ok(start >= 0 && end > start, 'missing forward correction for fn_management_report');
  const legacy = migration.slice(start, end);

  assert.match(legacy, /RETURNS jsonb/);
  assert.match(legacy, /public\.is_member_of_property\(p_property_id\)/);
  assert.doesNotMatch(legacy, /'back_office\.reports\.view'/, 'legacy access scope must stay unchanged for the dashboard fallback');
  assert.match(legacy, /public\.fn_employee_has_permission\(p_property_id, 'stores\.inventory\.valuation\.view'\)/);
  assert.match(legacy, /IF v_can_view_valuation THEN[\s\S]*?current_stock \* p\.cost_price[\s\S]*?END IF;/);
  assert.match(legacy, /'valuation', CASE WHEN v_can_view_valuation THEN round\(v_inventory_value, 2\) ELSE NULL::numeric END/);
  assert.match(legacy, /'valuation_restricted', NOT v_can_view_valuation/);
  assert.doesNotMatch(legacy, /fn_phase4b_management_report/, 'legacy wrapper must not recurse into the corrected function');
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_management_report\(uuid, date, date\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_management_report\(uuid, date, date\) TO authenticated/);
});

test('store dashboard keeps a scoped POS snapshot instead of the full management report', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_phase4b_store_sales_snapshot(');
  const end = migration.indexOf('REVOKE ALL ON FUNCTION public.fn_phase4b_store_sales_snapshot', start);
  assert.ok(start >= 0 && end > start, 'missing scoped store sales snapshot RPC');
  const snapshot = migration.slice(start, end);

  assert.match(snapshot, /public\.fn_employee_has_permission\(p_property_id, 'stores\.access'\)/);
  assert.match(snapshot, /FROM public\.pos_receipts r[\s\S]*?r\.status = 'posted'/);
  assert.match(snapshot, /FROM public\.cashier_refunds f/);
  assert.match(snapshot, /FROM public\.pos_receipt_payments a/);
  assert.match(snapshot, /'pos_net', round\(v_pos_posted_total - v_refunds, 2\)/);
  assert.doesNotMatch(snapshot, /current_stock|cost_price|valuation|folio_charges|hotel/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_phase4b_store_sales_snapshot\(uuid, date, date\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_phase4b_store_sales_snapshot\(uuid, date, date\) TO authenticated/);

  assert.match(reportingService, /async getStoreSalesSnapshot\(propertyId, from, to\)/);
  assert.match(reportingService, /rpc\('fn_phase4b_store_sales_snapshot', args\)/);
  assert.equal((storekeeperDashboardService.match(/getManagementReport\(/g) || []).length, 0);
  assert.equal((storekeeperDashboardService.match(/getStoreSalesSnapshot\(/g) || []).length, 3);
});

test('reconciliation evidence RPC reports capped source lines, counts and truncation flags', () => {
  assert.match(migration, /v_cap integer := 500/);
  for (const key of ['folio_lines', 'payment_lines', 'posted_receipts', 'refunds', 'voids', 'allocations']) {
    assert.ok(migration.includes(`'${key}'`), `missing evidence bucket ${key}`);
    assert.ok(migration.includes(`'${key}', v_` ), `missing truncation flag ${key}`);
  }
  assert.match(migration, /'row_cap', v_cap/);
  assert.match(migration, /'can_view_costs', stock_internal\.fn_stores_can_view_costs\(p_property_id\)/);
  assert.doesNotMatch(migration, /card_number|phone_number|guest_email/);
});

test('Stores report RPCs filter dates server-side, cap rows and withhold cost fields', () => {
  for (const fn of ['fn_phase4b_stores_requisitions', 'fn_phase4b_stores_issue_notes', 'fn_phase4b_stores_transfers']) {
    const body = migration.slice(migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`));
    const nextBoundary = body.indexOf('CREATE OR REPLACE FUNCTION public.', 1);
    const section = nextBoundary > 0 ? body.slice(0, nextBoundary) : body;
    assert.match(section, /p_from date DEFAULT NULL/);
    assert.match(section, /p_to date DEFAULT NULL/);
    assert.match(section, /p_limit integer DEFAULT 500/);
    assert.match(section, /LEAST\(GREATEST\(COALESCE\(p_limit, 500\), 1\), 500\)/);
    assert.match(section, /LIMIT v_cap/);
    assert.match(section, /'truncated', v_total > v_cap/);
    assert.match(section, /public\.is_member_of_property|stock_internal\.fn_stores_assert_any/);
    assert.doesNotMatch(section, /cost_price|unit_cost|total_cost|stock_value/i);
  }
  assert.match(migration, /public\.fn_stores_can_view_all_requisitions\(p_property_id\)/);
  assert.match(migration, /issue_note_lines l[\s\S]*?l\.discrepancy_qty > 0/);
  assert.match(migration, /stock_internal\.fn_stores_transfer_permissions\(p_property_id\)/);
});

test('client wrappers call corrected RPCs without client-side date truncation', () => {
  for (const [method, rpc] of [
    ['listRequisitionReport', 'fn_phase4b_stores_requisitions'],
    ['listIssueNoteReport', 'fn_phase4b_stores_issue_notes'],
    ['listTransferReport', 'fn_phase4b_stores_transfers'],
  ]) {
    assert.ok(storesService.includes(`${method}(propertyId`), `missing ${method}`);
    assert.ok(storesService.includes(`rpc('${rpc}'`), `missing ${rpc} wrapper`);
  }
  assert.match(storesService, /p_from: from,[\s\S]*?p_to: to,[\s\S]*?p_limit: limit/);
  assert.match(storesReportsPage, /data\?\.rows/);
  assert.match(storesReportsPage, /data\?\.cap/);
  assert.match(storesReportsPage, /data\?\.truncated/);
  assert.ok(!storesReportsPage.includes('.filter('), 'Stores reports must not filter server-capped rows again in the browser');
  assert.match(storesReportsPage, /Report truncated: only the first \{cap\} server-filtered rows/);
  assert.match(storesReportsPage, /executeAuditedReportExport\(\{[\s\S]*?format: 'csv'/);
});

test('management screen hides valuation without permission and renders reconciliation', () => {
  assert.match(reportsPage, /hasPermissionCode\(user, 'stores\.inventory\.valuation\.view'\)/);
  assert.match(reportsPage, /canViewValuation/);
  assert.match(reportsPage, /Financial reconciliation/);
  assert.match(reportsPage, /room_revenue_variance/);
  assert.match(reportsPage, /pos_tax_discount_variance/);
  assert.match(reportsPage, /pos_split_tender_variance/);
  assert.match(reportsPage, /voids_excluded/);
  assert.match(reportsPage, /valuation_restricted !== true/);
  assert.match(reportDefinitions, /Inventory valuation is withheld because the current role does not have stores\.inventory\.valuation\.view/);
});

test('every report download or print preview goes through the audited wrapper', () => {
  assert.match(reportExportAuditCore, /AUDITED_REPORT_FORMATS = new Set\(\['csv', 'xlsx', 'pdf'\]\)/);
  assert.match(reportExportCore, /await recordAudit\(/);
  assert.match(reportExportCore, /await deliver\(/);
  assert.ok(reportExportCore.indexOf('await recordAudit(') < reportExportCore.indexOf('await deliver('), 'audit must precede delivery');
  assert.match(reportExportService, /createAuditedReportExecutor/);
  assert.match(reportExportService, /reportExportAuditService\.record\(event\)/);
  assert.match(documentExportMenu, /format === 'print' \? 'pdf' : format/);
  assert.match(documentExportMenu, /formats = \['pdf', 'excel', 'csv', 'print'\]/);
  assert.doesNotMatch(documentExportMenu, /createExcelBlob|createPdfBlob|downloadBlob|openPdfPreview|reportExportAuditService/);
  assert.doesNotMatch(packExports, /downloadBlob|downloadPackWorkbook/);

  for (const file of [reportsPage, storesReportsPage, storePage, frontOfficeDashboard, frontOfficeStatistics]) {
    assert.match(file, /executeAuditedReportExport/);
    assert.doesNotMatch(file, /downloadBlob\(|reportExportAuditService\.record\(/);
  }
  assert.doesNotMatch(frontOfficeStatistics, /URL\.createObjectURL|new Blob\(|createElement\('a'\)/);
});

test('restricted stock workbooks omit cost columns through the audited export path', () => {
  assert.match(storePage, /hasPermissionCode\(user, 'stores\.costs\.view'\)/);
  assert.match(storePage, /withoutCostData\(extract\)/);
  assert.match(storePage, /includeCosts:canViewCosts/);
  assert.match(stockWorkbook, /const positionColumns = \(includeCosts\)/);
  assert.match(stockWorkbook, /includeCosts \? \['Cost price'\] : \[\]/);
  assert.match(stockWorkbook, /Cost, stock-value and margin columns are omitted/);
  assert.doesNotMatch(stockWorkbook, /writeTableHeader\(worksheet, 8, \['Date', 'Product ID'/);
  assert.match(storePage, /Stock Value',showCost\?/);
});

test('workbook lookups and shift reports are scoped to the active property', () => {
  assert.match(packExportDataService, /fetchByIds = async \(table, select, ids, propertyId\)/);
  assert.match(packExportDataService, /\.eq\('property_id', propertyId\)/);
  assert.match(packExportDataService, /from\('staff_directory'\)/);
  assert.match(packExportDataService, /\.in\('user_id', chunk\)/);
  assert.doesNotMatch(packExportDataService, /from\('profiles'\)/);
  assert.match(packExportDataService, /const isLegacyShiftSchemaError = \(error\)/);
  assert.match(packExportDataService, /if \(!isLegacyShiftSchemaError\(error\)\) throw error/);
  assert.match(packExportDataService, /wrapped\.code = error\.code/);
  assert.match(shiftService, /async getShiftReport\(shiftId, propertyId\)/);
  assert.match(shiftService, /\.eq\('property_id', propertyId\)[\s\S]*?\.eq\('id', shiftId\)/);
  assert.match(shiftService, /async printData\(shiftId, propertyId\)/);
});

test('legacy management RPC fallback is explicit and missing-RPC detection is narrow', () => {
  assert.match(reportingService, /fn_phase4b_management_report/);
  assert.match(reportingService, /isMissingRpc\(corrected\.error, 'fn_phase4b_management_report'\)/);
  assert.match(reportingService, /fn_management_report/);
  assert.match(reportingService, /phase4bSource: 'legacy'/);
  assert.match(reportingService, /phase4bSource: 'corrected'/);
  assert.match(reportingService, /unavailable: true/);
  assert.match(reportingService, /error\?\.code === 'PGRST202'/);
  assert.match(reportingService, /withoutValuation/);
  assert.match(reportingService, /canViewValuation = false/);
  assert.match(reportingService, /valuation_restricted: true/);
  assert.match(reportsPage, /getManagementReport\(propertyId, from, to, \{ canViewValuation \}\)/);
});
