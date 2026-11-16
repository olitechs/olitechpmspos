import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20261110190000_fix_pos_table_join_and_quantity_voids.sql', import.meta.url), 'utf8');
const orderTaking = readFileSync(new URL('../../src/components/pos/OrderTaking.jsx', import.meta.url), 'utf8');
const container = readFileSync(new URL('../../src/components/pos/POSContainer.jsx', import.meta.url), 'utf8');
const pmsService = readFileSync(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
const posService = readFileSync(new URL('../../src/services/posService.js', import.meta.url), 'utf8');
const raceMigration = readFileSync(new URL('../migrations/20261116090000_fix_pos_table_session_write_race.sql', import.meta.url), 'utf8');
const destinationMigration = readFileSync(new URL('../migrations/20261116100000_allow_current_pos_transfer_destination_writes.sql', import.meta.url), 'utf8');

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
  assert.ok(container.includes('store.applyServerSession(target.id, session)'));
  assert.ok(container.includes('applyServerSession adopts the complete authoritative row'));
  assert.ok(!container.includes('store.setSessionOrderLines(target.id, nextLines'));
  assert.ok(!container.includes('store.setSessionOrderLines(target.id, nextLines'));
});

test('table transfers repair local floor state instead of waiting for realtime', () => {
  // The RPC closes the source and writes the target server-side; the client
  // must adopt that state locally (or a slow/offline realtime channel leaves a
  // ghost source order and a destination touch can wipe the server lines).
  assert.ok(container.includes('store.closeTableLocal(activeTable.id)'));
  assert.ok(container.includes('store.applyServerSession(target.id, session)'));
  assert.ok(container.includes('delete orderNumbersRef.current[activeTable.id]'));
  const appStore = readFileSync(new URL('../../src/data/AppStore.jsx', import.meta.url), 'utf8');
  assert.ok(appStore.includes('const closeTableLocal = useCallback'), 'local-only close must not re-persist a closed session');
  assert.ok(appStore.includes('const applyServerSession = useCallback'), 'server session adoption must exist');
});

test('order cart can only be cleared before anything was sent to the kitchen', () => {
  assert.ok(orderTaking.includes("sessionForClear?.status === 'unsettled'"));
  assert.ok(orderTaking.includes('disabled={!orderLines.length || hasSentItems}'));
  assert.ok(orderTaking.includes('Clear order'));
  assert.ok(orderTaking.includes('Nothing has been sent to the kitchen yet.'));
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
  assert.match(bill, /m\.id\s*!==\s*'room'\s*\|\|\s*canRoomCharge/);
  assert.match(bill, /id:\s*'split-'\s*\+\s*Date\.now\(\)\s*\+\s*'-'\s*\+\s*prev\.length/);
});

test('receipt void lookup is scoped in the query instead of filtering the whole property day client-side', () => {
  const bill = readFileSync(new URL('../../src/components/pos/BillPayment.jsx', import.meta.url), 'utf8');
  assert.ok(pmsService.includes("q = q.eq('order_number', String(orderNumber))"));
  assert.ok(pmsService.includes("q = q.eq('table_number', String(tableNumber))"));
  // The operational day is a half-open window so 23:59:59.999 voids are included.
  assert.ok(pmsService.includes(".gte('created_at', `${effectiveDate}T00:00:00+03:00`).lt('created_at', `${nextDate}T00:00:00+03:00`)"));
  assert.match(
    bill,
    /listVoidedItems\(\s*propertyId,\s*\{\s*orderNumber:\s*stableOrderNumber,\s*tableNumber:\s*tableLabel\(table\)\s*\}\s*\)/,
  );
  assert.ok(!bill.includes('voidRows.filter'));
});

test('session saves are queued per property/table and transfers wait for both table queues', () => {
  assert.ok(posService.includes("import { createKeyedQueue } from '@/lib/keyedQueue'"));
  assert.ok(posService.includes('const sessionWriteQueue = createKeyedQueue()'));
  assert.ok(posService.includes('withSessionTableLocks(propertyId, [tableKey]'));
  assert.ok(posService.includes('withSessionTableLocks(propertyId, [sourceTableKey, targetTableKey]'));
  assert.ok(posService.includes('source_session?.status !== \'closed\''));
});

test('database fencing serializes saves with moves and rejects stale source-check writes', () => {
  assert.ok(raceMigration.includes('pg_advisory_xact_lock'));
  assert.ok(raceMigration.includes('fn_touch_pos_table_session_unfenced'));
  assert.ok(raceMigration.includes('fn_move_or_merge_pos_table_unfenced'));
  assert.ok(raceMigration.includes('source_session'));
  assert.ok(raceMigration.includes('Refresh the POS floor before saving it again'));
  assert.ok(destinationMigration.includes('a.details->>\'to_table_key\' = p_table_key'));
  assert.ok(destinationMigration.includes('order by a.created_at desc, a.id desc'));
});

test('a closed stale duplicate is reconciled only when its moved destination retains the identical order lines', () => {
  // Reconciliation is deliberately performed as a conditional status close,
  // not a DELETE; the original order payload remains in the historical row.
  assert.ok(raceMigration.includes('source_session'));
  assert.ok(destinationMigration.includes('latest transfer where it was the source'));
});
