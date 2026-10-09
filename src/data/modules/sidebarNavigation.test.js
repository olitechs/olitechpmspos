import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_ROLES, SIDEBAR_SECTIONS } from './sidebarNavigation.js';

test('sidebar navigation sections and item IDs are unique and complete', () => {
  assert.equal(new Set(SIDEBAR_SECTIONS.map(section => section.key)).size, SIDEBAR_SECTIONS.length);
  const items = SIDEBAR_SECTIONS.flatMap(section => section.items);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  for (const item of items) {
    assert.ok(item.label, item.id + ' should have a label');
    assert.ok(item.path.startsWith('/'), item.id + ' should have an absolute app path');
    assert.ok(Array.isArray(item.roles) && item.roles.length > 0, item.id + ' should declare role access');
    assert.ok(item.icon, item.id + ' should declare a Lucide icon');
  }
});

test('sidebar master roles remain explicit and restricted routes retain role declarations', () => {
  assert.equal(MASTER_ROLES.has('hotel_admin'), true);
  assert.equal(MASTER_ROLES.has('super_admin'), true);
  assert.equal(MASTER_ROLES.has('front_desk'), false);
  const items = SIDEBAR_SECTIONS.flatMap(section => section.items);
  const planner = items.find(item => item.id === 'room-planner');
  const accessRights = items.find(item => item.id === 'access-rights');
  assert.ok(planner.roles.includes('front_desk'));
  assert.ok(accessRights.roles.includes('hotel_admin'));
  assert.ok(!accessRights.roles.includes('front_desk'));
});
