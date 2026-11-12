import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignmentTypeForDepartment,
  normalizeDepartment,
  planDepartmentTickets,
  printersForDepartment,
  resolveLineDepartment,
} from './printDepartmentRoutingCore.js';

const categories = [
  { id: 'c-grill', name: 'Steaks', production_center: 'Grill' },
  { id: 'c-dessert', name: 'Desserts', production_center: 'Pastry' },
  { id: 'c-beer', name: 'Beers', production_center: 'Bar' },
];

test('a category production centre becomes the department, not "food"', () => {
  const resolved = resolveLineDepartment({ categoryId: 'c-grill' }, { categories });
  assert.equal(resolved.department, 'Grill');
  assert.equal(resolved.source, 'category');
});

test('a category name is matched case-insensitively when no id is sent', () => {
  assert.equal(resolveLineDepartment({ category: 'desserts' }, { categories }).department, 'Pastry');
});

test('a printer group overrides the category centre and matches its name when it has none', () => {
  const groups = [{ id: 'g1', name: 'Cold Larder', categoryIds: ['c-dessert'] }];
  const resolved = resolveLineDepartment({ categoryId: 'c-dessert' }, { categories, groups });
  assert.equal(resolved.department, 'Cold Larder');
  assert.equal(resolved.source, 'group');

  const centred = [{ id: 'g2', name: 'Pastry station', productionCenter: 'Pastry', categoryIds: ['c-dessert'] }];
  assert.equal(resolveLineDepartment({ categoryId: 'c-dessert' }, { categories, groups: centred }).department, 'Pastry');
});

test('an item centre is used when the category has no production centre', () => {
  const resolved = resolveLineDepartment({ category: 'Unknown', center: 'Housekeeping' }, { categories: [] });
  assert.equal(resolved.department, 'Housekeeping');
  assert.equal(resolveLineDepartment({}, {}).department, 'Kitchen');
});

test('printers match their department case-insensitively and never by accident', () => {
  const printers = [
    { id: 'p1', department: 'grill' },
    { id: 'p2', department: 'Bar' },
    { id: 'p3', department: null },
  ];
  assert.deepEqual(printersForDepartment('Grill', printers).map((p) => p.id), ['p1']);
  assert.deepEqual(printersForDepartment('PASTRY', printers), []);
  assert.deepEqual(printersForDepartment('', printers), []);
});

test('one order produces one ticket per department in first-seen order', () => {
  const tickets = planDepartmentTickets(
    [
      { name: 'Steak', categoryId: 'c-grill' },
      { name: 'Beer', categoryId: 'c-beer' },
      { name: 'Ribeye', categoryId: 'c-grill' },
    ],
    { categories },
  );
  assert.deepEqual(tickets.map((t) => t.department), ['Grill', 'Bar']);
  assert.equal(tickets[0].lines.length, 2);
  assert.equal(tickets[1].assignmentType, 'drinks_orders');
  assert.equal(tickets[0].assignmentType, 'food_orders');
});

test('departments keep the legacy food/drinks assignment for fallback', () => {
  assert.equal(assignmentTypeForDepartment('Bar'), 'drinks_orders');
  assert.equal(assignmentTypeForDepartment('Cocktails'), 'drinks_orders');
  assert.equal(assignmentTypeForDepartment('Grill'), 'food_orders');
  assert.equal(assignmentTypeForDepartment('Dessert'), 'food_orders');
  assert.equal(normalizeDepartment('   '), 'Kitchen');
});
