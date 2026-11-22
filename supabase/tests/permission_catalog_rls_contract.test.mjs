import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261122094000_permission_catalog_rls_readonly.sql', import.meta.url),
  'utf8',
);

test('permission catalogue is protected by RLS and readable only by signed-in users', () => {
  assert.match(migration, /alter table public\.permission_catalog enable row level security/i);
  assert.match(migration, /create policy permission_catalog_authenticated_read[\s\S]*?for select[\s\S]*?to authenticated[\s\S]*?using \(true\)/i);
  assert.match(migration, /revoke all on table public\.permission_catalog from public, anon/i);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?from authenticated/i);
  assert.match(migration, /grant select on table public\.permission_catalog to authenticated/i);
});

test('permission catalogue migration preserves the seeded catalogue and role mappings', () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /\bcommit;\s*$/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from public\.permission_catalog)\b/i);
});
