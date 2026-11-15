import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20261110190000_fix_pos_table_join_and_quantity_voids.sql', import.meta.url), 'utf8');
const orderTaking = readFileSync(new URL('../../src/components/pos/OrderTaking.jsx', import.meta.url), 'utf8');
const container = readFileSync(new URL('../../src/components/pos/POSContainer.jsx', import.meta.url), 'utf8');

test('POS table joins aggregate all distinct lines in a single JSON array', () => {
  assert.ok(migration.includes('jsonb_agg(merged.line order by merged.first_ord)'));
  assert.ok(migration.includes('group by md5((q.line - \'qty\' - \'quantity\')::text)'));
  assert.ok(migration.includes("'::join::'"));
  assert.ok(migration.includes("'{productId}'"));
  assert.ok(migration.includes("'{baseProductId}'"));
  assert.ok(migration.includes('v_merged_lines'));
});

test('table move and join preserve VAT and kitchen-sent snapshots', () => {
  assert.ok(migration.includes('vat_snapshot, kot_sent_order_lines'));
  assert.ok(migration.includes('v_merged_kot_lines'));
  assert.ok(migration.includes('v_source.vat_snapshot is distinct from v_target.vat_snapshot'));
  assert.ok(migration.includes('kot_sent_order_lines = v_merged_kot_lines'));
});

test('joined table updates the local destination session before reopening it', () => {
  assert.ok(container.includes('store.setSessionOrderLines(target.id, nextLines'));
  assert.ok(container.includes('store.setKotSentOrderLines('));
  assert.ok(container.indexOf("if (session.status === 'unsettled') store.setUnsettled(target.id)") < container.indexOf('store.setSessionOrderLines(target.id'));
});

test('POS item removal asks for an explicit quantity and validates the current line quantity', () => {
  assert.ok(orderTaking.includes("Quantity to {removeTarget.sent ? 'void' : 'remove'}"));
  assert.ok(orderTaking.includes('max={removeTarget.sent ? removeTarget.sentQty : removeTarget.unsentQty}'));
  assert.ok(orderTaking.includes('session?.kotSentOrderLines'));
  assert.ok(orderTaking.includes('removeTarget.sentQty'));
  assert.ok(orderTaking.includes('result?.kot_sent_order_lines'));
  assert.ok(migration.includes('Cannot void more than the quantity already sent to production'));
  assert.ok(migration.includes('kot_sent_order_lines=v_new_kot_lines'));
  assert.ok(orderTaking.includes('Confirm Remove'));
});

test('sent item voids retain reason, manager approval and audited RPC controls', () => {
  assert.ok(orderTaking.includes('A control void will be recorded'));
  assert.ok(orderTaking.includes('Reason required'));
  assert.ok(orderTaking.includes('verifyStaffPin'));
  assert.ok(orderTaking.includes('pmsService.removeOrderItem'));
  assert.ok(migration.includes('Cannot void more items than the current quantity'));
  assert.ok(migration.includes('insert into public.pos_void_items'));
  assert.ok(migration.includes('insert into public.pos_order_audit'));
});

test('recovered floor tables persist movement using their original configured layout ID', () => {
  const floor = readFileSync(new URL('../../src/components/pos/FloorPlan.jsx', import.meta.url), 'utf8');
  assert.ok(floor.includes('const layoutId = table?.layoutId || table?.id;'));
  assert.ok(floor.includes('store.moveTable(zone.id, layoutId, x, y)'));
});

test('split tender rows have stable identities and hide room-charge allocations from unauthorized roles', () => {
  const bill = readFileSync(new URL('../../src/components/pos/BillPayment.jsx', import.meta.url), 'utf8');
  assert.ok(bill.includes('key={p.id}'));
  assert.ok(bill.includes("m.id!=='room'||canRoomCharge"));
  assert.ok(bill.includes("id:'split-'+Date.now()+'-'+prev.length"));
});
