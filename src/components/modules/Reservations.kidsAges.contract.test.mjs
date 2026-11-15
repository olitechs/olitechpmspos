import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Reservations.jsx', import.meta.url), 'utf8');

test('child age inputs use stable per-row keys instead of the array index', () => {
  assert.ok(source.includes("import { resizeStableKeys } from '@/lib/stableKeys';"));
  assert.ok(source.includes('kidKeysRef.current = resizeStableKeys(kidKeysRef.current, Number(data.kidsCount) || 0);'));
  assert.ok(source.includes('key={kidKeys[index] ?? index}'));
  assert.ok(!source.includes('key={index} label={`Child ${index + 1} age`}'));
});

test('child ages keep their existing persisted shape', () => {
  assert.ok(source.includes('kidsAges: data.kidsAges.map(Number)'));
  assert.ok(source.includes('kidsAges: data.kidsAges.map('));
});
