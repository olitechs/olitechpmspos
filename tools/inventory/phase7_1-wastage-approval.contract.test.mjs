import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/20261120130000_phase7_1_wastage_approval_workflow.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/components/modules/InventoryOperations.jsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../src/services/inventoryService.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../../src/lib/permissions.js', import.meta.url), 'utf8');

test('wastage submission and approval are separate permissioned actions', () => {
  assert.match(migration, /stores\.stock\.wastage\.submit/);
  assert.match(migration, /stores\.stock\.wastage\.approve/);
  assert.match(migration, /fn_submit_inventory_wastage/);
  assert.match(migration, /fn_decide_inventory_wastage/);
  assert.match(migration, /v_row\.created_by=auth\.uid\(\)/);
  assert.match(migration, /'pending'/);
  assert.match(permissions, /stores\.stock\.wastage\.submit/);
  assert.match(permissions, /stores\.stock\.wastage\.approve/);
});

test('old one-step wastage RPC cannot bypass manager approval', () => {
  assert.match(migration, /Direct wastage posting is disabled/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_post_wastage/);
  assert.doesNotMatch(service, /rpc\('fn_post_wastage'/);
  assert.match(service, /rpc\('fn_submit_inventory_wastage'/);
});

test('approved wastage uses one location-aware stock movement linked to its request', () => {
  assert.match(migration, /fn_post_stock_movement_at_location\(/);
  assert.match(migration, /'wastage',v_row\.id,'wastage'/);
  assert.match(migration, /stock_movement_id=/);
  assert.match(migration, /location_posting_context/);
  assert.match(migration, /p_change <> ROUND\(p_change, 6\)/);
  assert.match(migration, /products_sync_default_location/);
});

test('wastage UI submits requests and only offers approval to approvers other than the requester', () => {
  assert.match(ui, /Submit for Approval/);
  assert.match(ui, /Approve & Deduct/);
  assert.match(ui, /row\.created_by!==currentUserId/);
  assert.match(ui, /Stock has not yet changed/);
  assert.match(service, /listWastageRequests/);
  assert.match(service, /decideWastage/);
});
