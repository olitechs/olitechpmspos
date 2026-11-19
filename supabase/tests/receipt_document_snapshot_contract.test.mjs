import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('./../migrations/20261119050000_pos_receipt_document_snapshot.sql', import.meta.url),
  'utf8',
);

test('receipt document migration is additive and does not rewrite legacy receipts', () => {
  assert.match(migration, /add column if not exists receipt_document_snapshot jsonb/i);
  assert.match(migration, /Existing receipts are deliberately not backfilled/i);
  assert.doesNotMatch(migration, /update\s+public\.pos_receipts\s+set\s+receipt_document_snapshot\s*=/i);
});

test('both active VAT wrapper overloads allocate a receipt number for newly issued receipts', () => {
  const definitions = migration.match(/create or replace function public\.fn_record_pos_sale_with_vat_snapshot\(/gi) || [];
  assert.equal(definitions.length, 2);
  assert.equal((migration.match(/fn_allocate_document_number\(p_property_id, 'receipt', null\)/gi) || []).length, 2);
  assert.match(migration, /v_is_new := coalesce\(v_receipt\.created_at >= transaction_timestamp\(\), false\)/i);
});

test('issuance snapshot captures company identity, footer, receipt values and VAT snapshot', () => {
  for (const field of [
    'property_name', 'logo_url', 'address_line1', 'address_line2',
    'phone', 'email', 'website', 'kra_pin', 'extra_header_line',
    'footer_line1', 'footer_line2',
  ]) assert.ok(migration.includes(`'${field}'`), `missing company snapshot field ${field}`);

  for (const field of [
    'receipt_number', 'order_number', 'table_number', 'waiter', 'covers',
    'items', 'subtotal', 'discount_amount', 'discount_name', 'vat',
    'vat_snapshot', 'total', 'payment_method', 'created_by',
  ]) assert.ok(migration.includes(`'${field}'`), `missing receipt snapshot field ${field}`);
});

test('split tenders retain each payment method, amount and folio allocation', () => {
  assert.match(migration, /from public\.pos_receipt_payments rp[\s\S]*?rp\.payment_method[\s\S]*?rp\.amount[\s\S]*?rp\.reservation_id[\s\S]*?rp\.folio_charge_id/i);
  assert.match(migration, /when v_receipt\.payment_method <> 'split' then jsonb_build_array/i);
  assert.match(migration, /else '\[\]'::jsonb/i);
});

test('existing sale RPC remains the transactional authority and grants remain authenticated-only', () => {
  assert.equal((migration.match(/public\.fn_record_pos_sale\(/gi) || []).length, 2);
  assert.equal((migration.match(/revoke all on function public\.fn_record_pos_sale_with_vat_snapshot/gi) || []).length, 2);
  assert.equal((migration.match(/to authenticated;/gi) || []).length, 2);
  assert.doesNotMatch(migration, /drop function/i);
});
