import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertQueueableOfflineOperation,
  createOfflineMutationRecord,
  openOfflineOutbox,
} from './offlineMutationQueue.js';
import {
  assertMutationProperty,
  propertyQueryKeys,
  requirePropertyId,
} from '../lib/propertyQueryKeys.js';

test('offline outbox creates a versioned, property-bound provisional record', () => {
  const record = createOfflineMutationRecord({
    operation: 'pos.order.draft',
    propertyId: ' property-a ',
    actorUserId: 'user-1',
    staffSessionId: 'session-reference-only',
    payload: { items: [{ productId: 'item-1', quantity: 2 }] },
    idempotencyKey: 'stable-key-1',
  }, Date.UTC(2026, 9, 19));

  assert.equal(record.propertyId, 'property-a');
  assert.equal(record.status, 'pending');
  assert.equal(record.operationVersion, 1);
  assert.equal(record.payloadVersion, 1);
  assert.equal(record.retryCount, 0);
  assert.equal(record.idempotencyKey, 'stable-key-1');
  assert.equal(record.createdAt, '2026-10-19T00:00:00.000Z');
});

test('offline outbox fails closed for financial/admin operations and credentials', () => {
  for (const operation of ['pos.refund', 'pos.void', 'staff.pin.change', 'subscription.update', 'payment.capture']) {
    assert.throws(() => assertQueueableOfflineOperation(operation), /not eligible/);
  }
  assert.throws(() => createOfflineMutationRecord({
    operation: 'pos.order.draft',
    propertyId: 'property-a',
    idempotencyKey: 'key-2',
    payload: { nested: { accessToken: 'must-not-persist' } },
  }), /prohibited sensitive field/);
});

test('offline outbox rejects missing tenant, unstable key, bad versions, and oversized payloads', () => {
  const base = {
    operation: 'reservation.draft',
    propertyId: 'property-a',
    idempotencyKey: 'key-3',
    payload: { arrivalDate: '2026-11-01' },
  };
  assert.throws(() => createOfflineMutationRecord({ ...base, propertyId: ' ' }), /property ID is required/);
  assert.throws(() => createOfflineMutationRecord({ ...base, idempotencyKey: '' }), /idempotency key is required/);
  assert.throws(() => createOfflineMutationRecord({ ...base, payloadVersion: 0 }), /positive integer/);
  assert.throws(() => createOfflineMutationRecord({ ...base, payload: { data: 'x'.repeat(129_000) } }), /exceeds 128 KB/);
});

test('outbox reports unavailable storage instead of pretending to persist', async () => {
  await assert.rejects(openOfflineOutbox(null), /unavailable in this browser/);
});

test('property query keys and mutation guards remain tenant-scoped', () => {
  assert.deepEqual(propertyQueryKeys.rooms('property-a'), ['property', 'property-a', 'rooms', {}]);
  assert.notDeepEqual(propertyQueryKeys.posOrders('property-a'), propertyQueryKeys.posOrders('property-b'));
  assert.equal(requirePropertyId(' property-a '), 'property-a');
  assert.equal(assertMutationProperty('property-a', 'property-a'), 'property-a');
  assert.throws(() => requirePropertyId(''), /property ID is required/);
  assert.throws(() => assertMutationProperty('property-a', 'property-b'), /Cross-property mutation rejected/);
});
