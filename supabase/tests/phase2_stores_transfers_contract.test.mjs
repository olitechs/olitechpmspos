import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const schema = read('../migrations/20261124100000_phase2_stores_transfers_schema.sql');
const functions = read('../migrations/20261124101000_phase2_stores_transfer_functions.sql');
const legacy = read('../migrations/20261124102000_phase2_stores_transfer_legacy_compat.sql');

const service = read('../../src/services/storesService.js');
const transfersScreen = read('../../src/components/modules/Transfers.jsx');
const statusBadge = read('../../src/components/stores/StoresStatusBadge.jsx');
const reportDefinitions = read('../../src/services/reportDefinitions.js');
const reportsPage = read('../../src/components/stores/StoresReportsPage.jsx');
const dashboard = read('../../src/pages/StorekeeperDashboard.jsx');
const dashboardService = read('../../src/services/storekeeperDashboardService.js');
const appRoutes = read('../../src/routes/AppRoutes.jsx');
const navArchitecture = read('../../src/data/modules/navArchitecture.js');
const authService = read('../../src/services/authService.js');
const appShell = read('../../src/components/layout/AppShell.jsx');
const permissions = read('../../src/lib/permissions.js');

test('phase 2 schema adds transfer documents, stable lines and scoped access', () => {
  for (const column of [
    'document_no', 'expected_at', 'dispatched_at', 'dispatched_by_staff_id',
    'received_at', 'received_by_staff_id', 'discrepancies', 'is_overdue',
  ]) {
    assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `missing column ${column}`);
  }

  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.stock_transfer_lines\b/);
  assert.match(schema, /stock_transfer_lines[\s\S]*?line_no integer NOT NULL/);
  assert.match(schema, /stock_transfer_lines[\s\S]*?dispatched_qty numeric/);
  assert.match(schema, /stock_transfer_lines[\s\S]*?received_qty numeric/);
  assert.match(schema, /UNIQUE \(transfer_id, line_no\)/);
  assert.match(schema, /stock_transfers_property_document_no_key/);
  assert.match(schema, /'pending', 'draft', 'dispatched', 'in_transit', 'received',[\s\S]*?'completed', 'discrepancy', 'cancelled'/);
  assert.match(schema, /ALTER TABLE public\.stock_transfer_lines ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE ON public\.stock_transfers FROM anon, authenticated/);
  assert.match(schema, /fn_subscription_module_allowed\(property_id, 'store'\)/);
});

test('phase 2 schema extends audit and notification vocabularies for transfers', () => {
  assert.match(schema, /'stock_transfer'/);
  for (const kind of [
    'transfer_created', 'transfer_dispatched', 'transfer_received',
    'transfer_discrepancy', 'transfer_overdue', 'transfer_cancelled',
  ]) {
    assert.match(schema, new RegExp(`'${kind}'`), `missing notification kind ${kind}`);
  }
  assert.match(schema, /stock_internal\.fn_stores_transfer_audit/);
  assert.match(schema, /actor_user_id, actor_staff_id, before, after, reason/);
  assert.match(schema, /auth\.uid\(\), public\.current_staff_id\(p_property_id\), p_before, p_after, p_reason/);
});

test('legacy transfer rows are backfilled with gap-free TRF numbers and line identities', () => {
  assert.match(schema, /stock_internal\.fn_stores_transit_location\(p_property_id uuid\)/);
  assert.match(schema, /VALUES \(p_property_id, 'In Transit'\)/);
  assert.match(schema, /stock_internal\.fn_stores_allocate_number\(\s*v_transfer\.property_id, 'stores_transfer', 'TRF'\s*\)/);
  assert.match(schema, /jsonb_array_elements\(COALESCE\(t\.lines, '\[\]'::jsonb\)\)/);
  assert.match(schema, /stock_internal\.fn_stores_transfer_lines_json\(t\.id\)/);
  assert.match(schema, /'id', l\.id,\s*'line_id', l\.id/);
});

test('phase 2 lifecycle uses only the ledger posting service for physical moves', () => {
  for (const rpc of [
    'fn_stores_list_transfers', 'fn_stores_transfer_detail',
    'fn_stores_transfer_products', 'fn_stores_create_transfer',
    'fn_stores_dispatch_transfer', 'fn_stores_receive_transfer',
    'fn_stores_cancel_transfer', 'fn_stores_mark_transfers_overdue',
  ]) {
    assert.match(functions, new RegExp(`FUNCTION public\\.${rpc}\\b`), `missing RPC ${rpc}`);
  }

  assert.match(functions, /PERFORM stock_internal\.fn_stores_post_move\(/);
  assert.match(functions, /'dispatch:' \|\| v_line\.id::text/);
  assert.match(functions, /'receive:' \|\| v_line\.id::text/);
  assert.match(functions, /INSERT INTO public\.stock_transfer_lines\(\s*id, property_id, transfer_id, line_no/);

  const createBody = functions.slice(
    functions.indexOf('FUNCTION public.fn_stores_create_transfer'),
    functions.indexOf('FUNCTION public.fn_stores_dispatch_transfer'),
  );
  assert.doesNotMatch(createBody, /fn_stores_post_movement|fn_stores_post_move/);

  const cancelBody = functions.slice(
    functions.indexOf('FUNCTION public.fn_stores_cancel_transfer'),
    functions.indexOf('FUNCTION public.fn_stores_mark_transfers_overdue'),
  );
  assert.doesNotMatch(cancelBody, /fn_stores_post_movement|fn_stores_post_move/);
});

test('dispatch and receive enforce permission, entitlement, property, SoD and discrepancy rules', () => {
  assert.match(functions, /fn_stores_assert\(p_property_id, 'stores\.stock\.transfer'\)/);
  assert.match(functions, /fn_stores_assert\(p_property_id, 'stores\.stock\.receive'\)/);
  assert.match(functions, /fn_stores_assert_any\(\s*p_property_id,\s*ARRAY\['stores\.stock\.transfer','stores\.stock\.receive','stores\.inventory\.view'\]/);
  assert.match(functions, /WHERE id = p_transfer_id\s+AND property_id = p_property_id\s+FOR UPDATE/);
  assert.match(functions, /v_settings\.segregation_of_duties\s+AND NOT public\.is_platform_owner\(\)/);
  assert.match(functions, /The dispatcher cannot confirm receipt when segregation of duties is enabled/);
  assert.match(functions, /THEN 'discrepancy' ELSE 'completed' END/);
  assert.match(functions, /difference_qty', l\.received_qty - l\.qty/);
  assert.match(functions, /overdue_notified_at = now\(\)/);
});

test('legacy RPC signatures remain but delegate to the guarded lifecycle', () => {
  assert.match(legacy, /FUNCTION public\.fn_create_stock_transfer\(\s*p_property_id uuid,\s*p_from uuid,\s*p_to uuid,\s*p_lines jsonb,\s*p_reference text DEFAULT NULL::text\s*\)/);
  assert.match(legacy, /public\.fn_stores_create_transfer\(/);
  assert.match(legacy, /FUNCTION public\.fn_complete_stock_transfer\(p_transfer_id uuid\)/);
  assert.match(legacy, /public\.fn_stores_dispatch_transfer\(v_property_id, p_transfer_id\)/);
  assert.match(legacy, /public\.fn_stores_receive_transfer\(v_property_id, p_transfer_id, '\{\}'::jsonb\)/);
  assert.doesNotMatch(legacy, /(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.product_stock_locations/i);
});

test('frontend service exposes only server-authoritative transfer RPCs', () => {
  for (const rpc of [
    'fn_stores_list_transfers', 'fn_stores_transfer_detail',
    'fn_stores_transfer_products', 'fn_stores_create_transfer',
    'fn_stores_dispatch_transfer', 'fn_stores_receive_transfer',
    'fn_stores_cancel_transfer', 'fn_stores_mark_transfers_overdue',
  ]) {
    assert.match(service, new RegExp(`rpc\\('${rpc}'`), `missing RPC wrapper ${rpc}`);
  }
  assert.doesNotMatch(service, /\.from\(/);
});

test('shared transfer screen uses storesService, dispatch/receive and printable notes', () => {
  assert.match(transfersScreen, /storesService\.listTransfers/);
  assert.match(transfersScreen, /storesService\.createTransfer/);
  assert.match(transfersScreen, /storesService\.dispatchTransfer/);
  assert.match(transfersScreen, /storesService\.receiveTransfer/);
  assert.match(transfersScreen, /storesService\.cancelTransfer/);
  assert.match(transfersScreen, /DocumentExportMenu/);
  assert.match(transfersScreen, /buildStoresTransferNoteDefinition/);
  assert.match(transfersScreen, /Overdue only/);
  assert.match(transfersScreen, /received_qty/);
  assert.doesNotMatch(transfersScreen, /\bsupabase\b/);
  assert.match(statusBadge, /pending:/);
  assert.match(statusBadge, /dispatched:/);
  assert.match(statusBadge, /completed:/);
});

test('transfer routes, navigation and path rules are registered and permission-gated', () => {
  assert.match(appRoutes, /path="transfers" element={<Transfers workspace="stores"\/>}/);
  assert.match(appRoutes, /path="inventory\/transfer-orders" element={<Transfers workspace="backoffice"\/>}/);
  assert.match(appRoutes, /path="reports\/transfers" element={<StoresReportsPage initialTab="transfers"\/>}/);
  assert.match(appRoutes, /import Transfers from "@\/components\/modules\/Transfers"/);

  assert.ok(navArchitecture.includes("'/stores/transfers'"));
  assert.ok(navArchitecture.includes("'/backoffice/inventory/transfer-orders'"));
  assert.equal((navArchitecture.match(/'\/stores\/reports\/transfers'/g) || []).length, 1);

  assert.ok(authService.includes("[/^\\/backoffice\\/inventory\\/transfer-orders(?:\\/|$)/, 'stores.stock.transfer']"));
  assert.ok(authService.includes("[/^\\/stores\\/reports\\/transfers(?:\\/|$)/, 'stores.stock.transfer']"));
  const legacyTransferRule = authService.indexOf('backoffice\\/inventory\\/transfer-orders');
  const genericInventoryRule = authService.indexOf('backoffice\\/inventory(?:');
  assert.ok(legacyTransferRule > -1 && genericInventoryRule > -1 && legacyTransferRule < genericInventoryRule);

  assert.match(appShell, /transfers: 'stores\.stock\.transfer'/);
  assert.match(appShell, /'transfer-reports': 'stores\.stock\.transfer'/);
  assert.match(navArchitecture, /standard:\['frontoffice','pos'\]/);

  for (const code of [
    'stores.requisition.create', 'stores.requisition.view', 'stores.requisition.approve',
    'stores.requisition.issue', 'stores.requisition.receive', 'stores.issue.void',
    'stores.costs.view', 'stores.costcentre.manage',
  ]) {
    assert.ok(permissions.includes(`code: '${code}'`), `missing UI catalog mirror ${code}`);
  }
});

test('reports expose the transfer register and printable transfer note without costs', () => {
  assert.match(reportDefinitions, /export function buildStoresTransferRegisterDefinition/);
  assert.match(reportDefinitions, /export function buildStoresTransferNoteDefinition/);
  assert.match(reportDefinitions, /key: 'stores-transfer-register'/);
  assert.match(reportDefinitions, /key: 'stores-transfer-note'/);
  assert.match(reportDefinitions, /No cost values are printed/);
  assert.match(reportDefinitions, /overdue: row\.is_overdue \? 'Yes' : 'No'/);

  assert.match(reportsPage, /initialTab = 'requisitions'/);
  assert.match(reportsPage, /\['transfers', 'Transfers'\]/);
  assert.match(reportsPage, /storesService\.listTransfers\(propertyId/);
  assert.match(reportsPage, /buildStoresTransferRegisterDefinition\(context\)/);
});

test('storekeeper dashboard shows canonical transfer state, document number, overdue and discrepancy', () => {
  assert.match(dashboard, /\['pending', 'in_transit', 'dispatched'\]/);
  assert.doesNotMatch(dashboard, /awaiting_confirmation|'sent'|'submitted'/);
  assert.match(dashboard, /transfer\.document_no \|\| transfer\.reference/);
  assert.match(dashboard, /overdueTransferCount/);
  assert.match(dashboard, /discrepancyTransfers\.length/);
  assert.match(dashboard, />Overdue</);
  assert.match(dashboard, />Discrepancy</);
  assert.match(dashboard, /location_name_snapshot \|\| movement\.product\?\.location/);
  assert.match(dashboardService, /location_name_snapshot/);
});
