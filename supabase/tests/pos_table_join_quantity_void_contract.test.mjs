import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20261110190000_fix_pos_table_join_and_quantity_voids.sql', import.meta.url), 'utf8');
const orderTaking = readFileSync(new URL('../../src/components/pos/OrderTaking.jsx', import.meta.url), 'utf8');
const container = readFileSync(new URL('../../src/components/pos/POSContainer.jsx', import.meta.url), 'utf8');

test('POS table joins aggregate all distinct lines in a single JSON array', () => {
  assert.match(migration, /jsonb_agg\\(merged\\.line order by merged\\.first_ord\\)/i);
  assert.match(migration, /group by md5\\(\\(q\\.line - 'qty' - 'quantity'\\)::text\\)/i);
  assert.match(migration, /'::join::'/i);
  assert.match(migration, /'{productId}'/i);
  assert.match(migration, /'{baseProductId}'/i);
  assert.match(migration, /v_merged_lines/i);
});

test('table move and join preserve VAT and kitchen-sent snapshots', () => {
  assert.match(migration, /vat_snapshot, kot_sent_order_lines/i);
  assert.match(migration, /v_merged_kot_lines/i);
  assert.match(migration, /v_source\\.vat_snapshot is distinct from v_target\\.vat_snapshot/i);
  assert.match(migration, /kot_sent_order_lines = v_merged_kot_lines/i);
});

test('joined table updates the local destination session before reopening it', () => {
  assert.match(container, /store\\.setSessionOrderLines\\(target\\.id, nextLines/);
  assert.match(container, /store\\.setKotSentOrderLines\\(/);
  assert.ok(container.indexOf("if (session.status === 'unsettled') store.setUnsettled(target.id)") < container.indexOf("store.setSessionOrderLines(target.id"));
});

test('POS item removal asks for an explicit quantity and validates the current line quantity', () => {
  assert.match(orderTaking, /Quantity to \\{removeTarget\\.sent \\? 'void' : 'remove'\\}/);
  assert.match(orderTaking, /max=\\{removeTarget\\.sent \\? removeTarget\\.sentQty : removeTarget\\.unsentQty\\}/);
  assert.match(orderTaking, /session\\?\\.kotSentOrderLines/);
  assert.match(orderTaking, /removeTarget\\.sentQty/);
  assert.match(orderTaking, /result\\?\\.kot_sent_order_lines/);
  assert.match(migration, /Cannot void more than the quantity already sent to production/);
  assert.match(migration, /kot_sent_order_lines=v_new_kot_lines/);
  assert.match(orderTaking, /Confirm Remove/);
});

test('sent item voids retain reason, manager approval and audited RPC controls', () => {
  assert.match(orderTaking, /A control void will be recorded/);
  assert.match(orderTaking, /Reason required/);
  assert.match(orderTaking, /verifyStaffPin/);
  assert.match(orderTaking, /pmsService\\.removeOrderItem/);
  assert.match(migration, /if p_remove_qty > v_original then[\\s\\S]*?Cannot void more items than the current quantity/i);
  assert.match(migration, /insert into public\\.pos_void_items/i);
  assert.match(migration, /insert into public\\.pos_order_audit/i);
});

test('recovered floor tables persist movement using their original configured layout ID', () => {
  const floor = readFileSync(new URL('../../src/components/pos/FloorPlan.jsx', import.meta.url), 'utf8');
  assert.match(floor, /const layoutId = table\\?\\.layoutId \\|\\| table\\?\\.id/);
  assert.match(floor, /store\\.moveTable\\(zone\\.id, layoutId, x, y\\)/);
});

test('split tender rows have stable identities and hide room-charge allocations from unauthorized roles', () => {
  const bill = readFileSync(new URL('../../src/components/pos/BillPayment.jsx', import.meta.url), 'utf8');
  assert.match(bill, /key=\\{p\\.id\\}/);
  assert.match(bill, /m\\.id!==\x27room\x27\\|\\|canRoomCharge/);
  assert.match(bill, /id:\x27split-\x27\\+Date\\.now\\(\\)\\+\x27-\x27\\+prev\\.length/);
});
