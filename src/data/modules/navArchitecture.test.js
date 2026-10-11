import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN_NAV,
  FRONT_OFFICE_NAV,
  normalizeAppRole,
  canAccessApp,
  getDefaultApp,
  getPackageModules,
  normalizeAppPath,
} from './navArchitecture.js';

test('navigation app identifiers and paths are unique', () => {
  assert.equal(new Set(MAIN_NAV.map(item => item.id)).size, MAIN_NAV.length);
  assert.equal(new Set(MAIN_NAV.map(item => item.path)).size, MAIN_NAV.length);
  const paths = FRONT_OFFICE_NAV.map(([, path]) => path);
  assert.equal(new Set(paths).size, paths.length);
});

test('legacy staff roles normalize to the canonical application roles', () => {
  assert.equal(normalizeAppRole('hotel_admin'), 'admin');
  assert.equal(normalizeAppRole('super_admin'), 'owner');
  assert.equal(normalizeAppRole('receptionist'), 'front_desk');
  assert.equal(normalizeAppRole('housekeeping_supervisor'), 'housekeeping');
  assert.equal(normalizeAppRole('cashier'), 'pos_staff');
  assert.equal(normalizeAppRole('  FRONT_DESK  '), 'front_desk');
});

test('workspace access is constrained by role', () => {
  assert.equal(canAccessApp('admin', 'backoffice'), true);
  assert.equal(canAccessApp('front_desk', 'frontoffice'), true);
  assert.equal(canAccessApp('front_desk', 'backoffice'), false);
  assert.equal(canAccessApp('pos_staff', 'backoffice'), false);
  assert.equal(canAccessApp('store_manager', 'stores'), true);
  assert.equal(canAccessApp('admin', 'missing-workspace'), false);
});

test('package tier gates workspace access', () => {
  assert.deepEqual(getPackageModules('none'), []);
  assert.equal(canAccessApp('admin', 'frontoffice', 'none'), false);
  assert.equal(canAccessApp('admin', 'backoffice', 'standard'), false);
  assert.equal(canAccessApp('admin', 'frontoffice', 'standard'), true);
  assert.equal(canAccessApp('admin', 'backoffice', 'professional'), true);
  assert.equal(canAccessApp('admin', 'backoffice', 'unrecognized-tier'), false);
});

test('default workspace selection never bypasses an explicit package restriction', () => {
  assert.equal(getDefaultApp('admin'), 'backoffice');
  assert.equal(getDefaultApp('front_desk'), 'frontoffice');
  assert.equal(getDefaultApp('admin', 'none'), null);
  assert.equal(getDefaultApp('admin', 'unrecognized-tier'), null);
});

test('route normalization preserves root and removes only trailing slashes and query/hash suffixes', () => {
  assert.equal(normalizeAppPath('/'), '/');
  assert.equal(normalizeAppPath('/frontoffice/room-planner/'), '/frontoffice/room-planner');
  assert.equal(normalizeAppPath('/backoffice/reports/sales///?range=month'), '/backoffice/reports/sales');
  assert.equal(normalizeAppPath('stores/settings/'), '/stores/settings');
});

test('canonical stores workspace ID is consistent across package tiers', () => {
  assert.ok(getPackageModules('premium').includes('stores'));
  assert.ok(getPackageModules('professional').includes('stores'));
  assert.equal(canAccessApp('store_manager', 'stores', 'premium'), true);
  assert.equal(canAccessApp('store_manager', 'stores', 'professional'), true);
  assert.equal(canAccessApp('store_manager', 'stores', 'standard'), false);
  assert.equal(canAccessApp('store_manager', 'stores', 'none'), false);
  assert.equal(canAccessApp('front_desk', 'stores', 'professional'), false);
  assert.equal(canAccessApp('admin', 'stores', 'premium'), true);
  assert.equal(canAccessApp('admin', 'stores', 'standard'), false);
  assert.equal(getDefaultApp('store_manager', 'professional'), 'stores');
});
