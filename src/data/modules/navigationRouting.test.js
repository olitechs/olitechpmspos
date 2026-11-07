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
const posContainer = read('../../components/pos/POSContainer.jsx');
const posAccessGate = read('../../components/pos/POSAccessGate.jsx');
const inventoryOperations = read('../../components/modules/InventoryOperations.jsx');
const navArchitecture = read('./navArchitecture.js');
const sidebarNavigation = read('./sidebarNavigation.js');
const roomPlanner = read('../../components/pms/RoomPlanner.jsx');
const legacySidebar = read('../../components/shell/Sidebar.jsx');
const pmsService = read('../../services/pmsService.js');
const distributionOps = read('../../components/modules/DistributionOps.jsx');

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

test('navigation-related source files contain no unresolved merge separators', () => {
  for (const [name, source] of [
    ['POSApp', posApp],
    ['Room Planner', roomPlanner],
    ['legacy Sidebar', legacySidebar],
    ['PMS service', pmsService],
    ['Distribution Operations', distributionOps],
  ]) {
    assert.doesNotMatch(source, /^={7}$/m, name + ' must not contain merge separator lines');
  }
  assert.match(roomPlanner, /getPaymentStatusFromAmounts/);
  assert.match(legacySidebar, /SIDEBAR_SECTIONS/);
  assert.match(pmsService, /fn_subscription_access/);
});

test('POSApp contains resolved source and preserves route and subscription guards', () => {
  assert.doesNotMatch(posApp, /^={7}$/m);
  assert.match(posApp, /<RouteGuard module={guardedWorkspace}>/);
  assert.match(posApp, /<PaywallGuard module={getSubscriptionEntitlement\(activeModule, workspaceModule\)}>/);
  assert.match(posApp, /useEffect\(\(\) => \{\s*setActiveModule\(routeModule\);\s*\}, \[routeModule\]\)/);
});

test('legacy Store Settings URL redirects instead of duplicating the All Stores page', () => {
  assert.ok(app.includes('<Route path="settings" element={<Navigate to="/stores" replace/>}/>'));
  assert.ok(!navArchitecture.includes('Store Settings'));
  assert.ok(navArchitecture.includes("['All Stores','/stores','store']"));
});

test('each workspace opens in its own named browser window', () => {
  assert.match(topNav, /window\.open\([\s\S]*?olitech-workspace-\$\{workspace\.id\}/);
  assert.match(topNav, /popup=yes/);
  assert.match(topNav, /onClick=\{\(\) => openWorkspaceWindow\(a\)\}/);
  assert.match(topNav, /aria-label=\{\`Open \$\{a\.label\} in a separate window\`\}/);
  assert.doesNotMatch(topNav, /<NavLink/);
});

test('workspace window handoff preserves the current tab-scoped staff PIN identity', () => {
  assert.match(topNav, /const STAFF_SESSION_KEY = 'olitech_active_staff_v2'/);
  assert.match(topNav, /sessionStorage\.getItem\(STAFF_SESSION_KEY\)/);
  assert.match(topNav, /popup\.sessionStorage\.setItem\(STAFF_SESSION_KEY, staffSession\)/);
  assert.match(topNav, /popup\.sessionStorage\.removeItem\(STAFF_SESSION_KEY\)/);
  assert.match(topNav, /popup\.opener = null/);
});

test('workspace layouts own one shell and embedded module routes suppress legacy navigation', () => {
  assert.match(app, /path="\/backoffice" element={<BackOfficeLayout\/>}/);
  assert.match(app, /path="\/frontoffice" element={<FrontOfficeLayout\/>}/);
  assert.match(app, /path="\/stores" element={<StoresLayout\/>}/);
  assert.match(app, /path="\/pos" element={<POSLayout\/>}/);
  assert.match(posLayout, /<AppShell workspace="pos" \/>/);
  assert.match(shell, /workspace !== 'pos' && <aside/);
  assert.match(shell, /workspace === 'pos' \? 'w-full min-h-full'/);
  assert.match(shell, /<TopAppNav workspace=\{workspace\} \/>/);
  assert.match(frontLayout, /return <AppShell workspace="frontoffice" \/>/);
  assert.match(posApp, /!embedded && <Sidebar/);
  assert.match(posApp, /showTopBar && !embedded && <TopBar/);
  assert.match(posApp, /isMobile && !embedded && <POSTabs/);
});

test('only the main Back Office shell exposes the workspace launcher; Front Office and POS stay isolated', () => {
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
  assert.match(posApp, /useEffect\(\(\) => \{\s*setActiveModule\(routeModule\);\s*\}, \[routeModule\]\)/);
});

test('employee reporting does not silently render timecards as a report', () => {
  assert.match(app, /function BackOfficeReportPage\(\{kind\}\)[\s\S]*?if\(kind==="sales"\)return <Reports\/>;[\s\S]*?Employee Report/);
  assert.match(app, /path="reports\/inventory" element={<BackOfficeReportPage kind="inventory"\/>}/);
});


test('separate workspace buttons highlight the active workspace and retain nested route awareness', () => {
  assert.match(topNav, /window\.location\.pathname === a\.path/);
  assert.match(topNav, /window\.location\.pathname\.startsWith\(a\.path \+ '\/'\)/);
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


test('POS access screen uses OliTechs branding, a compact keypad and four blue PIN indicators', () => {
  assert.match(posAccessGate, /bg-\[var\(--pos-gate-bg\)\]/);\n  assert.match(posAccessGate, /OliTechsBrand/);\n  assert.match(posAccessGate, /font-heading/);\n  assert.match(posAccessGate, /h-\[min\(49vh,440px\)\]/);\n  assert.match(posAccessGate, /var\(--pos-gate-accent\)/);
  assert.match(posAccessGate, /grid-cols-3 grid-rows-4/);
  assert.match(posAccessGate, /Array\.from\(\{ length: 4 \}/);
  assert.match(posAccessGate, /onClick=\{\(\) => enterDigit\(digit\)\}/);
  assert.match(posAccessGate, />Clear</);
  assert.match(posAccessGate, /next\.length === 4/);
});

test('POS access stays unlocked during navigation and is cleared when its browser window unloads', () => {
  assert.match(posContainer, /sessionStorage\.setItem\(\`\$\{POS_ACCESS_KEY\}:\$\{propertyId\}\`, '1'\)/);
  assert.match(posContainer, /sessionStorage\.getItem\(accessKey\) === '1'/);
  assert.match(posContainer, /window\.addEventListener\('beforeunload', clearWindowAccess\)/);
  assert.match(posContainer, /sessionStorage\.removeItem\(accessKey\)/);
});
