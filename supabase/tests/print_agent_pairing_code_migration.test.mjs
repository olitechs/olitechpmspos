import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261122090000_fix_print_agent_pairing_code_generation.sql', import.meta.url),
  'utf8',
);

test('pairing-code repair preserves the RPC signature and generates from all 32 symbols', () => {
  assert.ok(migration.includes('drop function if exists public.fn_create_print_agent_pairing(text, uuid);'));
  const rpcStart = migration.indexOf('create or replace function public.fn_create_print_agent_pairing(');
  const rpcEnd = migration.indexOf(') returns table', rpcStart);
  assert.ok(rpcStart >= 0 && rpcEnd > rpcStart, 'canonical pairing RPC definition exists');
  const rpcSignature = migration.slice(rpcStart, rpcEnd);
  assert.ok(rpcSignature.indexOf('p_property_id uuid') < rpcSignature.indexOf('p_name text'), 'RPC argument order remains (uuid, text)');
  assert.ok(migration.includes("v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';"));
  assert.ok(migration.includes('v_random bytea := extensions.gen_random_bytes(16);'));
  assert.ok(migration.includes('for v_index in 0..15 loop'));
  assert.ok(migration.includes('get_byte(v_random, v_index) % 32'));
  assert.ok(migration.includes('returns table(credential_id uuid, code text, expires_at timestamptz)'));
  assert.ok(migration.includes("notify pgrst, 'reload schema';"));
  assert.ok(!migration.includes('v_code := translate('));
});
