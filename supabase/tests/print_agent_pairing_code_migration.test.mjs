import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261122090000_fix_print_agent_pairing_code_generation.sql', import.meta.url),
  'utf8',
);

test('pairing-code repair preserves the RPC signature and generates from all 32 symbols', () => {
  assert.match(migration, /drop function if exists public\\.fn_create_print_agent_pairing\\(text, uuid\\)/i);
  assert.match(migration, /fn_create_print_agent_pairing\(\s*p_property_id uuid,\s*p_name text\)/);
  assert.match(migration, /v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'/);
  assert.match(migration, /get_byte\(gen_random_bytes\(1\), 0\) % 32/);
  assert.match(migration, /returns table\(credential_id uuid, code text, expires_at timestamptz\)/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(migration, /translate\s*\(/i);
});
