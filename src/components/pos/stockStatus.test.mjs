import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPosMenuItems, getPosStockStatus } from './stockStatus.js';

test('POS stock card status reflects available, low and out-of-stock quantities', () => {
  assert.equal(getPosStockStatus(8, 3), 'available');
  assert.equal(getPosStockStatus(3, 3), 'low-stock');
  assert.equal(getPosStockStatus(1, 3), 'low-stock');
  assert.equal(getPosStockStatus(0, 3), 'out-of-stock');
  assert.equal(getPosStockStatus(-2, 3), 'out-of-stock');
});

test('POS stock card status remains unknown when inventory data is absent or invalid', () => {
  assert.equal(getPosStockStatus(null, 3), 'unknown');
  assert.equal(getPosStockStatus(undefined, 3), 'unknown');
  assert.equal(getPosStockStatus('', 3), 'unknown');
  assert.equal(getPosStockStatus('unavailable', 3), 'unknown');
});

test('POS menu search is case-insensitive and preserves catalog order', () => {
  const items = [{ name: 'Hibiscus Tea' }, { name: 'Iced Coffee' }, { name: 'Tea Cake' }];
  assert.deepEqual(filterPosMenuItems(items, 'TEA'), [items[0], items[2]]);
  assert.deepEqual(filterPosMenuItems(items, 'coffee'), [items[1]]);
});

test('blank POS menu search preserves all category items', () => {
  const items = [{ name: 'Soda' }, { name: 'Water' }];
  assert.deepEqual(filterPosMenuItems(items, ''), items);
  assert.deepEqual(filterPosMenuItems(items, '   '), items);
});

test('POS menu search matches normalized accents, SKU and category tokens', () => {
  const items = [
    { name: 'Crème Brûlée', sku: 'D-001', category: 'Desserts' },
    { name: 'Iced Coffee', sku: 'B-014', category: 'Drinks' },
    { name: 'Tea Cake', sku: 'D-002', category: 'Desserts' }
  ];
  assert.deepEqual(filterPosMenuItems(items, 'creme brulee'), [items[0]]);
  assert.deepEqual(filterPosMenuItems(items, 'b-014'), [items[1]]);
  assert.deepEqual(filterPosMenuItems(items, 'desserts tea'), [items[2]]);
});
