import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const migration = await read('../../docs/audit/drafts/LOCATION_AWARE_ADJUSTMENT_WASTAGE_COUNT_CANDIDATE_20261115.sql');
const runtimeGate = await read('../../supabase/tests/phase3_location_aware_posting_runtime_regression.sql');
const inventoryUi = await read('../../src/components/modules/InventoryOperations.jsx');
const inventoryService = await read('../../src/services/inventoryService.js');

test('candidate keeps the default-location trigger and uses a private transaction context', () => {
  assert.match(migration, /create schema if not exists stock_internal/i);
  assert.match(migration, /location_posting_context/i);
  assert.match(migration, /delete from stock_internal\.location_posting_context/i);
  assert.match(migration, /products_sync_default_location/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*products_sync_default_location/i);
  assert.match(migration, /trigger that consumes the private context is absent or disabled/i);
});

test('shared location writer locks the product and posts one source-linked movement', () => {
  assert.match(migration, /fn_post_stock_movement_at_location/i);
  assert.match(migration, /where id = p_product_id\s+and property_id = p_property_id\s+for update/i);
  assert.match(migration, /update public\.product_stock_locations[\s\S]*?set qty = qty \+ p_change/i);
  assert.match(migration, /update public\.products[\s\S]*?set current_stock = current_stock \+ p_change/i);
  for (const field of ['source_type','source_id','location_id','location_name_snapshot','source_line_key','idempotency_key','unit_code','base_qty','unit_cost']) {
    assert.match(migration, new RegExp(field, 'i'));
  }
});

test('adjustment and wastage require Stores authorization and stable retry keys', () => {
  for (const fn of ['fn_post_stock_adjustment','fn_post_wastage']) {
    const i=migration.toLowerCase().indexOf(`create or replace function public.${fn}`);
    assert.ok(i>=0, `missing ${fn}`);
    const body=migration.slice(i,migration.indexOf('$function$;',i)+11);
    assert.match(body,/can_store_write\(p_property_id, null\)/i);
    assert.match(body,/p_request_key text/i);
    assert.match(body,/request_fingerprint/i);
    assert.match(body,/on conflict \(property_id, request_key\)/i);
    assert.match(body,/fn_post_stock_movement_at_location/i);
  }
});

test('inventory count snapshots its location and approval preserves movements after the snapshot', () => {
  assert.match(migration,/add column if not exists location_id uuid/i);
  assert.match(migration,/insert into public\.inventory_count_lines\([\s\S]*?location_id, expected_qty, counted_qty/i);
  assert.match(migration,/v_applied_variance :=[\s\S]*?v_line\.counted_qty - v_line\.expected_qty/i);
  assert.match(migration,/if v_count\.status = 'approved' then[\s\S]*?return v_count/i);
  assert.match(migration,/can_store_write\(v_count\.property_id, null\)/i);
});

test('client direct DML is revoked only for RPC-owned stock operation records', () => {
  assert.match(migration,/revoke insert, update, delete on table[\s\S]*?product_stock_locations[\s\S]*?inventory_counts[\s\S]*?inventory_count_lines[\s\S]*?stock_adjustments[\s\S]*?inventory_wastage[\s\S]*?from anon, authenticated/i);
  assert.match(migration,/if p_change < 0 and v_location_qty \+ p_change < 0 then/i);
  assert.doesNotMatch(migration,/drop constraint if exists product_stock_locations_qty_check/i);
});

test('rollback-only runtime gate covers location deltas, retries, authorization and trigger retention', () => {
  for (const assertion of [
    'AUTH-002','TRIGGER-001','TRIGGER-002','ACL-001','LEGACY-COUNT-001','ADJUST-001','WASTAGE-001',
    'COUNT-001','COUNT-002','IDEMP-001','IDEMP-005','SOURCE-001',
  ]) assert.ok(runtimeGate.includes(assertion), `missing runtime assertion ${assertion}`);
  assert.match(runtimeGate,/begin;[\s\S]*set local role authenticated[\s\S]*rollback;/i);
  assert.match(runtimeGate,/Never run this test against production/i);
});

test('active inventory client stays compatible until the database migration is promoted', () => {
  assert.doesNotMatch(inventoryService,/p_request_key: payload\.requestKey/);
  assert.match(inventoryService,/p_location_id: payload\.locationId/);
  assert.doesNotMatch(inventoryUi,/makeInventoryRequestKey/);
  assert.doesNotMatch(inventoryUi,/from\('product_stock_locations'\)/);
});

test('legacy adjustment and wastage calls remain accepted, but stale count calls are rejected', () => {
  const countStart=migration.toLowerCase().indexOf('create or replace function public.fn_create_inventory_count');
  const countEnd=migration.indexOf('REVOKE ALL ON FUNCTION public.fn_create_inventory_count',countStart);
  const countBody=migration.slice(countStart,countEnd);
  assert.match(countBody,/refresh the inventory screen and submit the count with a request key/i);
  assert.doesNotMatch(countBody,/legacy:' \|\| gen_random_uuid\(\)::text/i);
  for (const fn of ['fn_post_stock_adjustment','fn_post_wastage']) {
    const start=migration.toLowerCase().indexOf(`create or replace function public.${fn}`);
    const end=migration.indexOf(`REVOKE ALL ON FUNCTION public.${fn}`,start);
    assert.match(migration.slice(start,end),/legacy:' \|\| gen_random_uuid\(\)::text/i);
  }
});
