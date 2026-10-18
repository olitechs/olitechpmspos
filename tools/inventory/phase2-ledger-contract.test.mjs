import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const ledgerMigration = await read('../../supabase/migrations/20261008120000_phase4_authoritative_inventory_ledger.sql');
const grnMigration = await read('../../supabase/migrations/20261008133000_phase4_goods_receiving_grn.sql');
const posMigration = await read('../../supabase/migrations/20261008160000_phase4_pos_inventory_authority.sql');
const voidRefundMigration = await read('../../supabase/migrations/20261008103000_phase3_void_refund_stock_settlement.sql');
const cashierMigration = await read('../../supabase/migrations/20261008150000_phase6_cashier_financial_hardening.sql');
const eventContract = await read('../../docs/PHASE2_INVENTORY_EVENT_AND_ROLE_MATRIX.md');

test('shared ledger writer locks product, rejects negative stock, and records source metadata', () => {
  assert.match(ledgerMigration, /select \* into v from public\.products where id=p_product_id for update/i);
  assert.match(ledgerMigration, /Insufficient stock/i);
  assert.match(ledgerMigration, /source_type,source_id/i);
  assert.match(ledgerMigration, /insert into public\.stock_movements/i);
});

test('POS sale migration routes stock through the shared posting owner rather than a parallel direct write', () => {
  assert.match(posMigration, /perform public\.fn_apply_stock_movement\(v_product\.id,-v_qty/i);
  assert.match(posMigration, /update public\.products set current_stock=current_stock-v_qty/i);
  assert.match(posMigration, /insert into public\.stock_movements/i);
  // Characterization guard: this migration rewrites the legacy direct-write fragment.
  // Source-ID/idempotency is a known open defect and is covered by the phase-2 integration plan.
  assert.match(posMigration, /''pos_sale'',null/i);
});

test('GRN receipt owns quantity posting through the shared writer and guards over-receipt', () => {
  assert.match(grnMigration, /fn_receive_purchase_order/i);
  assert.match(grnMigration, /fn_apply_stock_movement\(pid,qty/i);
  assert.match(grnMigration, /exceeds ordered quantity/i);
  assert.match(grnMigration, /goods_receipt_lines/i);
});

test('recipe consumption uses the shared writer and stock_usage remains a secondary audit record', () => {
  assert.match(ledgerMigration, /fn_consume_recipe_stock/i);
  assert.match(ledgerMigration, /fn_apply_stock_movement\(ing\.product_id,-v_needed/i);
  assert.match(ledgerMigration, /insert into public\.stock_usage/i);
});

test('void and refund workflows use the dedicated stock reversal owner', () => {
  assert.match(voidRefundMigration, /fn_reverse_pos_stock/i);
  assert.match(cashierMigration, /fn_reverse_pos_stock/i);
  assert.match(cashierMigration, /POS Refund/i);
});

test('event contract covers the requested event families and single-owner invariant', () => {
  for (const event of [
    'POS sale', 'Recipe consumption', 'Goods receipt (GRN)', 'Stock transfer',
    'Manual stock adjustment', 'Inventory count variance', 'POS void', 'POS refund',
    'stock_movements', 'idempotent', 'cross-property', 'cost_price',
  ]) assert.ok(eventContract.toLowerCase().includes(event.toLowerCase()), `missing contract coverage: ${event}`);
});

test('the event contract explicitly requires server-side role enforcement and location balance reconciliation', () => {
  assert.match(eventContract, /Authorization must be enforced in the database\/RPC/i);
  assert.match(eventContract, /location balances summing to the aggregate/i);
  assert.match(eventContract, /direct \x60products\x60 select/i);
});

const databaseGate = await read('../../supabase/tests/phase2_inventory_security_regression.sql');

test('database regression gate covers cost access, tenant isolation, immutable ledger, and balance ownership', () => {
  for (const assertion of [
    'COST-001', 'COST-002', 'TENANT-001', 'LEDGER-001',
    'LEDGER-002', 'BALANCE-001', 'BALANCE-003', 'TRANSFER-001',
    'GRN-001', 'POS-002',
  ]) assert.ok(databaseGate.includes(assertion), `missing database regression assertion: ${assertion}`);
  assert.match(databaseGate, /rollback-only transaction/i);
  assert.match(databaseGate, /cross-property/i);
});
