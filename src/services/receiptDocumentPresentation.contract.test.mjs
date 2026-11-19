import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFolioStatementDefinition, buildFinalSettlementInvoiceDefinition } from './reportDefinitions.js';

const receipt = {
  id: 'receipt-001',
  property_id: 'property-001',
  receipt_number: 'RC-2026-0042',
  order_number: 'ORD-42',
  receipt_status: 'issued',
  created_at: '2026-11-19T08:00:00.000Z',
  room_number: '12',
  table_number: 'T4',
  payment_method: 'split',
  subtotal: 1000,
  discount_amount: 50,
  vat: 152,
  total: 1102,
  items: [{ name: 'Grilled fish', qty: 2, price: 500, total: 1000, category: 'Seafood', department: 'Kitchen' }],
  pos_receipt_payments: [
    { id: 'tender-1', payment_method: 'cash', amount: 500 },
    { id: 'tender-2', payment_method: 'room', amount: 602, reservation_id: 'reservation-001', folio_charge_id: 'charge-001' },
  ],
  receipt_document_snapshot: {
    company: { property_name: 'Original Hotel', footer_line1: 'Thank you' },
    receipt: { receipt_number: 'RC-2026-0042', subtotal: 1000, discount_amount: 50, vat: 152, total: 1102 },
    payment_allocations: [
      { payment_method: 'cash', amount: 500 },
      { payment_method: 'room', amount: 602, reservation_id: 'reservation-001', folio_charge_id: 'charge-001' },
    ],
  },
};

test('folio statement keeps POS receipts in a reference appendix, not duplicated in ledger totals', () => {
  const definition = buildFolioStatementDefinition({
    selected: { id: 'reservation-001', room_id: 'room-12' },
    charges: [{ id: 'charge-001', amount: 602, source: 'pos', description: 'POS split allocation', created_at: '2026-11-19T08:00:00.000Z' }],
    payments: [{ id: 'payment-001', amount: 300, method: 'cash', status: 'posted', created_at: '2026-11-19T09:00:00.000Z' }],
    receipts: [receipt],
    totals: { chargeTotal: 602, netPayments: 300, balance: 302 },
  });
  const ledger = definition.sections.find((section) => section.name === 'folio-ledger');
  const receiptDetails = definition.sections.find((section) => section.name === 'pos-receipt-details');
  assert.equal(ledger.rows.length, 2);
  assert.equal(receiptDetails.rows.length, 1);
  assert.equal(receiptDetails.rows[0].receipt_number, 'RC-2026-0042');
  assert.match(receiptDetails.rows[0].tender, /cash: KES 500/);
  assert.match(receiptDetails.rows[0].tender, /room: KES 602/);
  assert.match(definition.notes.join(' '), /not added again to the ledger totals/i);
});

test('final settlement invoice uses canonical receipt identity, line values and split allocations', () => {
  const definition = buildFinalSettlementInvoiceDefinition({
    selected: { id: 'reservation-001', guest_name: 'Guest', arrival: '2026-11-17', departure: '2026-11-19' },
    room: { number: '12' },
    receipts: [receipt],
    charges: [],
    payments: [],
    totals: { chargeTotal: 0, netPayments: 0, balance: 0 },
  });
  const receipts = definition.sections.find((section) => section.name === 'pos-receipts');
  const items = definition.sections.find((section) => section.name === 'pos-consumed-items');
  assert.equal(receipts.rows[0].receipt_number, 'RC-2026-0042');
  assert.equal(receipts.rows[0].total, 1102);
  assert.match(receipts.rows[0].payment_method, /cash: 500/);
  assert.equal(items.rows[0].item, 'Grilled fish');
  assert.equal(items.rows[0].line_total, 1000);
});

test('legacy receipt reports do not manufacture sequential receipt numbers', () => {
  const definition = buildFolioStatementDefinition({
    selected: { id: 'reservation-legacy' },
    receipts: [{ id: 'legacy-001', order_number: 'ORD-LEGACY', total: 100, items: [] }],
  });
  const receiptDetails = definition.sections.find((section) => section.name === 'pos-receipt-details');
  assert.equal(receiptDetails.rows[0].receipt_number, 'Legacy / unnumbered');
  assert.equal(receiptDetails.rows[0].snapshot, 'Legacy / not captured');
});
