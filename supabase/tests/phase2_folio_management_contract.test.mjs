import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/20261105100000_phase2_guest_folio_management.sql', import.meta.url), 'utf8');
const screen = await readFile(new URL('../../src/components/modules/Folio.jsx', import.meta.url), 'utf8');
const service = await readFile(new URL('../../src/services/pmsService.js', import.meta.url), 'utf8');
const regression = await readFile(new URL('./phase2_folio_management_regression.sql', import.meta.url), 'utf8');

test('folio phase extends existing charge/payment ledgers without duplicate accounting tables', () => {
  assert.match(migration, /alter table public\.folio_charges[\s\S]*?add column if not exists category/i);
  assert.match(migration, /alter table public\.payments[\s\S]*?add column if not exists idempotency_key/i);
  assert.doesNotMatch(migration, /create table(?: if not exists)? public\.(?:folios|folio_charges|payments)\b/i);
  assert.match(migration, /create unique index if not exists payments_property_idempotency_uidx/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /add column if not exists folio_charge_id/i);
  assert.match(migration, /unallocated balance of the selected charge/i);
});

test('server operations cover payment, refund, reversal, discount and folio transfer with tenant and role guards', () => {
  for (const fn of ['fn_post_folio_charge','fn_post_folio_payment','fn_post_folio_refund','fn_reverse_folio_charge','fn_apply_folio_discount','fn_transfer_folio_charges']) {
    assert.match(migration, new RegExp('function public\\.' + fn + '\\('));
  }
  assert.match(migration, /public\.is_member_of_property\(p_property_id\)/i);
  assert.match(migration, /coalesce\(public\.is_platform_owner\(\)[\s\S]*?false\)/i);
  assert.match(migration, /Manager approval is required to refund/i);
  assert.match(migration, /Manager approval is required to apply a folio discount/i);
  assert.match(migration, /already been reversed/i);
  assert.match(migration, /folio_charge_transferred/i);
  assert.match(migration, /folio_payment_refunded/i);
  assert.doesNotMatch(migration, /delete from public\.(?:payments|folio_charges)/i);
});

test('service layer calls the authoritative folio RPCs and reads existing account ledgers', () => {
  for (const method of ['postFolioCharge','postFolioPayment','refundFolioPayment','reverseFolioCharge','applyFolioDiscount','transferFolioCharges','listFolioRefunds']) {
    assert.match(service, new RegExp('async ' + method + '\\('));
  }
  for (const rpc of ['fn_post_folio_charge','fn_post_folio_payment','fn_post_folio_refund','fn_reverse_folio_charge','fn_apply_folio_discount','fn_transfer_folio_charges']) {
    assert.ok(service.includes(rpc), 'Missing service RPC ' + rpc);
  }
});

test('guest folio screen exposes statement, receipt, transaction categories and account operations', () => {
  for (const value of ['Accommodation','Restaurant','Bar','Laundry','Airport transfers','Excursions','Room service','Other services','Taxes and adjustments','Folio statement','Receipt','Refund','Reverse','Split / transfer','Take payment','Outstanding balance','Allocate payment to charge']) {
    assert.ok(screen.includes(value), 'Missing folio UI feature: ' + value);
  }
  assert.match(screen, /DocumentExportMenu/);
  assert.doesNotMatch(screen, /window\.print\(\)|html2canvas|Export CSV|Print statement/);
  assert.match(screen, /source_module/);
  assert.match(screen, /created_by/);
  assert.match(screen, /Math\.max\(postedChargeTotal, bookingTotal\)/);
  assert.match(screen, /Payment recorded:/);
  assert.match(screen, /typeof success === 'function'/);
});

test('disposable database regression covers the requested accounting acceptance paths', () => {
  for (const phrase of ['idempotency','partial refund','Charge reversal','Full settlement reconciliation','Folio split','Folio consolidation','Permission denial','Cross-property payment']) {
    assert.ok(regression.toLowerCase().includes(phrase.toLowerCase()), 'Missing regression coverage: ' + phrase);
  }
});
