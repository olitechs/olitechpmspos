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
const inventoryOperations = read('../../src/components/modules/InventoryOperations.jsx');
const inventoryService = read('../../src/services/inventoryService.js');
const storePage = read('../../src/pages/Store.jsx');
const variantEditor = read('../../src/components/store/ProductVariantsEditor.jsx');
const appStore = read('../../src/data/AppStore.jsx');
const dashboard = read('../../src/pages/StorekeeperDashboard.jsx');
const inventoryReports = read('../../src/components/modules/InventoryReports.jsx');
const valuationMigration = read('../../supabase/templates/pos_floor_wastage_valuation_fixes.sql');
const permissionCatalog = read('../../src/lib/permissions.js');

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
    ['valuation','stores.inventory.valuation.view'],['labels','stores.inventory.view'],
  ]) {
    assert.ok(shell.includes(`${id}: '${code}'`), `${id} must be permission-gated by ${code}`);
  }
  assert.ok(auth.includes('productions') && auth.includes("'stores.production.post'"));
  assert.ok(auth.includes('labels') && auth.includes("'stores.inventory.view'"));
});

test('Storekeeper role aliases are normalized before Store page capability checks', () => {
  assert.match(store, /normalizeStaffRole\(sessionStaff\?\.role/);
  assert.ok(store.includes("'store_manager'"));
  assert.ok(store.includes("'hotel_admin'"));
  assert.match(store, /tab==='labels'&&<StoreBarcodeLabels/);
  assert.match(routes, /path="labels" element={<Store initialTab="labels"\/>}/);
  assert.match(routes, /path="purchasing" element={<Purchasing\/>}/);
  assert.ok(purchasing.includes('suggestedReorderQty'));
  assert.ok(purchasing.includes('supplierEmailBody'));
  assert.ok(pmsService.includes('supplier:suppliers(name,email)'));
  assert.ok(inventoryOperations.includes('Potential gross margin'));
  assert.ok(inventoryOperations.includes('const countedLines=products.filter'));
  for (const reason of ['damage','loss','correction','expiry']) assert.ok(inventoryOperations.includes("['" + reason + "'"));
  assert.ok(migration.includes('to_regprocedure(\'public.fn_post_inventory_production'));
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

test('Storekeeper can access the complete item editor from the Stores product list', () => {
  assert.match(storePage, /permissions\.codes\.has\('stores\.access'\)/);
  assert.match(storePage, /permissions\.codes\.has\('stores\.stock\.adjust'\)/);
  assert.match(storePage, /<CompositeItemEditor propertyId=\{propertyId\} productId=\{value\.id\}/);
  assert.match(storePage, /<ProductVariantsEditor propertyId=\{propertyId\} productId=\{value\.id\}/);
  assert.match(storePage, /The item is available for sale/);
  assert.match(storePage, /Track stock/);
  assert.match(storePage, /Selling price \(KES\)/);
  assert.match(storePage, /Stock Adjustments to change on-hand quantity/);
  assert.match(variantEditor, /price_delta/);
  assert.match(variantEditor, /barcode/);
  assert.match(variantEditor, /track_stock/);
});

test('Storekeeper item writes and composite recipes retain tenant and permission boundaries', () => {
  assert.match(migration, /can_store_write\(property_id, 'adjust'\)/);
  assert.match(migration, /fn_employee_has_permission\(property_id,'stores\.stock\.adjust'\)/);
  assert.match(migration, /foreign key\(product_id,property_id\) references public\.products\(id,property_id\)/);
  assert.match(migration, /grant select, insert, update, delete on table public\.product_variants to authenticated/i);
  assert.match(migration, /Composite recipe authorization guard changed/);
  assert.match(inventoryService, /description: row\.description/);
  assert.match(inventoryService, /inventory_tracking_mode: row\.inventory_tracking_mode/);
});


test('POS floor layout hydration never creates or updates a row without an explicit edit', () => {
  assert.match(appStore, /const \[floorDirty, setFloorDirty\] = useState\(false\)/);
  assert.match(appStore, /zonesFor !== propertyId \|\| floorLoading \|\| !floorDirty/);
  assert.match(appStore, /Only an explicit floor-plan edit should write through the RLS policy/);
  assert.match(appStore, /setFloorDirty\(true\); setZones\(/);
  assert.match(appStore, /setFloorDirty\(false\)/);
});

test('legacy wastage schemas do not query a missing status column as a fatal page error', () => {
  assert.match(inventoryService, /error\?\.code === '42703' && \/status\/i\.test/);
  assert.match(inventoryOperations, /Wastage approval is not deployed on this database yet/);
  assert.match(inventoryOperations, /workflowAvailable!==true/);
});

test('inventory valuation requires the explicit cost permission for Storekeeper', () => {
  assert.match(permissionCatalog, /stores\.inventory\.valuation\.view/);
  assert.match(valuationMigration, /stores\.inventory\.valuation\.view/);
  assert.match(valuationMigration, /create policy products_valuation_select/);
  assert.match(valuationMigration, /fn_employee_has_permission\(p_property_id,'stores\.inventory\.valuation\.view'\)/);
  assert.match(shell, /valuation: 'stores\.inventory\.valuation\.view'/);
  assert.match(inventoryOperations, /permissions\.codes\.has\('stores\.inventory\.valuation\.view'\)/);
  assert.match(dashboard, /resolvePermissions\(user\)\.codes\.has\('stores\.inventory\.valuation\.view'\)/);
  assert.match(dashboard, /const canSeeCosts = Boolean\(user\?\.isPlatformOwner \|\| resolvePermissions\(user\)\.codes\.has\('stores\.inventory\.valuation\.view'\)\)/);
  assert.doesNotMatch(dashboard, /\['store_manager', 'hotel_admin', 'super_admin'\]\.includes\(role\).*stores\.inventory\.valuation\.view/);
  assert.match(inventoryReports, /canViewValuation\?inventoryService\.getInventoryValuation/);
  assert.match(inventoryReports, /Inventory costs and valuation are restricted/);
});
