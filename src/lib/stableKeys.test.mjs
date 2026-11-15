import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeStableKeys } from './stableKeys.js';

test('growing a keyed list keeps the keys already in use', () => {
  const first = resizeStableKeys([], 2);
  assert.equal(new Set(first).size, 2);
  const grown = resizeStableKeys(first, 4);
  assert.deepEqual(grown.slice(0, 2), first);
  assert.equal(new Set(grown).size, 4);
});

test('shrinking a keyed list keeps the remaining rows stable', () => {
  const keys = resizeStableKeys([], 3);
  const trimmed = resizeStableKeys(keys, 1);
  assert.deepEqual(trimmed, [keys[0]]);
});

test('a row added after a shrink gets a fresh key, never a recycled one', () => {
  const keys = resizeStableKeys([], 2);
  const trimmed = resizeStableKeys(keys, 1);
  const regrown = resizeStableKeys(trimmed, 2);
  assert.notEqual(regrown[1], keys[1]);
});

test('invalid or negative counts produce an empty list', () => {
  assert.deepEqual(resizeStableKeys([], -1), []);
  assert.deepEqual(resizeStableKeys([], Number.NaN), []);
  assert.deepEqual(resizeStableKeys(undefined, 1).length, 1);
});
