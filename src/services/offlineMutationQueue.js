const DB_NAME = 'olitechs-offline-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';

export const OFFLINE_MUTATION_STATUS = Object.freeze({
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  REJECTED: 'rejected',
});

const QUEUEABLE_DRAFT_OPERATIONS = new Set([
  'pos.order.draft',
  'reservation.draft',
  'inventory.count.draft',
]);
const SENSITIVE_KEY = /pin|password|passwd|secret|token|authorization|access.?key|refresh.?key|card.?number|cvv|cvc/i;
const TERMINAL_STATES = new Set(['synced', 'conflict', 'rejected']);
const ALLOWED_TRANSITIONS = {
  pending: new Set(['in_flight', 'rejected']),
  in_flight: new Set(['pending', 'synced', 'conflict', 'rejected']),
  synced: new Set(),
  conflict: new Set(['pending', 'rejected']),
  rejected: new Set(),
};

function assertNoCredentials(value, path = 'payload') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Offline payload contains a prohibited sensitive field at ${path}.`);
    }
    assertNoCredentials(child, `${path}.${key}`);
  }
}

export function assertQueueableOfflineOperation(operation) {
  if (!QUEUEABLE_DRAFT_OPERATIONS.has(operation)) {
    throw new Error('This operation is not eligible for offline queuing.');
  }
}

export function createOfflineMutationRecord(input, now = Date.now()) {
  const {
    operation,
    propertyId,
    actorUserId = null,
    staffSessionId = null,
    payload,
    payloadVersion = 1,
    idempotencyKey,
  } = input || {};

  assertQueueableOfflineOperation(operation);
  if (typeof propertyId !== 'string' || !propertyId.trim()) {
    throw new Error('A property ID is required for an offline mutation.');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new Error('A stable idempotency key is required.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Offline mutation payload must be an object.');
  }
  if (!Number.isInteger(payloadVersion) || payloadVersion < 1) {
    throw new Error('Payload version must be a positive integer.');
  }
  assertNoCredentials(payload);
  const serialized = JSON.stringify(payload);
  if (serialized.length > 128_000) throw new Error('Offline mutation payload exceeds 128 KB.');

  return {
    idempotencyKey,
    operation,
    operationVersion: 1,
    propertyId: propertyId.trim(),
    actorUserId,
    staffSessionId,
    createdAt: new Date(now).toISOString(),
    payloadVersion,
    payload: JSON.parse(serialized),
    retryCount: 0,
    status: OFFLINE_MUTATION_STATUS.PENDING,
    lastErrorCode: null,
    serverRecordId: null,
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

export function openOfflineOutbox(indexedDBApi = globalThis.indexedDB) {
  if (!indexedDBApi?.open) {
    return Promise.reject(new Error('Offline storage is unavailable in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'idempotencyKey' });
        store.createIndex('propertyId', 'propertyId', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Unable to open offline storage.'));
    request.onblocked = () => reject(new Error('Offline storage upgrade is blocked by another open tab.'));
  });
}

/**
 * Durable local outbox only. This module deliberately does not replay records:
 * the server must deduplicate idempotency keys and re-check current permissions
 * before a separate, reviewed sync worker may submit any queued mutation.
 */
export function createOfflineOutbox({ indexedDBApi = globalThis.indexedDB } = {}) {
  async function withStore(mode, callback) {
    const db = await openOfflineOutbox(indexedDBApi);
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const result = await callback(store, transaction);
      await transactionDone(transaction);
      return result;
    } finally {
      db.close();
    }
  }

  return {
    async enqueue(input) {
      const record = createOfflineMutationRecord(input);
      return withStore('readwrite', async (store) => {
        // add(), not put(), prevents a duplicate key from silently replacing
        // an earlier offline intent.
        await requestResult(store.add(record));
        return record;
      });
    },

    async listByProperty(propertyId, statuses = null) {
      if (typeof propertyId !== 'string' || !propertyId.trim()) {
        throw new Error('A property ID is required to read the offline queue.');
      }
      return withStore('readonly', async (store) => {
        const records = await requestResult(store.index('propertyId').getAll(propertyId.trim()));
        return records
          .filter((record) => !statuses || statuses.includes(record.status))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
    },

    async transition(idempotencyKey, nextStatus, patch = {}) {
      if (!Object.values(OFFLINE_MUTATION_STATUS).includes(nextStatus)) {
        throw new Error('Unknown offline mutation status.');
      }
      const forbiddenPatchKeys = ['idempotencyKey', 'propertyId', 'operation', 'payload', 'createdAt', 'actorUserId', 'staffSessionId'];
      if (Object.keys(patch).some((key) => forbiddenPatchKeys.includes(key))) {
        throw new Error('Immutable offline mutation fields cannot be changed.');
      }
      return withStore('readwrite', async (store) => {
        const record = await requestResult(store.get(idempotencyKey));
        if (!record) throw new Error('Offline mutation was not found.');
        if (TERMINAL_STATES.has(record.status) && !ALLOWED_TRANSITIONS[record.status].has(nextStatus)) {
          throw new Error(`Cannot transition an offline mutation from ${record.status} to ${nextStatus}.`);
        }
        if (!ALLOWED_TRANSITIONS[record.status]?.has(nextStatus)) {
          throw new Error(`Invalid offline mutation transition: ${record.status} -> ${nextStatus}.`);
        }
        const updated = {
          ...record,
          ...patch,
          status: nextStatus,
          retryCount: nextStatus === 'in_flight' ? record.retryCount + 1 : record.retryCount,
        };
        await requestResult(store.put(updated));
        return updated;
      });
    },
  };
}
