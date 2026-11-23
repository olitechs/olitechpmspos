import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const nav = read('../../src/data/modules/navArchitecture.js');
const shell = read('../../src/components/layout/AppShell.jsx');
const auth = read('../../src/services/authService.js');
const store = read('../../src/pages/Store.jsx');
const routes = read('../../src/routes/AppRoutes.jsx');
const migration = read('../../supabase/templates/storekeeper_full_stores_workspace_access.sql');
const purchasing = read('../../src/components/modules/Purchasing.jsx');
const pmsService = read('../../src/services/pmsService.js');

test('Storekeeper navigation exposes all requested operational modules', () => {
  const storesNav = nav.split('export const STORES_NAV = [')[1].split('];')[0];
  for (const id of ['dashboard','inventory','purchasing','transfers','adjustments','counts','production','history','valuation','labels','reports']) {
    assert.ok(storesNav.includes(`'${id}'`), `missing Stores navigation entry: ${id}`);
  }
  for (const path of ['purchasing','transfers','inventory/stock-adjustments','inventory/counts','inventory/productions','inventory/history','inventory/valuation','labels']) {
    assert.ok(routes.includes(`path="${path}"`), `missing operational route: ${path}`);
  }
});

test('Stores sidebar applies the matching permission to each operational module', () => {
  for (const [id, code] of [
    ['purchasing','stores.suppliers.manage'],['transfers','stores.stock.transfer'],
    ['adjustments','stores.stock.adjust'],['counts','stores.stock.adjust'],
    ['production','stores.production.post'],['history','stores.inventory.view'],
    ['valuation','stores.inventory.view'],['labels','stores.inventory.view'],
  ]) {
    assert.ok(shell.includes(`${id}: '${code}'`), `${id} must be permission-gated by ${code}`);
  }
  assert.match(auth, /stores\/inventory\/productions.*stores\.production\.post/);
  assert.match(auth, /stores\/labels.*stores\.inventory\.view/);
});

test('Storekeeper role aliases are normalized before Store page capability checks', () => {
  assert.match(store, /normalizeStaffRole\(sessionStaff\?\.role/);
  assert.match(store, /\['store_manager','fb_manager','hotel_admin'/);
  assert.match(store, /tab==='labels'&&<StoreBarcodeLabels/);
  assert.match(routes, /path="labels" element={<Store initialTab="labels"\/>}/);
  assert.match(routes, /path="purchasing" element={<Purchasing\/>}/);
  assert.ok(purchasing.includes('suggestedReorderQty'));
  assert.ok(purchasing.includes('supplierEmailBody'));
  assert.ok(pmsService.includes('supplier:suppliers(name,email)'));
});

test('Storekeeper database role and legacy resolver include production posting only in Stores scope', () => {
  assert.match(migration, /insert into public\.employee_permission_codes[\s\S]*?stores\.production\.post/);
  assert.match(migration, /where is_system = true[\s\S]*?lower\(btrim\(name\)\) = 'storekeeper'/);
  assert.match(migration, /when 'storekeeper' then array\[[^\]]*stores\.production\.post/);
  assert.match(migration, /when 'store_keeper' then array\[[^\]]*stores\.production\.post/);
  assert.match(migration, /'stores\.production\.post'\s*\]::text\[\]/);
  const storekeeperPermissions = migration.split('set permission_codes = array[')[1]?.split(']::text[]')[0] || '';
  assert.ok(!storekeeperPermissions.includes('back_office.'));
});
