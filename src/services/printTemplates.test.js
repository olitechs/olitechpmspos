import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderTicketText,
  buildUnsettledReceiptText,
  buildFinalReceiptText,
  getPrinterColumns,
  thermalTextToHtml,
  toEscPosPayload,
  wrapThermalText,
} from './printTemplates.js';

const stripEscPos = value => value
  .replaceAll(String.fromCharCode(27) + 'E' + String.fromCharCode(1), '')
  .replaceAll(String.fromCharCode(27) + 'E' + String.fromCharCode(0), '');

test('paper width selects 48 columns for 80mm and 32 for 58mm', () => {
  assert.equal(getPrinterColumns({ paper_width: '80mm' }), 48);
  assert.equal(getPrinterColumns({ paper_width: '58mm' }), 32);
});

test('character override takes precedence and rejects out-of-range values', () => {
  assert.equal(getPrinterColumns({ paper_width: '58mm', character_width: 42 }), 42);
  assert.equal(getPrinterColumns({ paper_width: '80mm', character_width: 65 }), 48);
});

test('word wrapping never exceeds the configured paper width', () => {
  const rows = wrapThermalText('A very long kitchen preparation instruction for a special order', 32);
  assert.ok(rows.every(row => row.length <= 32));
});

test('order ticket includes station metadata, modifiers and prep notes without prices', () => {
  const output = stripEscPos(buildOrderTicketText({
    propertyName: 'Coastal Hotel',
    orderNumber: 'ORD-001',
    table: 'T-04',
    waiter: 'Amina',
    diningOption: 'Take Away',
    covers: 2,
    createdAt: '2026-11-04T12:00:00.000Z',
    items: [{
      qty: 2,
      name: 'Grilled Fish',
      price: 1500,
      modifiers: [{ name: 'Extra Lemon' }],
      prepNote: 'No chilli please',
    }],
  }, { center: 'KITCHEN', printer: { paper_width: '80mm' }, settings: { property_name: 'Coastal Hotel', address_line1: 'Watamu', footer_line1: 'Thank you for visiting' } }));
  assert.match(output, /KITCHEN ORDER TICKET/);
  assert.match(output, /COASTAL HOTEL/);
  assert.match(output, /Thank you for visiting/);
  assert.ok(output.includes(String.fromCharCode(29) + '!' + String.fromCharCode(17)), 'order item names use double-size ESC/POS mode');
  assert.match(output, /ORD-001/);
  assert.match(output, /T-04/);
  assert.match(output, /AMINA/);
  assert.match(output, /TAKE AWAY/);
  assert.match(output, /2 x Grilled Fish/);
  assert.match(output, /Extra Lemon/);
  assert.match(output, /No chilli please/);
  assert.doesNotMatch(output, /1500/);
});

test('unsettled bill is prominently unpaid, aligned and has totals without a payment row', () => {
  const output = stripEscPos(buildUnsettledReceiptText({
    property_name: 'Coastal Hotel',
    address_line1: 'Watamu',
    phone: '+254700000000',
    footer_line1: 'Thank you',
  }, {
    orderNumber: 'ORD-002',
    table: 'T-02',
    waiter: 'Baraka',
    diningOption: 'Dine In',
    covers: 3,
    currency: 'KES',
    items: [{ qty: 2, name: 'Fresh Juice', price: 250 }],
    subtotal: 500,
    discount: 50,
    vat: 72,
    serviceCharge: 25,
    total: 547,
  }, { printer: { paper_width: '58mm' }, copyLabel: 'TEST COPY' }));
  assert.match(output, /BILL - NOT PAID/);
  assert.match(output, /PAYMENT PENDING/);
  assert.match(output, /ORD-002/);
  assert.match(output, /FRESH JUICE/i);
  assert.match(output, /SUBTOTAL/);
  assert.match(output, /DISCOUNT/);
  assert.match(output, /VAT/);
  assert.match(output, /SERVICE CHARGE/);
  assert.match(output, /TOTAL DUE/);
  assert.match(output, /NOT A TAX INVOICE/);
  assert.doesNotMatch(output, /Payment Method/);
  assert.doesNotMatch(output, /FINAL RECEIPT/);
  assert.ok(output.split('\n').every(line => line.length <= 32));
});


test('final receipt uses centered company header/footer and a paid receipt layout', () => {
  const output = stripEscPos(buildFinalReceiptText({
    property_name: 'Coastal Hotel',
    address_line1: 'Watamu',
    footer_line1: 'Thank you for dining with us',
    footer_line2: 'Visit again',
  }, {
    checkNo: 'CHK-007',
    currency: 'KES',
    items: [{ qty: 1, name: 'Fish Curry', price: 1200 }],
    subtotal: 1200,
    total: 1200,
    paymentMethod: 'M-Pesa',
  }, { printer: { paper_width: '58mm' } }));
  assert.match(output, /FINAL RECEIPT/);
  assert.match(output, /PAYMENT METHOD: M-Pesa/);
  assert.match(output, /Thank you for dining with us/);
  assert.match(output, /Visit again/);
  assert.doesNotMatch(output, /PAYMENT PENDING/);
  assert.ok(output.split('\\n').every(line => line.length <= 32));
});

test('HTML fallback renders fixed-width plain text on white paper', () => {
  const html = thermalTextToHtml('BILL - NOT PAID\nKES 100.00');
  assert.match(html, /<pre/);
  assert.match(html, /background:white;color:black/);
  assert.match(html, /BILL - NOT PAID/);
});

test('cloud print payload includes ESC/POS initialization and partial cut', () => {
  const payload = toEscPosPayload('ORDER TICKET');
  assert.equal(payload.charCodeAt(0), 27);
  assert.equal(payload.charCodeAt(1), 64);
  assert.ok(payload.endsWith(String.fromCharCode(29, 86, 1)));
});
