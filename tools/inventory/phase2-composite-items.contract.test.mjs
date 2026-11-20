import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read('../../supabase/migrations/20261120070000_phase2_composite_product_definitions.sql');
const editor = await read('../../src/components/pos/CompositeItemEditor.jsx');
const menu = await read('../../src/components/pos/MenuManager.jsx');
const service = await read('../../src/services/inventoryService.js');

test('Phase 2 adds additive stable product links and explicit inventory tracking modes', () => {
  assert.match(migration,/add column if not exists inventory_tracking_mode text not null default 'direct'/i);
  assert.match(migration,/add column if not exists menu_product_id uuid references public\.products\(id\)/i);
  assert.match(migration,/recipes_property_menu_product_uidx/i);
  assert.match(migration,/recipe_version integer not null default 1/i);
  assert.match(migration,/having count\(\*\)=1/i);
});

test('legacy recipe mapping is conservative and ambiguous product names are rejected', () => {
  assert.match(migration,/having count\(\*\)=1/i);
  assert.match(migration,/v_name_matches > 1/i);
  assert.match(migration,/Multiple products share this name/i);
});

test('composite RPC enforces property ownership, manager authority and valid components', () => {
  assert.match(migration,/is_member_of_property\(p_property_id\)/i);
  assert.match(migration,/current_staff_role\(p_property_id\)/i);
  assert.match(migration,/Only an authorised manager can edit composite recipes/i);
  assert.match(migration,/v_component_id=any\(v_seen\)/i);
  assert.match(migration,/Every component must belong to the same property/i);
  assert.match(migration,/Nested composite components are not supported yet/i);
  assert.match(editor,/inventory_tracking_mode!=='composite'/i);
  assert.match(migration,/set inventory_tracking_mode='composite'/i);
  assert.doesNotMatch(migration,/track_stock=false/i);
  assert.match(migration,/revoke all on function public\.fn_upsert_composite_product_recipe/i);
});

test('product editor exposes composite components without replacing existing product editing', () => {
  assert.match(menu,/CompositeItemEditor/);
  assert.match(editor,/Components per one product/);
  assert.match(editor,/Add component/);
  assert.match(editor,/Remove component/);
  assert.match(editor,/Save composite settings/);
  assert.match(editor,/componentCost/);
});

test('inventory service reads and saves recipes through the guarded RPC', () => {
  assert.match(service,/getCompositeRecipe\(propertyId, productId\)/);
  assert.match(service,/fn_upsert_composite_product_recipe/);
  assert.match(service,/p_is_composite/);
});
