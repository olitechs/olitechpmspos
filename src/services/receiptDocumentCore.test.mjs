import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptDocument } from './receiptDocumentCore.js';

test('receipt document uses the stored sequential number and does not invent one', () => {
  const numbered = buildReceiptDocument({ id: 'receipt-1', receipt_number: '13-3951', order_number: 'ORD-7' });
  assert.equal(numbered.receiptNumber, '13-3951');
  assert.equal(numbered.receiptNumberStatus, 'assigned');

  const legacy = buildReceiptDocument({ id: 'receipt-2', order_number: 'ORD-8' });
  assert.equal(legacy.receiptNumber, null);
  assert.equal(legacy.displayReference, 'ORD-8');
  assert.equal(legacy.receiptNumberStatus, 'missing');
});

test('receipt item groups use explicit report department precedence and preserve category', () => {
  const document = buildReceiptDocument({
    items: [
      { id: 'a', name: 'Grilled fish', department: 'Kitchen', production_center: 'Bar', category: 'Seafood', qty: 2, price: 500 },
      { id: 'b', name: 'Soda', production_center: 'Bar', category: 'Soft drinks', qty: 1, price: 150 },
      { id: 'c', name: 'Unknown', category: 'Other items', qty: 1, price: 75 },
    ],
  });

  assert.deepEqual(document.groups.map((group) => group.department), ['Kitchen', 'Bar', 'Other items']);
  assert.equal(document.items[0].category, 'Seafood');
  assert.equal(document.items[1].category, 'Soft drinks');
  assert.equal(document.items[2].department, 'Other items');
});

test('receipt totals remain the persisted values and tax/discount are not allocated to items', () => {
  const document = buildReceiptDocument({
    subtotal: 1000,
    discount_amount: 100,
    vat: 162,
    total: 1062,
    items: [{ name: 'Meal', qty: 2, price: 500 }],
  });

  assert.deepEqual(document.totals, {
    subtotal: 1000,
    discountAmount: 100,
    vat: 162,
    total: 1062,
    itemLineTotal: 1000,
  });
  assert.equal(document.receiptAdjustmentsAllocatedToItems, false);
});

test('split tender allocations retain each method and its reservation/folio links', () => {
  const document = buildReceiptDocument(
    { payment_method: 'split', total: 1500 },
    {
      paymentAllocations: [
        { payment_method: 'cash', amount: 500 },
        { payment_method: 'room', amount: 1000, reservation_id: 'reservation-1', folio_charge_id: 'charge-1' },
      ],
    },
  );

  assert.deepEqual(document.paymentAllocations.map((row) => [row.method, row.amount]), [['cash', 500], ['room', 1000]]);
  assert.equal(document.paymentAllocations[1].reservationId, 'reservation-1');
  assert.equal(document.paymentAllocations[1].folioChargeId, 'charge-1');
});

test('legacy receipts are not given a fabricated historical settings snapshot', () => {
  const document = buildReceiptDocument({ id: 'receipt-legacy' });
  assert.equal(document.receiptSnapshot, null);
  assert.equal(document.snapshotStatus, 'not-captured-or-legacy');
});

test('non-split receipt exposes its persisted tender without fabricating a split allocation', () => {
  const document = buildReceiptDocument({ payment_method: 'card', total: 875 });
  assert.deepEqual(document.paymentAllocations.map((row) => [row.method, row.amount]), [['card', 875]]);
});


test('receipt presentation uses immutable company and receipt snapshots when available', async () => {
  const { resolveReceiptDocumentPresentation } = await import('./receiptDocumentCore.js');
  const presentation = resolveReceiptDocumentPresentation({
    id: 'receipt-7',
    property_id: 'property-1',
    receipt_number: 'RC-0042',
    order_number: 'ORD-7',
    receipt_document_snapshot: {
      company: { property_name: 'Original Hotel', footer_line1: 'Original footer' },
      receipt: {
        receipt_number: 'RC-0042',
        order_number: 'ORD-7',
        subtotal: 1000,
        discount_amount: 50,
        vat: 152,
        total: 1102,
        items: [{ name: 'Meal', qty: 2, price: 500 }],
        payment_method: 'cash',
      },
      payment_allocations: [{ payment_method: 'cash', amount: 1102 }],
    },
  });
  assert.equal(presentation.settings.property_name, 'Original Hotel');
  assert.equal(presentation.settings.footer_line1, 'Original footer');
  assert.equal(presentation.data.receiptNumber, 'RC-0042');
  assert.equal(presentation.data.total, 1102);
  assert.equal(presentation.document.snapshotStatus, 'captured');
});

test('legacy receipt presentation does not invent a receipt number or company snapshot', async () => {
  const { resolveReceiptDocumentPresentation } = await import('./receiptDocumentCore.js');
  const presentation = resolveReceiptDocumentPresentation({
    id: 'legacy-id',
    order_number: 'ORD-LEGACY',
    total: 200,
  });
  assert.equal(presentation.data.receiptNumber, null);
  assert.equal(presentation.document.snapshotStatus, 'not-captured-or-legacy');
  assert.deepEqual(presentation.settings, {});
});
