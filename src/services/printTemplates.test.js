import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderTicketText,
  getUnsentOrderLines,
  buildUnsettledReceiptText,
  buildFinalReceiptText,
  getPrinterColumns,
  getOrderTicketColumns,
  thermalTextToHtml,
  toEscPosPayload,
  estimateThermalFeedLines,
  wrapThermalText,
} from './printTemplates.js';

const stripEscPos = value => value
  .replaceAll(String.fromCharCode(27) + 'E' + String.fromCharCode(1), '')
  .replaceAll(String.fromCharCode(27) + 'E' + String.fromCharCode(0), '')
  .replace(/\x1D\x21[\s\S]/g, '');

test('settled receipt columns stay inside safe 80mm and 58mm print margins', () => {
  assert.equal(getPrinterColumns({ paper_width: '80mm' }), 46);
  assert.equal(getPrinterColumns({ paper_width: '58mm' }), 30);
  assert.equal(getPrinterColumns({ paper_width: '58mm', character_width: 48 }), 30);
  assert.equal(getPrinterColumns({ paper_width: '80mm', character_width: 64 }), 46);
});

test('order ticket columns use conservative safe 42 and 30 character widths', () => {
  assert.equal(getOrderTicketColumns({ paper_width: '80mm' }), 42);
  assert.equal(getOrderTicketColumns({ paper_width: '58mm' }), 30);
  assert.equal(getOrderTicketColumns({ paper_width: '58mm', character_width: 42 }), 30);
  assert.equal(getOrderTicketColumns({ paper_width: '80mm', character_width: 65 }), 42);
});

test('additional KOT sends contain only quantities not previously fired', () => {
  const existing = [{ id: 'fish-extra-lemon', name: 'Grilled Fish', qty: 2, modifiers: [{ name: 'Extra lemon' }] }];
  const current = [{ id: 'fish-extra-lemon', name: 'Grilled Fish', qty: 3, modifiers: [{ name: 'Extra lemon' }] }];
  const delta = getUnsentOrderLines(current, existing);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].qty, 1);
  assert.equal(getUnsentOrderLines(existing, existing).length, 0);
});

test('KOT snapshot after a void allows a later re-added quantity to print once', () => {
  const afterVoid = [{ id: 'soda', name: 'Soda', qty: 1 }];
  const afterAddition = [{ id: 'soda', name: 'Soda', qty: 2 }];
  const delta = getUnsentOrderLines(afterAddition, afterVoid);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].qty, 1);
});

test('KOT delta consumes prior sent quantities once across duplicate current rows', () => {
  const sent = [{ id: 'tea', name: 'Tea', qty: 2 }];
  const current = [
    { id: 'tea', name: 'Tea', qty: 2 },
    { id: 'tea', name: 'Tea', qty: 2 },
  ];
  const delta = getUnsentOrderLines(current, sent);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].qty, 2);
});

test('word wrapping never exceeds the configured paper width', () => {
  const rows = wrapThermalText('A very long kitchen preparation instruction for a special order', 32);
  assert.ok(rows.every(row => row.length <= 32));
});

test('order ticket includes station metadata, modifiers and prep notes without prices', () => {
  const output = stripEscPos(buildOrderTicketText({
    propertyName: 'Coastal Hotel',
    orderNumber: 'ORD-001',
    orderName: 'Fabio GM',
    employeeName: 'Owner',
    posName: 'POS 3',
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
  assert.match(output, /KITCHEN POS/);
  assert.match(output, /#ORD-001/);
  assert.match(output, /Thank you for visiting/);
  assert.ok(!output.includes(String.fromCharCode(29) + '!' + String.fromCharCode(17)), 'order items stay at normal thermal font size');
  assert.ok(output.split('\n').every(line => line.length <= 42), 'all order ticket lines fit safe 80mm paper width');
  assert.ok(/\*\*\* KITCHEN POS \*\*\*/.test(output), 'order ticket station header is centered');
  assert.ok(output.includes('          Thank you for visiting'), 'order ticket footer is centered');
  assert.match(output, /Fabio GM/);
  assert.match(output, /Employee: Owner/);
  assert.match(output, /POS: POS 3/);
  assert.match(output, /TAKE AWAY/);
  assert.match(output, /2 x Grilled Fish/);
  assert.match(output, /Extra Lemon/);
  assert.match(output, /No chilli please/);
  assert.doesNotMatch(output, /1500/);
});

test('unsettled bill uses the clean pending layout and summed item amounts with VAT off', () => {
  const settings = { property_name: 'Coastal Hotel', address_line1: 'Watamu', phone: '+254700000000', email: 'hello@example.com', website: 'coastal.example', kra_pin: 'P051234567A' };
  const data = {
    checkNo: 'ORD-002-USOR1U2',
    table: 'T4',
    waiter: 'Grace Wanjiru',
    diningOption: 'Dine In',
    covers: 5,
    currency: 'KES',
    items: [
      { qty: 1, name: 'Grilled Ocean Fish with Coconut Sauce and Swahili Spices', price: 1250, modifiers: [{ name: 'Extra lemon butter' }] },
      { qty: 2, name: 'Soda', price: 300 },
    ],
  };
  const output = stripEscPos(buildUnsettledReceiptText(settings, data, {
    printer: { paper_width: '58mm' },
    now: new Date('2026-11-05T12:46:00.000Z'),
  }));
  assert.match(output, /UNSETTLED BILL/);
  assert.match(output, /PAYMENT PENDING/);
  assert.equal((output.match(/PAYMENT PENDING/g) || []).length, 1);
  assert.equal((output.replace(/\s+/g, ' ').match(/Not a tax invoice \/ Not a paid receipt/g) || []).length, 1);
  assert.match(output, /Order: ORD-002-USOR1U2/);
  assert.match(output, /Employee: Grace Wanjiru/);
  assert.match(output, /POS: POS/);
  assert.match(output, /DINE IN/);
  assert.match(output, /2 x Soda/);
  assert.match(output, /KES 600\.00/);
  assert.match(output, /KES 1,250\.00/);
  assert.match(output, /AMOUNT DUE/);
  assert.match(output, /KES 1,850\.00/);
  assert.match(output, /Check: ORD-002-USOR1U2/);
  assert.match(output, /5 Nov 2026, 15:46/);
  assert.doesNotMatch(output, /RECEIPT NO|ORDER NO|SUBTOTAL|VAT|Thank you|Please keep your receipt/i);
  assert.equal((output.match(/Check:/g) || []).length, 1);
  assert.ok(output.split('\n').every(line => line.length <= 30), '58mm safe lines stay within 30 columns');
});

test('unsettled VAT exclusive adds VAT on top and reconciles the due amount', () => {
  const settings = { unsettled_receipt_show_vat: true, unsettled_receipt_vat_rate: 16, unsettled_receipt_vat_mode: 'exclusive' };
  const data = { currency: 'KES', checkNo: 'ORD-002', items: [{ qty: 1, name: 'Meal', price: 1250 }, { qty: 2, name: 'Soda', price: 300 }] };
  const output = stripEscPos(buildUnsettledReceiptText(settings, data, { printer: { paper_width: '80mm' } }));
  assert.match(output, /Subtotal\s+KES 1,850\.00/);
  assert.match(output, /VAT \(16%\)\s+KES 296\.00/);
  assert.match(output, /KES 2,146\.00/);
  assert.ok(output.split('\n').every(line => line.length <= 46), '80mm safe lines stay within 46 columns');
});

test('unsettled VAT inclusive extracts VAT but keeps the printed line total as amount due', () => {
  const settings = { unsettled_receipt_show_vat: true, unsettled_receipt_vat_rate: 16, unsettled_receipt_vat_mode: 'inclusive' };
  const data = { currency: 'KES', checkNo: 'ORD-003', items: [{ qty: 1, name: 'Meal', price: 1250 }, { qty: 2, name: 'Soda', price: 300 }] };
  const output = stripEscPos(buildUnsettledReceiptText(settings, data, { printer: { paper_width: '58mm' } }));
  assert.match(output, /Subtotal/);
  assert.match(output, /VAT included \(16%\)/);
  assert.match(output, /KES 255\.17/);
  assert.match(output, /KES 1,850\.00/);
  assert.ok(output.split('\n').every(line => line.length <= 30));
});

test('an order VAT snapshot takes precedence over current property VAT settings', () => {
  const settings = { unsettled_receipt_show_vat: false, unsettled_receipt_vat_rate: 16, unsettled_receipt_vat_mode: 'exclusive' };
  const data = { checkNo: 'ORD-SNAP', vatSnapshot: { enabled: true, rate: 8, mode: 'exclusive' }, items: [{ qty: 1, name: 'Meal', price: 1000 }] };
  const output = stripEscPos(buildUnsettledReceiptText(settings, data));
  assert.match(output, /VAT \(8%\)/);
  assert.match(output, /KES 1,080\.00/);
});

test('unsettled bill reconciles a saved discounted VAT snapshot to the POS amount due', () => {
  const settings = { unsettled_receipt_show_vat: false, unsettled_receipt_vat_rate: 16, unsettled_receipt_vat_mode: 'exclusive' };
  const data = {
    checkNo: 'ORD-DISCOUNT',
    discount: 100,
    vatSnapshot: { enabled: true, rate: 16, mode: 'exclusive', subtotal: 1000, discount: 100, taxableSubtotal: 900, vat: 144, total: 1044 },
    items: [{ qty: 1, name: 'Meal', price: 1000 }],
  };
  const output = stripEscPos(buildUnsettledReceiptText(settings, data, { printer: { paper_width: '80mm' } }));
  assert.match(output, /Subtotal\s+KES 1,000\.00/);
  assert.match(output, /Discount\s+-KES 100\.00/);
  assert.match(output, /VAT \(16%\)\s+KES 144\.00/);
  assert.match(output, /KES 1,044\.00/);
});

test('12-item unsettled bill preserves every item and stays within 58mm width', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    qty: index === 1 ? 2 : 1,
    name: index === 0 ? 'Grilled Ocean Fish with Coconut Sauce and Swahili Spices' : 'Sample menu item ' + (index + 1),
    price: index === 1 ? 300 : 250,
    modifiers: index === 0 ? [{ name: 'Extra lemon butter' }] : [],
  }));
  const output = stripEscPos(buildUnsettledReceiptText({}, { checkNo: 'ORD-LONG', items }, { printer: { paper_width: '58mm' } }));
  for (let index = 1; index <= 12; index++) {
    if (index === 1) assert.match(output, /Grilled Ocean Fish/);
    else if (index === 2) assert.match(output, /2 x Sample menu item 2/);
    else assert.match(output, new RegExp('Sample menu item ' + index));
  }
  assert.match(output, /Extra lemon butter/);
  assert.ok(output.split('\n').every(line => line.length <= 30));
});




test('final receipt uses centered company header/footer and a paid receipt layout', () => {
  const output = stripEscPos(buildFinalReceiptText({
    property_name: 'Coastal Hotel',
    address_line1: 'Watamu',
    footer_line1: 'Thank you for dining with us',
    footer_line2: 'Visit again',
  }, {
    checkNo: 'CHK-007',
    orderNumber: 'ORD-007',
    receiptNumber: 'RCT-2026-007',
    currency: 'KES',
    items: [{ qty: 1, name: 'Fish Curry', price: 1200 }],
    subtotal: 1200,
    total: 1200,
    paymentMethod: 'M-Pesa',
  }, { printer: { paper_width: '58mm' } }));
  assert.match(output, /RECEIPT/);
  assert.match(output, /Receipt No: RCT-2026-007/);
  assert.match(output, /Order: ORD-007/);
  assert.match(output, /Payment: M-Pesa/);
  assert.match(output, /Thank you for dining with us/);
  assert.match(output, /Visit again/);
  assert.doesNotMatch(output, /PAYMENT PENDING/);
  assert.doesNotMatch(output, /VAT/);
  assert.ok(output.split('\n').every(line => line.length <= 30));
});


test('long order-ticket names, modifiers and kitchen notes are preserved within 58mm width', () => {
  const longName = 'Supercalifragilisticexpialidocious Seafood Preparation Platter';
  const longModifier = 'Extra crispy with lemon butter sauce served separately';
  const longNote = 'Please prepare without chilli and keep the sauce in a separate container';
  const output = stripEscPos(buildOrderTicketText({
    orderNumber: 'ORD-058',
    items: [{ qty: 2, name: longName, modifiers: [longModifier], prepNote: longNote }],
  }, { printer: { paper_width: '58mm' }, center: 'KITCHEN' }));
  const plain = output.replace(/\s/g, '');
  for (const value of [longName, longModifier, longNote]) {
    assert.ok(plain.includes(value.replace(/\s/g, '')), 'all supplied ticket text is preserved');
  }
  assert.ok(output.split('\n').every(line => line.length <= 30), 'every physical line fits safe 58mm paper width');
  assert.match(output, /#ORD-058/);
});

test('HTML fallback renders fixed-width plain text on white paper', () => {
  const html = thermalTextToHtml('BILL - NOT PAID\nKES 100.00');
  assert.match(html, /<pre/);
  assert.match(html, /background:white;color:black/);
  assert.match(html, /BILL - NOT PAID/);
});

test('thermal payload leaves two blank lines after the footer before cutting', () => {
  const shortBill = toEscPosPayload('ORDER TICKET');
  assert.equal(shortBill.charCodeAt(0), 27);
  assert.equal(shortBill.charCodeAt(1), 64);
  const twoFeedAndCut = String.fromCharCode(27,100,2,27,74,100,29,86,66,0);
  assert.ok(shortBill.endsWith(twoFeedAndCut));
  assert.ok(shortBill.includes('ORDER TICKET' + twoFeedAndCut), 'two blank lines remain after the final printed line before the cutter feed');

  const receipt = toEscPosPayload('UNSETTLED BILL', { feedLinesBeforeCut:2, feedDotsBeforeCut:100, cutCommand:'gs_v_0' });
  assert.ok(receipt.endsWith(String.fromCharCode(27,100,2,27,74,100,29,86,0)), 'configured full cut follows line and dot feeds');
  assert.ok(receipt.includes('UNSETTLED BILL' + String.fromCharCode(27,100,2,27,74,100,29,86,0)), 'receipt footer has two blank lines before the feed and cut');

  const orderTicket = toEscPosPayload('ORDER TICKET', { feedLines: 2 });
  assert.ok(orderTicket.endsWith(twoFeedAndCut), 'order tickets use the shared feed and cutter sequence');
  assert.equal(estimateThermalFeedLines(Array.from({ length: 240 }, (_, i) => 'LONG BILL ITEM ' + (i + 1)).join('\n')), 2);
});

test('long item names and amount fields are wrapped, never sliced off', () => {
  const longName = 'Supercalifragilisticexpialidocious Seafood Platter';
  const output = stripEscPos(buildUnsettledReceiptText({}, {
    currency: 'KES',
    items: [{ qty: 1, name: longName, price: 987654321 }],
    subtotal: 987654321,
    total: 987654321,
  }, { printer: { paper_width: '58mm' } }));
  assert.ok(output.replace(/\s/g, '').includes(longName.replace(/\s/g, '')));
  assert.ok(output.includes('987,654,321.00'));
  assert.ok(output.split('\n').every(line => line.length <= 30));
});

