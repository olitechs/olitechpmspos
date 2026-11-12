import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_SETTINGS_NAV, isSystemSettingsPath, navPath, slugFromPath } from '../../components/settings/systemSettingsNav.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const root = new URL('../../../', import.meta.url).pathname;
const app = read('../../App.jsx');

// The layout routes establish the parent for each relative child path.
const LAYOUTS = [
  ['/backoffice', 'BackOfficeLayout'],
  ['/frontoffice', 'FrontOfficeLayout'],
  ['/stores', 'StoresLayout'],
  ['/pos', 'POSLayout'],
  ['/admin', 'AdminLayout'],
];

function declaredRoutes() {
  const routes = new Set();
  for (const match of app.matchAll(/path="(\/[^"]*)"/g)) routes.add(match[1]);

  const marks = LAYOUTS
    .map(([path, component]) => ({ path, at: app.indexOf(`path="${path}" element={<${component}`) }))
    .filter((mark) => mark.at >= 0)
    .sort((a, b) => a.at - b.at);

  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].at : app.length;
    const block = app.slice(mark.at, end);
    for (const match of block.matchAll(/<Route (?:index )?path="([^"*][^"]*)"/g)) {
      const child = match[1];
      if (child.startsWith('/')) continue;
      routes.add(`${mark.path}/${child}`.replace(/\/$/, ''));
    }
  });
  return routes;
}

const routes = declaredRoutes();
const segments = (value) => value.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').filter(Boolean);

function routeExists(target) {
  const wanted = segments(target);
  for (const route of routes) {
    const wildcard = route.endsWith('*');
    const parts = segments(route.replace(/\/\*$/, ''));
    if (!wildcard && parts.length !== wanted.length) continue;
    if (wildcard && wanted.length < parts.length) continue;
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].startsWith(':') || parts[i] === '*') continue;
      if (parts[i] !== wanted[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      found.push(...sourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const LINK_PATTERNS = [
  /\bto=["'](\/[^"'`]*)["']/g,
  /\bto=\{["'`](\/[^"'`]*)["'`]\}/g,
  /\bhref=["'](\/[^"']*)["']/g,
  /\bback=["'](\/[^"']*)["']/g,
  /\bback=\{["'](\/[^"']*)["']\}/g,
  /\bnavigate\(\s*["'`](\/[^"'`]*)["'`]/g,
  /window\.location(?:\.href)?\s*=\s*["'`](\/[^"'`]*)/g,
];

test('every literal internal link target is a registered route', () => {
  const dead = [];
  for (const file of sourceFiles(root + 'src')) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of LINK_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (!routeExists(match[1])) {
          const line = text.slice(0, match.index).split('\n').length;
          dead.push(`${match[1]} (${file.replace(root, '')}:${line})`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(dead)].sort(), [], 'internal links pointing at routes that do not exist');
});

test('system settings navigation opens each real section instead of the Features fallback', () => {
  for (const item of SYSTEM_SETTINGS_NAV) {
    const path = navPath(item);
    assert.equal(path, `/backoffice/settings/${item.slug}`, `${item.label} must open its own settings section`);
    assert.ok(routeExists(path), `${item.label} points at a route that does not exist: ${path}`);
    assert.equal(slugFromPath(path), item.slug);
    assert.equal(isSystemSettingsPath(path), true);
  }
  assert.equal(slugFromPath('/settings/system/taxes'), 'taxes', 'old bookmarks still resolve to their section');
  assert.equal(isSystemSettingsPath('/settings/system/taxes'), true);
  assert.equal(navPath({ slug: 'receipt' }).startsWith('/settings/system/'), false);
});

test('the settings sidebar no longer links to a removed stores route', () => {
  const layout = read('../../components/settings/SystemSettingsLayout.jsx');
  assert.doesNotMatch(layout, /'\/settings\/stores'/);
  assert.match(layout, /navigate\('\/backoffice\/stores'\)/);
  assert.ok(routeExists('/backoffice/stores'));
});

test('the legacy settings redirect keeps the requested section', () => {
  assert.match(app, /<Route path="\/settings\/system\/\*" element=\{<LegacySystemSettingsRedirect\/>\}\/>/);
  assert.match(app, /function LegacySystemSettingsRedirect\(\)[\s\S]*?params\['\*'\][\s\S]*?\/backoffice\/settings\//);
});

test('the booking engine does not navigate to an unregistered public booking page', () => {
  const booking = read('../../components/modules/BookingEngine.jsx');
  assert.doesNotMatch(booking, /'\/booking/);
  assert.doesNotMatch(booking, /window\.location\.href\s*=\s*'\/booking/);
  assert.match(booking, /Search available rooms<\/button>/);
  assert.match(booking, /disabled aria-disabled="true"/);
  assert.match(booking, /public booking page is not available/i);
});

test('the published route manifest only lists routes that exist', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../public/manus-routes.json', import.meta.url), 'utf8'));
  const missing = manifest.routes
    .map((entry) => entry.path)
    .filter((path) => !path.includes('*') && !routeExists(path));
  assert.deepEqual([...new Set(missing)], [], 'public/manus-routes.json lists routes the app does not register');
});
