import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20261120140000_phase8_atomic_inventory_production.sql', import.meta.url), 'utf8');
const locationMigration = readFileSync(new URL('../../supabase/migrations/20261120130000_phase7_1_wastage_approval_workflow.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/components/modules/InventoryOperations.jsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../src/services/inventoryService.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../../src/lib/permissions.js', import.meta.url), 'utf8');

test('production posting has a dedicated sensitive employee permission', () => {
  assert.match(migration, /stores\.production\.post/);
  assert.match(migration, /fn_employee_has_permission\(p_property_id,'stores\.production\.post'\)/);
  assert.match(migration, /fn_subscription_module_allowed\(p_property_id,'store'\)/);
  assert.match(migration, /stores\.production\.post/);
  assert.match(permissions, /stores\.production\.post/);
});

test('legacy membership-only production RPC and direct table writes are disabled', () => {
  assert.match(migration, /Direct production posting is disabled/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_post_production/);
  assert.match(migration, /REVOKE INSERT,UPDATE,DELETE ON TABLE public\.inventory_productions/);
  assert.match(migration, /REVOKE INSERT,UPDATE,DELETE ON TABLE public\.recipes,public\.recipe_ingredients/);
  assert.doesNotMatch(service, /rpc\('fn_post_production'/);
  assert.match(service, /rpc\('fn_post_inventory_production'/);
});

test('production validates recipe and same-property tracked component/output products', () => {
  assert.match(migration, /v_ingredient_count=0/);
  assert.match(migration, /p\.property_id=p_property_id/);
  assert.match(migration, /coalesce\(p\.inventory_tracking_mode,'direct'\)<>'direct'/i);
  assert.match(migration, /coalesce\(v_output\.inventory_tracking_mode,'direct'\)<>'direct'/i);
  assert.match(migration, /v_recipe\.recipe_version/);
  assert.match(migration, /v_recipe\.menu_product_id<>p_output_product_id/);
});

test('production request keys are fingerprinted and serialized for safe retries', () => {
  assert.match(migration, /p_request_key text/);
  assert.match(migration, /request_fingerprint/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /production-batches/);
  assert.match(migration, /Lock the output product first/);
  assert.match(migration, /This request key was already used with different production details/);
  assert.match(migration, /inventory_productions_property_request_key/);
});

test('component and output stock movements are location-aware and linked to the production record', () => {
  assert.match(migration, /fn_post_stock_movement_at_location/);
  assert.match(migration, /'production',v_row\.id,'component:'/);
  assert.match(migration, /'production',v_row\.id,'output'/);
  assert.match(migration, /components_snapshot/);
  assert.match(migration, /component_cost_total/);
  assert.match(migration, /output_unit_cost/);
  assert.match(migration, /stock_internal\.production_cost_snapshots/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /ADD COLUMN IF NOT EXISTS component_cost_total/);
  assert.doesNotMatch(migration, /ADD COLUMN IF NOT EXISTS output_unit_cost/);
  const publicSnapshot = migration.slice(migration.indexOf('v_snapshot:=v_snapshot'), migration.indexOf('v_cost_snapshot:=v_cost_snapshot'));
  assert.doesNotMatch(publicSnapshot, /unit_cost_snapshot|line_cost_snapshot/);
  assert.match(locationMigration, /p_change <> ROUND\(p_change, 6\)/);
});

test('production UI is permission-gated and retains a request key for retries', () => {
  assert.match(ui, /canPost=\{permissions\.codes\.has\('stores\.production\.post'\)\}/);
  assert.match(ui, /requestKey/);
  assert.match(ui, /Post Production/);
  assert.match(ui, /You need the stores\.production\.post permission/);
  assert.match(service, /p_request_key: payload\.requestKey/);
});
