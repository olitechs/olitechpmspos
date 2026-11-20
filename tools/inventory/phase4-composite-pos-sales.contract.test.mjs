import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const migration=await read('../../supabase/migrations/20261120090000_phase4_atomic_composite_pos_sales.sql');
const menu=await read('../../src/components/pos/MenuManager.jsx');
const service=await read('../../src/services/inventoryService.js');
const pos=await read('../../src/components/pos/OrderTaking.jsx');

test('Composite sales resolve recipes by stable product ID and preserve legacy fallback',()=>{
 assert.match(migration,/r\.menu_product_id=v_menu_product_id/i);
 assert.match(migration,/r\.menu_product_id is null and lower\(btrim\(r\.menu_item_name\)\)/i);
 assert.match(migration,/greatest\(coalesce\(v_recipe\.yield_qty,1\),0\.000001\)/i);
});
test('Composite component stock deduction is serialized, idempotent and ledger-backed',()=>{
 assert.match(migration,/pg_advisory_xact_lock/i);
 assert.match(migration,/idempotency_key=v_key/i);
 assert.match(migration,/update public\.products set current_stock=coalesce\(current_stock,0\)-v_needed/i);
 assert.match(migration,/insert into public\.stock_movements/i);
 assert.match(migration,/recipe_version/i);
 assert.match(migration,/insert into public\.stock_usage/i);
 assert.match(migration,/negative_stock_policy/i);
});
test('POS menu hides inventory-only raw ingredients and consumables but preserves enabled sellable products',()=>{
 assert.match(migration,/p\.pos_enabled is true and p\.pos_active is true/i);
 assert.match(migration,/stock_item_type[\\s\\S]*raw_ingredient[\\s\\S]*consumable/i);
});
test('Category editor can route Kitchen or Bar and persists the category route',()=>{
 assert.match(menu,/Send category orders to/);
 assert.match(menu,/CENTER_OPTIONS\.map/);
 assert.match(menu,/productionCenter:draft\.production_center/);
 assert.match(service,/production_center: productionCenter/);
});
test('POS receives category production center for existing kitchen/bar printer routing',()=>{
 assert.match(migration,/drop function if exists public\.fn_list_pos_menu\(uuid\)/i);
 assert.match(migration,/inventory_tracking_mode text/i);
 assert.match(migration,/coalesce\(p\.inventory_tracking_mode,'direct'\)/i);
 assert.match(migration,/coalesce\(nullif\(c\.production_center,''\),p\.production_center,'Kitchen'\)/i);
 assert.match(pos,/inventory_tracking_mode: p\.inventory_tracking_mode \|\| 'direct'/i);
 assert.match(pos,/getPrinters\(propertyId\), getAssignments\(propertyId\)/);
});
