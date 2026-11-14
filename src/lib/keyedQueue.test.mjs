import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedQueue } from './keyedQueue.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('keyed queue commits work for one key in call order even when tasks finish out of order', async () => {
  const enqueue = createKeyedQueue();
  const order = [];
  const first = enqueue('table-1', async () => {
    await wait(25);
    order.push('first');
  });
  const second = enqueue('table-1', async () => {
    order.push('second');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']);
});

test('keyed queue lets different keys proceed independently', async () => {
  const enqueue = createKeyedQueue();
  const order = [];
  const slow = enqueue('table-1', async () => {
    await wait(25);
    order.push('slow');
  });
  const fast = enqueue('table-2', async () => {
    order.push('fast');
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['fast', 'slow']);
});

test('a failed task rejects its caller but does not block the next task for the same key', async () => {
  const enqueue = createKeyedQueue();
  const failed = enqueue('table-1', async () => {
    throw new Error('snapshot write failed');
  });
  await assert.rejects(failed, /snapshot write failed/);
  const recovered = await enqueue('table-1', async () => 'saved');
  assert.equal(recovered, 'saved');
});
