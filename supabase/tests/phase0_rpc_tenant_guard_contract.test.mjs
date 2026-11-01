import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../supabase/migrations/20261011120000_phase0_rpc_tenant_guard_remediation.sql', import.meta.url),
  'utf8',
);

test('POS menu RPC rejects null property IDs and enforces property membership', () => {
  assert.match(migration, /if p_property_id is null then[\s\S]*?errcode = '22023'/i);
  assert.match(migration, /public\.is_platform_owner\(\)[\s\S]*?public\.is_member_of_property\(p_property_id\)/i);
  assert.match(migration, /Not authorized to access this property menu/i);
});

test('pending property RPC binds caller identity unless using service role', () => {
  assert.match(migration, /auth\.uid\(\) is distinct from p_user_id/i);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(migration, /Not authorized to create a property for another user/i);
});

test('tenant guard migration keeps RPC grants narrow and revokes public/anonymous execution', () => {
  assert.match(migration, /revoke all on function public\.fn_list_pos_menu\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.fn_list_pos_menu\(uuid\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.create_pending_property_for_user\(uuid, text, text, text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.create_pending_property_for_user\(uuid, text, text, text\) to authenticated, service_role/i);
});

test('tenant guard migration is forward-only and transaction-bounded', () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.properties/i);
});
