import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261104140000_repair_property_printer_cash_drawer_column.sql', import.meta.url),
  'utf8',
);

test('printer configuration column is added idempotently with a safe default', () => {
  assert.match(migration, /alter table public\.property_printers[\s\S]*?add column if not exists open_drawer_after_sale boolean not null default false/i);
  assert.match(migration, /comment on column public\.property_printers\.open_drawer_after_sale/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.property_printers/i);
});
