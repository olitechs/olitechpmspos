import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('print agent preserves centered leading spaces and feeds before partial cut', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes(".replace(/^\\n+|\\n+$/g, '')"));
  assert.ok(source.includes('Buffer.from([0x1b, 0x64, feedLines])'));
  assert.ok(source.includes('Buffer.from([0x1d, 0x56, 0x01])'));
  assert.ok(source.includes('socket.end(payload)'));
  assert.ok(source.includes('setTimeout(() => finish(null), 1200)'));
  assert.ok(source.includes('8 + Math.floor'), 'thermal jobs receive an extended feed margin before cutting');
  assert.ok(!source.includes('socket.write(payload, (err) => finish(err || null))'));
});
