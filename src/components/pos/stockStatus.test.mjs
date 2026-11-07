import test from 'node:test';
import assert from 'node:assert/strict';
import { getPosStockStatus } from './stockStatus.js';

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
