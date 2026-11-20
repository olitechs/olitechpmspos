import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderPayload,
  canEditPriceAndStock,
  canManageMenuCategories,
  emptyMenuDraft,
  filterMenuItems,
  groupMenuItems,
  menuRowToDraft,
  moveWithin,
  nextSortOrder,
  roleOf,
} from './posMenuAdmin.js';

test('price and stock editing is limited to management roles', () => {
  for (const role of ['hotel_admin', 'manager', 'fb_manager', 'property_manager', 'general_manager', 'owner', 'admin', 'super_admin']) {
    assert.equal(canEditPriceAndStock({ staff: { role } }), true, `${role} should edit prices`);
  }
  for (const role of ['cashier', 'storekeeper', 'store_keeper', 'store_manager', 'waiter']) {
    assert.equal(canEditPriceAndStock({ staff: { role } }), false, `${role} must not edit prices`);
  }
  assert.equal(canEditPriceAndStock({ isPlatformOwner: true, staff: { role: 'cashier' } }), true);
  assert.equal(canEditPriceAndStock(null), false);
});

test('roleOf falls back to the property role when no staff record is loaded', () => {
  assert.equal(roleOf({ staff: { role: 'Manager' } }), 'manager');
  assert.equal(roleOf({ propertyRole: 'Cashier' }), 'cashier');
  assert.equal(roleOf({}), '');
});

test('category management mirrors the database can_manage_pos_menu helper', () => {
  for (const role of ['hotel_admin', 'super_admin', 'owner', 'admin', 'manager', 'property_manager', 'general_manager', 'fb_manager', 'cashier']) {
    assert.equal(canManageMenuCategories({ staff: { role } }), true, `${role} should manage categories`);
  }
  for (const role of ['storekeeper', 'store_keeper', 'store_manager', 'waiter', 'housekeeping']) {
    assert.equal(canManageMenuCategories({ staff: { role } }), false, `${role} must not write pos_menu_categories`);
  }
  assert.equal(canManageMenuCategories({ isPlatformOwner: true, staff: { role: 'storekeeper' } }), true);
  assert.equal(canManageMenuCategories(null), false);
});

test('moveWithin swaps in place immutably and rejects out-of-range moves', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const moved = moveWithin(rows, 2, -1);
  assert.deepEqual(moved.map((row) => row.id), ['a', 'c', 'b']);
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c'], 'the source array must not be mutated');
  assert.equal(moveWithin(rows, 0, -1), rows);
  assert.equal(moveWithin(rows, 2, 1), rows);
});

test('buildOrderPayload renumbers from zero', () => {
  assert.deepEqual(buildOrderPayload([{ id: 'x' }, { id: 'y' }]), [
    { id: 'x', sortOrder: 0 },
    { id: 'y', sortOrder: 1 },
  ]);
});

test('nextSortOrder appends after the highest existing value', () => {
  assert.equal(nextSortOrder([0, 2, 7]), 8);
  assert.equal(nextSortOrder([]), 1);
  assert.equal(nextSortOrder([undefined, '4']), 5);
});

test('groupMenuItems follows the configured category order and product sort', () => {
  const groups = groupMenuItems(
    [
      { id: '1', name: 'Latte', category: 'Drinks', pos_sort: 2 },
      { id: '2', name: 'Espresso', category: 'Drinks', pos_sort: 1 },
      { id: '3', name: 'Burger', category: 'Food', pos_sort: 1 },
      { id: '4', name: 'Unlisted', category: 'Other', pos_sort: 1 },
    ],
    [{ name: 'Food' }, { name: 'Drinks' }],
  );
  assert.deepEqual(groups.map((group) => group.name), ['Food', 'Drinks', 'Other']);
  assert.deepEqual(groups[1].items.map((item) => item.name), ['Espresso', 'Latte']);
});

test('filterMenuItems matches name, SKU and category', () => {
  const items = [
    { name: 'Cappuccino', sku: 'CAP-1', category: 'Drinks' },
    { name: 'Burger', sku: 'BUR-1', category: 'Food' },
  ];
  assert.deepEqual(filterMenuItems(items, { search: 'cap' }).map((item) => item.name), ['Cappuccino']);
  assert.deepEqual(filterMenuItems(items, { search: 'bur' }).map((item) => item.name), ['Burger']);
  assert.deepEqual(filterMenuItems(items, { category: 'Drinks' }).map((item) => item.name), ['Cappuccino']);
  assert.equal(filterMenuItems(items, {}).length, 2);
});

test('menuRowToDraft keeps max stock and visuals when an item is edited', () => {
  const draft = menuRowToDraft({
    id: 'p1',
    name: 'Latte',
    pos_category: 'Drinks',
    max_stock: '24',
    selling_price: '250.50',
    pos_sort: '3',
    pos_active: false,
    tile_color: 'brand-tile',
    tile_image_url: 'https://example.test/latte.png',
  });
  assert.equal(draft.category, 'Drinks');
  assert.equal(draft.max_stock, 24);
  assert.equal(draft.selling_price, 250.5);
  assert.equal(draft.pos_sort, 3);
  assert.equal(draft.pos_active, false);
  assert.equal(draft.tile_color, 'brand-tile');
  assert.equal(draft.tile_image_url, 'https://example.test/latte.png');
});

test('emptyMenuDraft starts with safe numeric defaults', () => {
  const draft = emptyMenuDraft('Food', 'Bar', 4);
  assert.equal(draft.category, 'Food');
  assert.equal(draft.production_center, 'Bar');
  assert.equal(draft.pos_sort, 4);
  assert.equal(draft.selling_price, 0);
  assert.equal(draft.current_stock, 0);
  assert.equal(draft.pos_active, true);
});
