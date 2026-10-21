import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('POS menu import migration updates existing products by property SKU', async () => {
  const sql = await read('../../supabase/migrations/20261021150000_fix_pos_menu_import_sku_upsert.sql');
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(p_property_id::text\)\)/);
  assert.match(sql, /where property_id = p_property_id and sku = v_sku/i);
  assert.match(sql, /if v_existing_id is null then[\s\S]*?insert into public\.products/i);
  assert.match(sql, /update public\.products set[\s\S]*?where id = v_existing_id and property_id = p_property_id/i);
  assert.match(sql, /products_property_id_sku_key/);
  assert.match(sql, /create or replace function public\\.fn_bulk_upsert_pos_menu[\\s\\S]*?perform public\\.fn_upsert_pos_menu_item/i);
  assert.match(sql, /revoke all on function public\.fn_upsert_pos_menu_item[\s\S]*?from public, anon/i);
});

test('XML menu import supports product/item records and common menu field aliases', async () => {
  const service = await read('./inventoryService.js');
  const menu = await read('../components/pos/MenuManager.jsx');
  const storeImport = await read('../components/store/ImportExport.jsx');
  assert.match(service, /name\.endsWith\('\.xml'\)/);
  assert.match(service, /function parseXmlImportRows\(xmlText\)/);
  assert.match(service, /'product', 'item', 'menuitem', 'menu_item', 'menu-item'/);
  assert.match(service, /row\.name \?\? row\.product_name \?\? row\.menu_item_name \?\? row\.item_name/);
  assert.match(service, /row\.sku \?\? row\.product_sku \?\? row\.item_sku \?\? row\.code/);
  assert.match(menu, /accept="\.xlsx,\.xls,\.csv,\.xml"/);
  assert.match(storeImport, /accept="\.csv,\.xlsx,\.xls,\.xml"/);
});

test('menu import sends id-less imported rows through the server upsert path', async () => {
  const service = await read('./inventoryService.js');
  assert.match(service, /supabase\.rpc\('fn_bulk_upsert_pos_menu'/);
  assert.match(service, /id: r\.id \|\| null/);
});
