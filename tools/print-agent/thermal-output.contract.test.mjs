import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('print agent preserves centered leading spaces and feeds before partial cut', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(source, /replace\(\/\^\\\\n\+\|\\\\n\+\$\/g, ''\)/);
  assert.match(source, /Buffer\.from\(\[0x1b, 0x64, feedLines\]\)/);
  assert.match(source, /Buffer\.from\(\[0x1d, 0x56, 0x01\]\)/);
  assert.match(source, /socket\.end\(payload\)/);
  assert.match(source, /setTimeout\(\(\) => finish\(null\), 500\)/);
  assert.doesNotMatch(source, /socket\.write\(payload, \(err\) => finish\(err \|\| null\)\)/);
});

