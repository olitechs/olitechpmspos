import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPosSaleItems,
  createPosSaleIdempotencyKey,
  isProductUuid,
  resolvePosSaleStockMappings,
} from './posSaleContract.js';

const PRODUCT_ID = '5e5f1b2c-7f3b-4c8e-9a15-3c41f52e2d01';

 test('sale idempotency key is stable across retries for one property, table, and order', () => {
  const identity = { propertyId: 'property-a', tableKey: 'table-7', orderNumber: 'ORD-007-A1B2C3' };
  assert.equal(createPosSaleIdempotencyKey(identity), createPosSaleIdempotencyKey({ ...identity }));
  assert.equal(createPosSaleIdempotencyKey(identity), 'pos-sale:v1:property-a:table-7:ORD-007-A1B2C3');
});

test('sale idempotency keys are isolated by property, table, and check', () => {
  const base = { propertyId: 'property-a', tableKey: 'table-7', orderNumber: 'check-1' };
  const keys = [
    createPosSaleIdempotencyKey(base),
    createPosSaleIdempotencyKey({ ...base, propertyId: 'property-b' }),
    createPosSaleIdempotencyKey({ ...base, tableKey: 'table-8' }),
    createPosSaleIdempotencyKey({ ...base, orderNumber: 'check-2' }),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('idempotency key requires the complete stable order identity', () => {
  assert.throws(() => createPosSaleIdempotencyKey({ propertyId: 'property-a', tableKey: 'table-7' }), /order identity/);
});

test('POS receipt line payload preserves stable line identity and direct product mapping', () => {
  const [item] = buildPosSaleItems([
    { id: 'line-product-modifier', productId: PRODUCT_ID, name: 'Grilled fish', qty: 2, price: 18, basePrice: 16, modifierTotal: 2, modifiers: [{ id: 'extra', name: 'Extra sauce' }] },
  ]);
  assert.equal(item.order_line_id, 'line-product-modifier');
  assert.equal(item.product_id, PRODUCT_ID);
  assert.equal(item.stock_tracking_status, 'product');
  assert.equal(item.qty, 2);
  assert.deepEqual(item.modifiers, [{ id: 'extra', name: 'Extra sauce' }]);
});

test('recipe mapping is recognized by menu name without inventing a direct stock product', () => {
  const [item] = buildPosSaleItems(
    [{ id: 'recipe-line', productId: 'legacy-menu-id', name: 'Coconut fish curry', qty: 2, price: 22 }],
    [{ menu_item_name: 'Coconut Fish Curry' }]
  );
  assert.equal(item.product_id, null);
  assert.equal(item.stock_tracking_status, 'recipe');
});

test('unlinked and unverifiable POS items are explicitly marked rather than silently treated as tracked', () => {
  const [unlinked] = buildPosSaleItems([{ id: 'legacy-menu-id', name: 'House special', qty: 1 }]);
  const [unverified] = buildPosSaleItems([{ id: 'legacy-menu-id', name: 'House special', qty: 1 }], [], false);
  assert.equal(unlinked.product_id, null);
  assert.equal(unlinked.stock_tracking_status, 'unlinked');
  assert.equal(unverified.stock_tracking_status, 'unverified');
});

test('product UUID validation excludes malformed and empty catalog identifiers', () => {
  assert.equal(isProductUuid(PRODUCT_ID), true);
  assert.equal(isProductUuid('menu-item-1'), false);
  assert.equal(isProductUuid(''), false);
});


test('stock mapping resolves valid product IDs, unique legacy names and active recipes', () => {
  const products = [
    { id: PRODUCT_ID, name: 'Grilled fish' },
    { id: '6e5f1b2c-7f3b-4c8e-9a15-3c41f52e2d02', name: 'Fresh juice' },
  ];
  const recipes = [{ menu_item_name: 'Coconut fish curry', active: true, recipe_ingredients: [{ product_id: PRODUCT_ID, qty: 1 }] }];
  const items = resolvePosSaleStockMappings([
    { id: 'direct', productId: PRODUCT_ID, name: 'Grilled fish', qty: 1 },
    { id: 'legacy', productId: 'legacy-menu-2', name: 'Fresh juice', qty: 2 },
    { id: 'recipe', productId: 'legacy-menu-3', name: 'Coconut Fish Curry', qty: 1 },
  ], products, recipes);
  assert.deepEqual(items.map((item) => item.stock_tracking_status), ['product', 'product', 'recipe']);
  assert.equal(items[1].product_id, products[1].id);
  assert.equal(items[2].product_id, null);
});

test('stock mapping refuses missing and ambiguous Store product matches', () => {
  const items = resolvePosSaleStockMappings([
    { id: 'missing', productId: 'legacy-1', name: 'Unknown dish', qty: 1 },
    { id: 'ambiguous', productId: 'legacy-2', name: 'Water', qty: 1 },
  ], [
    { id: PRODUCT_ID, name: 'Water' },
    { id: '6e5f1b2c-7f3b-4c8e-9a15-3c41f52e2d02', name: 'Water' },
  ], []);
  assert.deepEqual(items.map((item) => item.stock_tracking_status), ['unlinked', 'unlinked']);
});

test('stock mapping lookup failure marks legacy lines unverified', () => {
  const [item] = resolvePosSaleStockMappings([{ id: 'legacy', name: 'Unknown dish', qty: 1 }], [], [], false);
  assert.equal(item.stock_tracking_status, 'unverified');
});


test('active recipes require valid ingredient product links and positive quantities', () => {
  const validIngredient = { product_id: PRODUCT_ID, qty: 0.25 };
  const recipes = [
    { menu_item_name: 'Complete recipe', active: true, recipe_ingredients: [validIngredient] },
    { menu_item_name: 'Missing recipe ingredients', active: true, recipe_ingredients: [] },
    { menu_item_name: 'Foreign or missing ingredient', active: true, recipe_ingredients: [{ product_id: '6e5f1b2c-7f3b-4c8e-9a15-3c41f52e2d02', qty: 1 }] },
  ];
  const items = resolvePosSaleStockMappings([
    { id: 'valid', name: 'Complete recipe', qty: 1 },
    { id: 'empty', name: 'Missing recipe ingredients', qty: 1 },
    { id: 'foreign', name: 'Foreign or missing ingredient', qty: 1 },
  ], [{ id: PRODUCT_ID, name: 'Ingredient' }], recipes);
  assert.deepEqual(items.map((item) => item.stock_tracking_status), ['recipe', 'recipe_incomplete', 'recipe_incomplete']);
});
