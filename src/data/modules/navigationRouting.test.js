import test from 'node:test';
import { getSubscriptionEntitlement } from './navArchitecture.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../../App.jsx');
const shell = read('../../components/layout/AppShell.jsx');
const topNav = read('../../components/layout/TopAppNav.jsx');
const frontLayout = read('../../components/layout/FrontOfficeLayout.jsx');
const posLayout = read('../../components/layout/POSLayout.jsx');
const posApp = read('../../pages/POSApp.jsx');
const inventoryOperations = read('../../components/modules/InventoryOperations.jsx');
const navArchitecture = read('./navArchitecture.js');
const sidebarNavigation = read('./sidebarNavigation.js');

function routePathExists(path) {
  if (path === '/backoffice') return /path="\/backoffice"/.test(app);
  if (path.startsWith('/backoffice/settings/')) return /path="settings\/:slug"/.test(app);
  if (path.startsWith('/backoffice/')) return new RegExp('path="' + path.slice('/backoffice/'.length) + '"').test(app);
  if (path === '/frontoffice') return /path="\/frontoffice"/.test(app);
  if (path.startsWith('/frontoffice/')) return new RegExp('path="' + path.slice('/frontoffice/'.length) + '"').test(app);
  if (path === '/stores') return /path="\/stores"/.test(app);
  if (path.startsWith('/stores/')) return new RegExp('path="' + path.slice('/stores/'.length) + '"').test(app);
  return new RegExp('path="' + path + '"').test(app);
}

test('every declared navigation destination has a registered route', () => {
  const paths = [
    ...[...navArchitecture.matchAll(/path:'([^']+)'/g)].map((match) => match[1]),
    ...[...navArchitecture.matchAll(/\['[^']+','([^']+)'/g)].map((match) => match[1]),
    ...[...sidebarNavigation.matchAll(/path:"([^"]+)"/g)].map((match) => match[1]),
  ];
  const missing = [...new Set(paths)].filter((path) => path.startsWith('/') && !routePathExists(path));
  assert.deepEqual(missing, [], 'navigation destinations missing route registrations');
});

test('legacy Store Settings URL redirects instead of duplicating the All Stores page', () => {
  assert.ok(app.includes('<Route path="settings" element={<Navigate to="/stores" replace/>}/>'));
  assert.ok(!navArchitecture.includes('Store Settings'));
  assert.ok(navArchitecture.includes("['All Stores','/stores','store']"));
});

test('workspace links navigate in the current tab by default', () => {
  assert.doesNotMatch(topNav, /target="_blank"/);
  assert.doesNotMatch(topNav, /rel="noopener noreferrer"/);
  assert.match(topNav, /to={a\.path}/);
});

test('workspace layouts own one shell and embedded module routes suppress legacy navigation', () => {
  assert.match(app, /path="\/backoffice" element={<BackOfficeLayout\/>}/);
  assert.match(app, /path="\/frontoffice" element={<FrontOfficeLayout\/>}/);
  assert.match(app, /path="\/stores" element={<StoresLayout\/>}/);
  assert.match(app, /path="\/pos" element={<POSLayout\/>}/);
  assert.match(posLayout, /<AppShell workspace="pos" \/>/);
  assert.match(shell, /workspace !== 'pos' && <aside/);
  assert.match(shell, /workspace === 'pos' \? 'w-full min-h-full'/);
  assert.match(shell, /<TopAppNav\s*\/>/);
  assert.match(frontLayout, /return <AppShell workspace="frontoffice" \/>/);
  assert.match(posApp, /!embedded && <Sidebar/);
  assert.match(posApp, /showTopBar && !embedded && <TopBar/);
  assert.match(posApp, /isMobile && !embedded && <POSTabs/);
});

test('standalone POS uses the global workspace switcher and hides the generic duplicate sidebar', () => {
  assert.ok(app.includes('path="/pos" element={<POSLayout/>}><Route index element={<POSApp initialModule="pos" embedded workspaceModule="pos"/>}/></Route>'));
  assert.match(posLayout, /AppShell workspace="pos"/);
  assert.match(shell, /if \(workspace === 'pos'\) return \[\]/);
  assert.match(shell, /workspace !== 'pos' && <aside/);
});

test('Room Planner is the deliberate full-screen shell exception, including trailing slash', () => {
  assert.match(frontLayout, /room-planner/);
  assert.match(frontLayout, /pathname/);
  assert.match(frontLayout, /fixed inset-0 z-50 h-\[100dvh\] w-screen/);
  assert.match(frontLayout, /if \(isDedicatedPlanner\)[\s\S]*?<Outlet \/>[\s\S]*?return <AppShell workspace="frontoffice" \/>/);
});

test('active navigation comparisons use normalized paths for direct URLs and trailing slashes', () => {
  assert.match(shell, /normalizeAppPath\(location\.pathname\)/);
  assert.match(shell, /event\.key === 'Escape'/);
  assert.doesNotMatch(shell, /location\.pathname === path/);
  assert.doesNotMatch(shell, /location\.pathname === item\.path/);
});


test('inventory destinations select their own operational section instead of defaulting to Locations', () => {
  for (const [path, tab] of [
    ['inventory/stock-adjustments', 'adjustments'],
    ['inventory/counts', 'counts'],
    ['inventory/productions', 'production'],
    ['inventory/history', 'history'],
    ['inventory/valuation', 'valuation'],
  ]) {
    assert.match(app, new RegExp('path="' + path + '" element={<InventoryOperations initialTab="' + tab + '"\\/>}'));
  }
  assert.match(inventoryOperations, /function InventoryOperations\(\{initialTab='locations'\}\)/);
  assert.match(inventoryOperations, /useEffect\(\(\)=>\{if\(tabs\.some\(\(\[id\]\)=>id===initialTab\)\)setTab\(initialTab\)\},\[initialTab\]\)/);
});

test('embedded operational content follows route changes including browser history changes', () => {
  assert.match(posApp, /const routeModule = queryModule \|\| initialModule/);
  assert.match(posApp, /useEffect\(\(\) => \{ setActiveModule\(routeModule\); \}, \[routeModule\]\)/);
});

test('employee reporting does not silently render timecards as a report', () => {
  assert.match(app, /function BackOfficeReportPage\(\{kind\}\)[\s\S]*?if\(kind==="sales"\)return <Reports\/>;[\s\S]*?Employee Report/);
  assert.match(app, /path="reports\/inventory" element={<BackOfficeReportPage kind="inventory"\/>}/);
});


test('workspace highlighting remains active on nested routes and exact POS route only', () => {
  assert.match(topNav, /end=\{a\.id==='pos'\}/);
  assert.match(topNav, /to=\{a\.path\}/);
  assert.match(shell, /pathname === path \|\| pathname\.startsWith\(path \+ '\/'\)/);
});

test('mobile sidebar closes after selection and Escape without affecting planner full-screen layout', () => {
  assert.match(shell, /onClick=\{\(\) => setMobileOpen\(false\)\}/);
  assert.match(shell, /event\.key === 'Escape'/);
  assert.match(frontLayout, /if \(isDedicatedPlanner\)/);
  assert.match(frontLayout, /fixed inset-0 z-50 h-\[100dvh\] w-screen/);
});


test('subscription checks use workspace entitlement keys rather than screen ids', () => {
  assert.equal(getSubscriptionEntitlement('rooms', 'frontoffice'), 'frontoffice');
  assert.equal(getSubscriptionEntitlement('reservations', 'frontoffice'), 'frontoffice');
  assert.equal(getSubscriptionEntitlement('inventory', 'backoffice'), 'backoffice');
  assert.equal(getSubscriptionEntitlement('kds', 'stores'), 'store');
  assert.equal(getSubscriptionEntitlement('rooms'), 'frontoffice');
  assert.equal(getSubscriptionEntitlement('cashier'), 'pos');
  assert.equal(getSubscriptionEntitlement('dashboard', 'frontoffice'), 'dashboard');
});


test('database subscription access normalizes screen ids and legacy workspace names', () => {
  const migration = read('../../../supabase/migrations/20261012160000_workspace_entitlement_module_normalization.sql');
  assert.match(migration, /when 'rooms' then 'frontoffice'/);
  assert.match(migration, /when 'stores' then 'store'/);
  assert.match(migration, /when 'cashier' then 'pos'/);
  assert.match(migration, /where case lower\(trim\(enabled\.module\)\)/);
  assert.doesNotMatch(migration, /p_module\s*=\s*any\(s\.enabled_modules\)/);
});
