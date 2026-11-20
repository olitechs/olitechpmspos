import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await read('../../supabase/migrations/20261120110000_phase7_composite_refunds_and_voids.sql');
const consumption=await read('../../supabase/migrations/20261120090000_phase4_atomic_composite_pos_sales.sql');

test('Composite component movements are attached to the exact receipt inserted by the sale RPC',()=>{
 assert.match(consumption,/set_config\('olitechs\.pos_composite_movement_ids'/i);
 assert.match(migration,/trg_link_pos_composite_movements_to_receipt/i);
 assert.match(migration,/set source_id=new\.id/i);
 assert.match(migration,/source_type='pos_recipe'/i);
});

test('Partial composite refunds use original receipt line quantities and component movement snapshots',()=>{
 assert.match(migration,/p_items jsonb/i);
 assert.match(migration,/line_index/i);
 assert.match(migration,/v_original_qty/i);
 assert.match(migration,/v_component_per_unit/i);
 assert.match(migration,/source_line_key like v_line::text\|\|':%'/i);
});

test('Partial refunds reject quantities above the unrefunded component balance',()=>{
 assert.match(migration,/v_restore>v_remaining\+0\.000001/i);
 assert.match(migration,/Refund exceeds the remaining unrefunded component quantity/i);
 assert.match(migration,/p_allow_remaining then/i);
});

test('Refunds are idempotent and preserve an auditable reversal link',()=>{
 assert.match(migration,/idempotency_key=v_key/i);
 assert.match(migration,/reversal_of_id\)/i);
 assert.match(migration,/source_type='pos_recipe_refund'/i);
 assert.match(migration,/type,qty,reason,user_id,source_type,source_id/i);
});

test('Full receipt void restores remaining composite components in the same transaction',()=>{
 assert.match(migration,/fn_reverse_pos_composite_stock\(/i);
 assert.match(migration,/receipt-void:'\|\|r\.id::text/i);
 assert.match(migration,/set receipt_status='void'/i);
 assert.match(migration,/if r\.folio_charge_id is not null then/i);
});

test('Refund and void RPCs retain property permission checks',()=>{
 assert.match(migration,/fn_has_permission\(p_property_id,'receipts\.void'\)/i);
 assert.match(migration,/where id=p_receipt_id and property_id=p_property_id for update/i);
 assert.match(migration,/sm\.property_id=p_property_id/i);
});
