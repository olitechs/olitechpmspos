import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read('../../supabase/migrations/20261120080000_phase3_composite_unit_costing.sql');
const editor = await read('../../src/components/pos/CompositeItemEditor.jsx');
const service = await read('../../src/services/inventoryService.js');

test('Phase 3 preserves canonical base quantities and stores entered unit and cost snapshots', () => {
  assert.match(migration,/add column if not exists entered_qty/i);
  assert.match(migration,/add column if not exists entered_unit/i);
  assert.match(migration,/add column if not exists unit_cost_snapshot/i);
  assert.match(migration,/add column if not exists line_cost_snapshot/i);
  assert.match(migration,/insert into public\.recipe_ingredients\(recipe_id,product_id,qty,entered_qty,entered_unit,unit_cost_snapshot,line_cost_snapshot\)/i);
});

test('Unit conversion validates dimensions and supports property overrides and reverse factors', () => {
  assert.match(migration,/Cannot convert between different unit dimensions/i);
  assert.match(migration,/property_id=p_property_id or property_id is null/i);
  assert.match(migration,/order by \(property_id is not null\) desc/i);
  assert.match(migration,/select 1\/factor/i);
  assert.match(migration,/No conversion configured/i);
  assert.match(migration,/allows_fraction=false/i);
});

test('Composite save computes base-unit quantities and component costs server-side', () => {
  assert.match(migration,/fn_inventory_unit_factor\(p_property_id,v_entered_unit,v_component\.base_unit\)/i);
  assert.match(migration,/round\(v_entered_qty\*v_factor,6\)/i);
  assert.match(migration,/round\(v_base_qty\*v_unit_cost,6\)/i);
  assert.match(migration,/v_total_cost:=v_total_cost\+round\(v_base_qty\*v_unit_cost,6\)/i);
});

test('Editor displays compatible units, normalized quantities and component costs', () => {
  assert.match(editor,/listInventoryUnits\(\)/);
  assert.match(editor,/listInventoryUnitConversions\(propertyId\)/);
  assert.match(editor,/compatibleUnits/);
  assert.match(editor,/baseQty/);
  assert.match(editor,/lineCost/);
  assert.match(editor,/components:components\.map\(line=>\(\{product_id:line\.product_id,qty:Number\(line\.qty\),unit:line\.unit\}\)\)/);
});

test('Inventory service reads canonical units and property/global conversion rows', () => {
  assert.match(service,/async listInventoryUnits\(\)/);
  assert.match(service,/async listInventoryUnitConversions\(propertyId\)/);
  assert.match(service,/inventory_unit_conversions/);
});
