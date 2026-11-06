import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/20261106190000_pos_access_pin_and_shift_close.sql', import.meta.url), 'utf8');

test('property POS access PIN is hashed, defaulted and protected by RLS', () => {
  assert.match(sql, /crypt\('1234',\s*extensions\.gen_salt\('bf'\)\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.pos_access_credentials from public, anon, authenticated/i);
  assert.match(sql, /failed_attempts \+ 1/i);
  assert.match(sql, /interval '15 minutes'/i);
  assert.match(sql, /fn_reset_pos_access_pin/i);
});

test('shift close is blocked by active table sessions and reconciles split tenders', () => {
  assert.match(sql, /from public\.pos_table_sessions[\s\S]*?status <> 'closed'/i);
  assert.match(sql, /join public\.pos_receipt_payments/i);
  assert.match(sql, /r\.pos_shift_id = p_shift_id or r\.shift_id = p_shift_id/i);
  assert.match(sql, /total_covers = v_covers/i);
  assert.match(sql, /cash_variance = v_variance/i);
});

test('sale wrapper persists guest covers', () => {
  assert.match(sql, /p_covers integer default 1/i);
  assert.match(sql, /covers = greatest\(1, least\(p_covers, 1000\)\)/i);
});
