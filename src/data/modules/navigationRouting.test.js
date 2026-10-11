import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../../App.jsx');
const shell = read('../../components/layout/AppShell.jsx');
const topNav = read('../../components/layout/TopAppNav.jsx');
const frontLayout = read('../../components/layout/FrontOfficeLayout.jsx');
const posLayout = read('../../components/layout/POSLayout.jsx');
const posApp = read('../../pages/POSApp.jsx');
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
