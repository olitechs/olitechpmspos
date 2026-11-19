import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const nav = read('./navArchitecture.js');
const posHeader = read('../../components/pos/AppHeader.jsx');
const adminLayout = read('../../pages/admin/AdminLayout.jsx');
const propertySettings = read('../../pages/admin/PropertyAdminSettings.jsx');
const routes = read('../../routes/AppRoutes.jsx');

test('Back Office Settings has one Features navigation entry', () => {
  const settings = nav.match(/\{ id:'settings',[\s\S]*?\n  \},/)?.[0];
  assert.ok(settings, 'Settings navigation group exists');
  assert.match(settings, /path:'\/backoffice\/settings\/features'/, 'parent opens Features');
  assert.doesNotMatch(settings, /\['Features','\/backoffice\/settings\/features'\]/, 'no duplicate Features child');
  assert.match(settings, /\['Billing & subscriptions','\/backoffice\/settings\/billing'\]/);
  assert.match(settings, /\['Dining options','\/backoffice\/settings\/dining-options'\]/);
});

test('unfinished Employee Report is hidden from navigation but its route remains available', () => {
  assert.doesNotMatch(nav, /Employee report|\/backoffice\/reports\/employees/);
  assert.match(routes, /path="reports\/employees"/);
  assert.match(routes, /Employee Report/);
  assert.match(routes, /This report is not yet implemented as a dedicated reporting workflow/);
});

test('POS no-shift warning is informational while the Shifts tab remains actionable', () => {
  const warning = posHeader.match(/\{!hasOpenShift && \(([\s\S]*?)\)\}/)?.[1];
  assert.ok(warning, 'no-shift warning is rendered');
  assert.match(warning, /role="status"/);
  assert.match(warning, /No shift is open/);
  assert.doesNotMatch(warning, /<button|onClick=/);
  assert.match(posHeader, /if \(tab\.id === 'shifts'\) onOpenShifts\?\.\(\)/);
});

test('Property Admin has one Property Settings sidebar entry and preserves all settings cards', () => {
  const propertyNav = adminLayout.match(/const PROPERTY_NAV = \[([\s\S]*?)\];/)?.[1];
  assert.ok(propertyNav, 'Property Admin navigation exists');
  assert.equal((propertyNav.match(/\/admin\/settings/g) || []).length, 1);
  assert.match(propertyNav, /label: 'Property Settings'/);
  assert.doesNotMatch(propertyNav, /\/admin\/settings\/(printers|receipt|unsettled-receipt)/);

  for (const path of [
    '/admin/settings/printers',
    '/admin/settings/receipt',
    '/admin/settings/unsettled-receipt',
  ]) {
    assert.ok(propertySettings.includes(path), `settings card retains ${path}`);
    assert.ok(routes.includes(path), `route remains registered for ${path}`);
  }
  assert.match(propertySettings, /onClick=\{\(\) => navigate\(path\)\}/);
});
