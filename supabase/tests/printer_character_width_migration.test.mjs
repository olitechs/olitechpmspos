import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/20261104205920_printer_character_width_20261104.sql', import.meta.url), 'utf8');

test('character width override is additive, bounded, nullable and schema-cache refreshed', () => {
  assert.match(migration, /add column if not exists character_width integer/i);
  assert.match(migration, /character_width is null or character_width between 24 and 64/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.doesNotMatch(migration, /drop table|truncate table/i);
});
