import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const repair = read('../migrations/20261128133000_stores_cost_centre_schema_cache_repair.sql');
const service = read('../../src/services/storesService.js');

test('cost-centre cache repair recreates the canonical RPC signature and body', () => {
  assert.match(
    repair,
    /CREATE OR REPLACE FUNCTION public\.fn_stores_list_cost_centres\(p_property_id uuid\)/,
  );
  assert.match(repair, /RETURNS jsonb/);
  assert.match(repair, /LANGUAGE plpgsql/);
  assert.match(repair, /SECURITY DEFINER/);
  assert.match(repair, /SET search_path = ''/);

  for (const fragment of [
    "ARRAY['stores.access', 'stores.requisition.create', 'stores.costcentre.manage']",
    'PERFORM stock_internal.fn_stores_ensure_settings(p_property_id);',
    'stock_internal.fn_stores_cost_centre_json(p_property_id, cc.id)',
    'ORDER BY cc.active DESC, cc.name',
    'WHERE cc.property_id = p_property_id;',
    "'can_manage', public.is_platform_owner()",
    "public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')",
  ]) {
    assert.ok(repair.includes(fragment), `missing canonical body fragment: ${fragment}`);
  }
});

test('cost-centre cache repair keeps the RPC authenticated-only', () => {
  assert.match(
    repair,
    /REVOKE ALL ON FUNCTION public\.fn_stores_list_cost_centres\(uuid\) FROM PUBLIC, anon;/,
  );
  assert.match(
    repair,
    /GRANT EXECUTE ON FUNCTION public\.fn_stores_list_cost_centres\(uuid\) TO authenticated;/,
  );
  assert.doesNotMatch(repair, /GRANT[^\n]*TO (?:PUBLIC|anon)\b/i);
  assert.doesNotMatch(repair, /TO PUBLIC, authenticated/i);
});

test('cost-centre cache repair is forward-only and reloads PostgREST', () => {
  assert.match(repair, /Forward-only repair/i);
  assert.doesNotMatch(repair, /\bDROP\s+FUNCTION\b/i);

  const created = [...repair.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/gi)]
    .map((match) => match[1]);
  assert.deepEqual(created, ['fn_stores_list_cost_centres']);

  assert.match(repair, /NOTIFY pgrst, 'reload schema';\s*$/i);
});

test('frontend continues to call the single canonical cost-centre RPC', () => {
  assert.match(
    service,
    /rpc\('fn_stores_list_cost_centres', \{ p_property_id: propertyId \}\)/,
  );
});
