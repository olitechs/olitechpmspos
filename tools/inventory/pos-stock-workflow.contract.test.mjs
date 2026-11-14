import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const billPayment = await read('../../src/components/pos/BillPayment.jsx');
const orderTaking = await read('../../src/components/pos/OrderTaking.jsx');
const floorPlan = await read('../../src/components/pos/FloorPlan.jsx');
const shiftReport = await read('../../src/pages/ShiftReport.jsx');
const pmsService = await read('../../src/services/pmsService.js');
const posSaleContract = await read('../../src/services/posSaleContract.js');
const storekeeper = await read('../../src/pages/StorekeeperDashboard.jsx');
const storekeeperCore = await read('../../src/services/storekeeperDashboardCore.js');
const inventory = await read('../../src/components/modules/Inventory.jsx');
const ledger = await read('../../supabase/migrations/20261008120000_phase4_authoritative_inventory_ledger.sql');
const posAuthority = await read('../../supabase/migrations/20261008160000_phase4_pos_inventory_authority.sql');
const saleRpc = await read('../../supabase/migrations/20261008071500_phase3_split_payments_and_indexes.sql');
const voidRefund = await read('../../supabase/migrations/20261008103000_phase3_void_refund_stock_settlement.sql');

 test('settled POS sale posts once through the receipt RPC and authoritative stock writer', () => {
  assert.match(billPayment, /pmsService\.recordPosSale\(/);
  assert.match(pmsService, /fn_record_pos_sale_with_vat_snapshot/);
  assert.match(posAuthority, /fn_apply_stock_movement\(v_product\.id,-v_qty/);
  assert.match(posAuthority, /''pos_sale'',null/i);
});

test('recipe menu quantities scale ingredient consumption by recipe yield', () => {
  assert.match(ledger, /fn_consume_recipe_stock/);
  assert.match(ledger, /ing\.qty\*\(v_order_qty\/greatest\(ing\.yield_qty,0\.001\)\)/i);
  assert.match(ledger, /fn_apply_stock_movement\(ing\.product_id,-v_needed/);
});

test('sent kitchen items retain a control-void record and full receipt void calls stock reversal', () => {
  assert.match(orderTaking, /pmsService\.removeOrderItem\(/);
  assert.match(orderTaking, /if\s*\(\s*!removeTarget\.sent\s*\)[\s\S]*?return/);
  assert.match(orderTaking, /const voidRow = result\?\.void/);
  assert.match(orderTaking, /result\?\.kot_sent_order_lines/);
  assert.match(orderTaking, /printVoidTicket/);
  assert.match(voidRefund, /fn_reverse_pos_stock\(a\.property_id,receipt\.items,1/);
});

test('cashier refunds flow through the approved adjustment transaction and invoke stock reversal', () => {
  assert.match(voidRefund, /adjustment_type='refund' and a\.target_type='pos_receipt'/);
  assert.match(voidRefund, /fn_reverse_pos_stock\(a\.property_id,receipt\.items,ratio/);
  assert.match(voidRefund, /remaining:=receipt\.total-already/);
});

test('split-tender validation requires valid allocations that total the receipt before commit', () => {
  assert.match(saleRpc, /p_payment_method='split'/);
  assert.match(saleRpc, /jsonb_array_elements\(p_payment_allocations\)/);
  assert.match(saleRpc, /round\(v_sum,2\)<>round\(p_total,2\)/);
});

test('negative stock is rejected by the shared stock movement contract', () => {
  assert.match(ledger, /Insufficient stock/i);
  assert.match(ledger, /for update/i);
});

test('duplicate sale retries use a unique receipt key and a stable order identity', () => {
  assert.match(saleRpc, /pos_receipts_property_idempotency_key_uidx/);
  assert.match(saleRpc, /idempotency_key=v_key/);
  assert.match(billPayment, /createPosSaleIdempotencyKey\(\{propertyId,tableKey:table\.id,orderNumber:stableOrderNumber\}\)/);
});

test('POS settlement verifies every Store mapping and blocks unlinked or invalid order lines', () => {
  assert.match(billPayment, /listPosStockMappings\(propertyId\)/);
  assert.match(billPayment, /resolvePosSaleStockMappings\(orderLines,stockMappings\.products,stockMappings\.recipes,true\)/);
  assert.match(billPayment, /if\(unlinkedStockItems\.length\)/);
  assert.match(billPayment, /if\(incompleteRecipeItems\.length\)/);
  assert.match(billPayment, /The sale was not recorded/);
  assert.match(posSaleContract, /stock_tracking_status/);
  assert.match(inventory, /Finalized POS sales deduct linked products and active recipe ingredients/);
  assert.doesNotMatch(inventory, /Automatic deduction on POS sale is planned/);
});

test('Storekeeper consumption reporting includes direct POS product movements', () => {
  assert.match(storekeeper, /isStockConsumptionMovement/);
  assert.match(storekeeperCore, /'pos_sale'/);
});

test('POS product grid supports search and explicit catalog loading, empty, error and retry states', () => {
  assert.match(orderTaking, /filterPosMenuItems\(categoryMenuItems, menuSearch\)/);
  assert.match(orderTaking, /type="search"/);
  assert.match(orderTaking, /Loading menu items/);
  assert.match(orderTaking, /No menu items match/);
  assert.match(orderTaking, /role="alert"/);
  assert.match(orderTaking, /Retry menu/);
  assert.match(orderTaking, /setMenuError\('The menu could not be loaded/);
});

test('floor, payment and shift-report screens expose meaningful waiting, empty or error feedback', () => {
  assert.match(floorPlan, /No floor zones configured/);
  assert.match(floorPlan, /No tables in \{zone\.name\}/);
  assert.match(billPayment, /Loading payment settings/);
  assert.match(shiftReport, /Loading shift history/);
  assert.match(shiftReport, /Retry/);
  assert.match(shiftReport, /No shift records match the selected filters/);
  assert.match(shiftReport, /role="alert"/);
});

// This is an application/SQL-source contract suite. Database behavior still
// needs the repository's authorized local/disposable runtime fixtures.
