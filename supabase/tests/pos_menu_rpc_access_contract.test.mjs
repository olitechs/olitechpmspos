import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261108110000_pos_menu_rpc_authorization.sql', import.meta.url),
  'utf8',
);

const menuRpc = migration.match(
  /create or replace function public\.fn_list_pos_menu\(p_property_id uuid\)([\s\S]*?)\$function\$;/i,
)?.[1] || '';

test('POS menu RPC rejects missing identity and null property IDs', () => {
  assert.match(menuRpc, /if p_property_id is null then[\s\S]*?errcode = '22023'/i);
  assert.match(menuRpc, /if auth\.uid\(\) is null then[\s\S]*?errcode = '42501'/i);
  assert.match(menuRpc, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
});

test('POS menu RPC requires tenant membership before returning menu data', () => {
  assert.match(menuRpc, /public\.is_platform_owner\(\)[\s\S]*?public\.is_member_of_property\(p_property_id\)/i);
  assert.match(menuRpc, /Not authorized to access this property menu/i);
  assert.match(menuRpc, /where p\.property_id = p_property_id/i);
});

test('POS menu RPC checks POS roles or explicit POS module assignment and fails closed on NULL roles', () => {
  assert.match(menuRpc, /coalesce\(public\.property_role\(p_property_id\) in \('owner', 'admin', 'manager', 'cashier', 'waiter'\), false\)/i);
  assert.match(menuRpc, /coalesce\(public\.current_staff_role\(p_property_id\) in \([\s\S]*?'front_desk'[\s\S]*?\), false\)/i);
  assert.match(menuRpc, /'pos' = any\(coalesce\(s\.assigned_modules, array\[\]::text\[\]\)\)/i);
  assert.doesNotMatch(menuRpc, /public\.current_staff_role\(p_property_id\) is not null/i);
  assert.match(menuRpc, /POS module access required/i);
});

test('POS menu RPC retains trusted service-role access and denies public/anonymous execution', () => {
  assert.match(menuRpc, /auth\.role\(\)/i);
  assert.match(menuRpc, /service_role/i);
  assert.match(migration, /revoke all on function public\.fn_list_pos_menu\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.fn_list_pos_menu\(uuid\) to authenticated, service_role/i);
});

test('POS menu authorization migration is transactional and does not mutate menu or stock rows', () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /insert into public\.(products|pos_menu_categories)|update public\.(products|pos_menu_categories)|delete from public\.(products|pos_menu_categories)/i);
});
