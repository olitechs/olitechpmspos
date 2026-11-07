import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pinSql = readFileSync(new URL('../migrations/20261106190100_pos_property_access_pin.sql', import.meta.url), 'utf8');
const shiftSql = readFileSync(new URL('../migrations/20261106190200_pos_shift_closing_reports.sql', import.meta.url), 'utf8');

test('property POS PIN defaults to a private bcrypt hash and is admin-resettable', () => {
  assert.match(pinSql, /crypt\('1234',\s*extensions\.gen_salt\('bf',\s*12\)\)/i);
  assert.match(pinSql, /enable row level security/i);
  assert.match(pinSql, /revoke all on table public\.pos_access_credentials from public, anon, authenticated/i);
  assert.match(pinSql, /failed_attempts \+ 1/i);
  assert.match(pinSql, /interval '15 minutes'/i);
  assert.match(pinSql, /fn_reset_pos_access_pin/i);
  assert.match(pinSql, /Choose a PIN different from the initial default 1234/i);
});

test('shift close is blocked by active tables and reconciles split tenders', () => {
  assert.match(shiftSql, /from public\.pos_table_sessions[\s\S]*?status <> 'closed'/i);
  assert.match(shiftSql, /join public\.pos_receipt_payments/i);
  assert.match(shiftSql, /r\.pos_shift_id = p_shift_id or r\.shift_id = p_shift_id/i);
  assert.match(shiftSql, /do not reconcile to their receipt totals/i);
  assert.match(shiftSql, /pg_advisory_xact_lock/i);
  assert.match(shiftSql, /total_covers = v_covers/i);
  assert.match(shiftSql, /cash_variance = v_variance/i);
  assert.match(shiftSql, /from public\.cashier_refunds/i);
  assert.match(shiftSql, /gross_sales = v_gross/i);
  assert.match(shiftSql, /refunds_total = v_refunds/i);
  assert.match(shiftSql, /voided_total = v_voided/i);
  assert.match(shiftSql, /settlement_method/i);
});

test('receipt sale RPC persists guest covers', () => {
  assert.match(shiftSql, /p_covers integer default 1/i);
  assert.match(shiftSql, /covers = greatest\(1, least\(p_covers, 1000\)\)/i);
});

test('opening a POS shift requires a positive starting cash float', () => {
  assert.match(shiftSql, /if p_opening_cash is null or p_opening_cash <= 0 then/i);
  assert.match(shiftSql, /starting cash float greater than zero is required/i);
});

test('close-shift approval controls use the defined manager permission flag', () => {
  const closeShiftUi = readFileSync(new URL('../../src/components/pos/CloseShiftModal.jsx', import.meta.url), 'utf8');
  assert.match(closeShiftUi, /canApproveWithoutStaffPin/);
  assert.doesNotMatch(closeShiftUi, /canApproveAsPropertyAdmin/);
});
