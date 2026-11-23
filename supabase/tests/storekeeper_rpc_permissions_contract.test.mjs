import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/templates/storekeeper_full_stores_workspace_access.sql', import.meta.url), 'utf8');

test('stock-changing SECURITY DEFINER RPCs preserve property membership and enforce granular employee permissions', () => {
  const checks = [
    ['fn_post_stock_adjustment', 'p_property_id', 'stores.stock.adjust'],
    ['fn_create_inventory_count', 'p_property_id', 'stores.stock.adjust'],
    ['fn_approve_inventory_count', 'v.property_id', 'stores.stock.adjust'],
    ['fn_create_stock_transfer', 'p_property_id', 'stores.stock.transfer'],
    ['fn_complete_stock_transfer', 'v.property_id', 'stores.stock.transfer'],
    ['fn_create_purchase_order', 'p_property_id', 'stores.suppliers.manage'],
    ['fn_receive_purchase_order', 'po.property_id', 'stores.stock.receive'],
    ['fn_post_production', 'p_property_id', 'stores.production.post'],
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
