import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/templates/storekeeper_full_stores_workspace_access.sql', import.meta.url), 'utf8');
const phase7 = readFileSync(new URL('../../supabase/migrations/20261120130000_phase7_1_wastage_approval_workflow.sql', import.meta.url), 'utf8');
const phase8 = readFileSync(new URL('../../supabase/migrations/20261120140000_phase8_atomic_inventory_production.sql', import.meta.url), 'utf8');

test('stock-changing SECURITY DEFINER RPCs preserve property membership and enforce granular employee permissions', () => {
  const checks = [
    ['fn_post_stock_adjustment', 'p_property_id', 'stores.stock.adjust'],
    ['fn_create_inventory_count', 'p_property_id', 'stores.stock.adjust'],
    ['fn_approve_inventory_count', 'v.property_id', 'stores.stock.adjust'],
    ['fn_create_stock_transfer', 'p_property_id', 'stores.stock.transfer'],
    ['fn_complete_stock_transfer', 'v.property_id', 'stores.stock.transfer'],
    ['fn_create_purchase_order', 'p_property_id', 'stores.suppliers.manage'],
    ['fn_receive_purchase_order', 'po.property_id', 'stores.stock.receive'],
    
  ];
  for (const [name, propertyExpression, permission] of checks) {
    const start = migration.indexOf('create or replace function public.' + name);
    const end = migration.indexOf('$function$;', start);
    assert.ok(start >= 0 && end > start, 'missing function definition: ' + name);
    const body = migration.slice(start, end);
    assert.ok(body.includes('is_member_of_property('), name + ' must retain property membership validation');
    assert.ok(body.includes("public.fn_employee_has_permission(" + propertyExpression + ",'" + permission + "')"), name + ' must enforce ' + permission);
  }
});

test('production stays on the authorized idempotent workflow and remains read-only until its database prerequisites are deployed', () => {
  assert.ok(phase7.includes('stock_internal.fn_post_stock_movement_at_location'));
  assert.ok(phase8.includes('public.fn_post_inventory_production'));
  assert.ok(phase8.includes("public.fn_employee_has_permission(p_property_id,'stores.production.post')"));
  assert.ok(phase8.includes('p_request_key'));
  assert.ok(!migration.includes('create or replace function public.fn_post_production('), 'must not re-enable deprecated production endpoint');
});
