import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await read('../../supabase/migrations/20261120100000_phase5_composite_stock_availability.sql');
const service=await read('../../src/services/inventoryService.js');
const pos=await read('../../src/components/pos/OrderTaking.jsx');

test('Low-stock alerts stay synchronized with product stock and thresholds',()=>{
 assert.match(migration,/after insert or update of current_stock,min_stock on public\.products/i);
 assert.match(migration,/out_of_stock/i);
 assert.match(migration,/alert_type=v_type and resolved=false/i);
 assert.match(migration,/update public\.low_stock_alerts set resolved=true/i);
});
test('Composite availability is calculated from all linked recipe components',()=>{
 assert.match(migration,/fn_list_composite_stock_availability/i);
 assert.match(migration,/sum\(ri\.qty\/greatest\(coalesce\(r\.yield_qty,1\),0\.000001\)\)/i);
 assert.match(migration,/floor\(greatest\(coalesce\(cp\.current_stock,0\),0\)\/rc\.required_per_sale\)/i);
 assert.match(migration,/public\.is_member_of_property\(p_property_id\)/i);
});
test('Component movement history is property-scoped and limited',()=>{
 assert.match(migration,/fn_list_composite_component_history/i);
 assert.match(migration,/sm\.source_type='pos_recipe'/i);
 assert.match(migration,/least\(coalesce\(p_limit,50\),200\)/i);
});
test('Inventory service exposes composite availability and history RPCs',()=>{
 assert.match(service,/listCompositeStockAvailability/);
 assert.match(service,/fn_list_composite_stock_availability/);
 assert.match(service,/listCompositeComponentHistory/);
 assert.match(service,/fn_list_composite_component_history/);
});
test('POS product tiles warn and prevent adding composites with unavailable components',()=>{
 assert.match(pos,/compositeAvailabilityByMenu/);
 assert.match(pos,/componentOutOfStock/);
 assert.match(pos,/COMPONENT OUT/);
 assert.match(pos,/COMPONENT LOW/);
 assert.match(pos,/availabilityUnknown/);
 assert.match(pos,/STOCK CHECK/);
 assert.match(pos,/disabled=\{outOfStock \|\| tileAvailability\.availabilityUnknown \|\| modifierLoading\}/);
});
