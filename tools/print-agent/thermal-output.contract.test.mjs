import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('thermal output uses controlled feed and partial paper cut', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(source, /enc\.encode\(body \+ '\\n\\n'\)/);
  assert.match(source, /Buffer\.from\(\[0x1d, 0x56, 0x01\]\)/);
  assert.doesNotMatch(source, /Buffer\.from\(\[0x1d, 0x56, 0x00\]\)/);
});
