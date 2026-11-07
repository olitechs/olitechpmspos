import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPosSaleItems,
  createPosSaleIdempotencyKey,
  isProductUuid,
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
