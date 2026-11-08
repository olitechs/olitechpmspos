import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePostedSalesReceipts,
  buildFolioStatementDefinition,
  buildFinalSettlementInvoiceDefinition,
  buildMonthlySalesByCategoryDefinition,
  buildMonthlySalesByItemDefinition,
  buildMonthlySalesByShiftDefinition,
  buildRoomPlannerDefinition,
  buildSalesByPaymentTypeDefinition,
  buildSalesSummaryDefinition,
  buildShiftReportDefinition,
  buildStockControlDefinition,
} from './reportDefinitions.js';
import { buildReportExportAuditEvent, normalizeReportExportFilters } from './reportExportAuditCore.js';

const period = { from: '2026-10-01', to: '2026-10-31', propertyName: 'Harbor View Hotel', generatedBy: 'Synthetic Test User' };
const receipts = [
  {
    id: 'receipt-1', status: 'posted', total: 1500, pos_shift_id: 'shift-1',
    items: [
      { sku: 'BAR-001', name: 'Kahawa House Blend', category: 'Hot drinks', production_center: 'Bar', qty: 2, unit_price: 300 },
      { sku: 'KIT-001', name: 'Ugali', category: 'Food', production_center: 'Kitchen', qty: 2, unit_price: 150 },
    ],
  },
  {
    id: 'receipt-2', status: 'posted', total: 600, shift_id: 'shift-2',
    items: [{ sku: 'KIT-002', name: 'Viazi', category: 'Mains', production_center: 'Kitchen', qty: 3, amount: 600 }],
  },
  {
    id: 'receipt-3', status: 'voided', total: 9000, pos_shift_id: 'shift-1',
    items: [{ sku: 'BAR-002', name: 'Not posted', category: 'Drinks', production_center: 'Bar', qty: 99, amount: 9000 }],
  },
];
const shifts = [
  { id: 'shift-1', shift_no: 13, date: '2026-10-05' },
  { id: 'shift-2', shift_no: 14, date: '2026-10-08' },
];

test('posted receipt aggregation is status-scoped and emits source-backed Bar and Kitchen groups', () => {
  const result = aggregatePostedSalesReceipts(receipts, shifts);
  assert.equal(result.postedReceiptCount, 2);
  assert.equal(result.itemRows.length, 3);
  assert.equal(result.shiftRows.length, 2);
  assert.equal(result.itemRowsByDepartment.Bar.length, 1);
  assert.equal(result.itemRowsByDepartment.Kitchen.length, 2);
  assert.equal(result.departmentRows.find((row) => row.department === 'Bar').revenue, 600);
  assert.equal(result.departmentRows.find((row) => row.department === 'Kitchen').revenue, 900);
  assert.equal(result.shiftRowsByDepartment.Kitchen.length, 2);
});

test('monthly item/category/shift definitions retain a combined view and add Bar/Kitchen Excel-only sheets', () => {
  const item = buildMonthlySalesByItemDefinition({ receipts, shifts, ...period });
  assert.deepEqual(item.sections.map((section) => section.name), ['item-sales', 'bar-sales-by-item', 'kitchen-sales-by-item']);
  assert.equal(item.sections[0].rows.length, 3);
  assert.ok(item.sections.slice(1).every((section) => section.pdf === false && section.excel !== false));
  assert.ok(item.summary.some((row) => row.label === 'Bar item-line revenue' && row.value === 600));

  const category = buildMonthlySalesByCategoryDefinition({ receipts, shifts, ...period });
  assert.deepEqual(category.sections.map((section) => section.name), ['category-sales', 'bar-sales-by-category', 'kitchen-sales-by-category']);
  assert.equal(category.sections[0].rows.length, 3);

  const shift = buildMonthlySalesByShiftDefinition({ receipts, shifts, ...period });
  assert.deepEqual(shift.sections.map((section) => section.name), ['shift-sales', 'bar-shift-sales', 'kitchen-shift-sales']);
  assert.equal(shift.sections[0].rows.reduce((sum, row) => sum + row.gross_sales, 0), 2100);
  assert.equal(shift.sections[2].rows.reduce((sum, row) => sum + row.item_line_revenue, 0), 900);
  assert.ok(shift.notes.some((note) => note.includes('not allocated to departments')));
});

test('management sales summary adds combined Bar/Kitchen metrics and department-specific Excel sheets only when source rows exist', () => {
  const definition = buildSalesSummaryDefinition({
    report: { sales: { pos_gross: 2400, pos_net: 2100, pos_tax: 100, discounts: 100, refunds: 100, voids: 0 } },
    sales: { departments: [
      { department: 'Bar', qty: 4, revenue: 1200 },
      { department: 'Kitchen', qty: 6, revenue: 900 },
      { department: 'Other', qty: 1, revenue: 0 },
    ] },
    ...period,
  });
  assert.equal(definition.sections[1].rows.length, 3);
  assert.deepEqual(definition.sections.slice(2).map((section) => section.name), ['bar-sales', 'kitchen-sales']);
  assert.ok(definition.sections.slice(2).every((section) => section.pdf === false));
  assert.ok(definition.summary.some((row) => row.label === 'Bar revenue' && row.value === 1200));
});

test('payment type report does not invent department allocations absent payment-level department links', () => {
  const definition = buildSalesByPaymentTypeDefinition({
    payments: [{ method: 'Cash', transactions: 4, amount: 1200 }, { method: 'M-Pesa', transactions: 2, amount: 600 }],
    ...period,
  });
  assert.equal(definition.sections.length, 1);
  assert.deepEqual(definition.sections[0].rows.map((row) => row.method), ['Cash', 'M-Pesa']);
  assert.ok(definition.notes[0].includes('does not reconcile settlements'));
});

test('stock report preserves expiry and movement context, role-gates costs, and avoids invalid mixed-unit totals', () => {
  const input = {
    products: [{ id: 'p-1', sku: 'TEA-1', name: 'Black Tea', category: 'F&B', location: 'Main Store', unit: 'kg', current_stock: 4, min_stock: 5, expiry_date: '2026-12-01', cost_price: 200 }],
    movements: [{ created_at: '2026-10-17T09:30:00Z', type: 'out', qty: -2, reason: 'Kitchen issue', source_document: 'REQ-88', product: { name: 'Black Tea', category: 'F&B', location: 'Main Store', unit: 'kg' }, user_profile: { full_name: 'Test Storekeeper' } }],
    from: '2026-10-01', to: '2026-10-31', category: 'F&B', location: 'Main Store', ...period,
  };
  const restricted = buildStockControlDefinition({ ...input, showCost: false });
  const position = restricted.sections[0];
  const movement = restricted.sections[1];
  assert.equal(position.rows[0].expiry_date, '2026-12-01');
  assert.ok(!position.columns.some((column) => ['unit_cost', 'stock_value'].includes(column.key)));
  assert.equal(position.columns.find((column) => column.key === 'current_stock').total, undefined);
  assert.equal(movement.rows[0].unit, 'kg');
  assert.equal(movement.rows[0].location, 'Main Store');
  assert.equal(movement.rows[0].source_document, 'REQ-88');
  assert.equal(movement.columns.find((column) => column.key === 'quantity').total, undefined);
  const authorized = buildStockControlDefinition({ ...input, showCost: true });
  assert.equal(authorized.sections[0].rows[0].stock_value, 800);
  assert.ok(authorized.sections[0].columns.some((column) => column.key === 'stock_value' && column.total === 'sum'));
});

test('Folio statements keep the reservation filter and select only ledger fields', () => {
  const definition = buildFolioStatementDefinition({
    selected: { id: 'reservation-private-id', room_id: 'Room 6' },
    charges: [{ id: 'charge-1', created_at: '2026-10-04T10:15:00Z', description: 'Room charge', amount: 20000, created_by: 'user-1' }],
    payments: [{ id: 'payment-1', created_at: '2026-10-05T11:00:00Z', amount: -2000, method: 'Cash', created_by: 'user-1' }],
    employees: [{ user_id: 'user-1', full_name: 'Test Cashier' }],
    totals: { chargeTotal: 20000, netPayments: 18000, balance: 2000 },
    ...period,
  });
  assert.equal(definition.sections[0].rows.length, 2);
  assert.ok(!('guest_email' in definition.sections[0].rows[0]));
  assert.ok(definition.notes[0].includes('Do not distribute outside'));
  assert.equal(normalizeReportExportFilters(definition.filters).reservation, definition.filters.reservation);
});


test('final settlement invoice includes editable header, stay identity, full folio ledger and itemized POS receipt provenance without double counting', () => {
  const definition = buildFinalSettlementInvoiceDefinition({
    selected: { id: 'reservation-12345678', guest_name: 'Test Guest', phone: '+254700000000', arrival: '2026-11-01', departure: '2026-11-04', room_id: 'room-8' },
    room: { number: 8 },
    propertyName: 'Harbor View Hotel',
    generatedBy: 'Front Desk',
    charges: [
      { id: 'charge-room', created_at: '2026-11-01T08:00:00Z', category: 'accommodation', source: 'room', description: 'Room 8 · 3 nights', quantity: 3, amount: 15000, reference: 'ROOM-8', created_by: 'staff-1' },
      { id: 'charge-pos', created_at: '2026-11-02T13:00:00Z', category: 'restaurant', source: 'pos', description: 'POS order 701', quantity: 1, amount: 1250, reference: 'POS receipt receipt-701', created_by: 'staff-2' },
    ],
    payments: [{ id: 'payment-1', created_at: '2026-11-03T10:00:00Z', amount: 5000, method: 'mpesa', reference: 'QWERTY123', status: 'posted', created_by: 'staff-1' }, { id: 'payment-pending', created_at: '2026-11-03T11:00:00Z', amount: 999, method: 'cash', status: 'pending' }],
    receipts: [{
      id: 'receipt-701', order_number: '701', created_at: '2026-11-02T13:00:00Z', table_number: 'Room 8',
      payment_method: 'room', subtotal: 1100, discount_amount: 0, vat: 150, total: 1250,
      folio_charge_id: 'charge-pos',
      items: [{ name: 'Seafood platter', qty: 1, unit_price: 1000, total: 1000, modifiers: [{ name: 'Extra sauce' }] }, { name: 'Fresh juice', qty: 1, price: 100, line_total: 100 }],
    }],
    employees: [{ user_id: 'staff-1', full_name: 'Test Receptionist' }, { user_id: 'staff-2', full_name: 'Test Waiter' }],
    totals: { chargeTotal: 16250, netPayments: 5000, balance: 11250 },
    header: {
      invoiceTitle: 'Final Settlement Invoice', invoiceReference: 'INV-ROOM8-001',
      businessName: 'Harbor View Hotel', businessAddress: 'Watamu, Kenya', businessTaxPin: 'P051234567A',
      billTo: 'Test Guest', guestAddress: 'Nairobi, Kenya', guestEmail: 'guest@example.test', guestTaxPin: 'A001234567Z',
      headerNote: 'Corporate booking · PO 44', footerNote: 'Thank you.',
    },
  });
  const sections = Object.fromEntries(definition.sections.map((section) => [section.name, section]));
  assert.equal(definition.title, 'Final Settlement Invoice');
  assert.equal(definition.propertyName, 'Harbor View Hotel');
  assert.equal(definition.period.from, '2026-11-01');
  assert.equal(definition.period.to, '2026-11-04');
  assert.equal(sections['invoice-header'].rows.find((row) => row.field === 'Business tax PIN').value, 'P051234567A');
  assert.equal(sections['invoice-header'].rows.find((row) => row.field === 'Guest address').value, 'Nairobi, Kenya');
  assert.equal(sections['folio-ledger'].rows.length, 3);
  assert.equal(sections['pos-receipts'].rows[0].receipt_number, '701');
  assert.equal(sections['pos-receipts'].rows[0].receipt_id, 'receipt-701');
  assert.equal(sections['pos-receipts'].rows[0].room, '8');
  assert.equal(sections['pos-consumed-items'].rows.length, 2);
  assert.equal(sections['pos-consumed-items'].rows[0].modifiers, 'Extra sauce');
  assert.equal(sections['pos-consumed-items'].rows[0].line_total, 1000);
  assert.equal(definition.summary.find((row) => row.label === 'Total charges').value, 16250);
  assert.equal(definition.summary.find((row) => row.label === 'Final balance due').value, 11250);
  assert.ok(definition.notes.some((note) => note.includes('not added a second time')));
  assert.equal(sections['pos-consumed-items'].columns.find((column) => column.key === 'line_total').total, undefined);
});

test('final settlement invoice reconciles a reservation booking total when legacy folios have no room charge row', () => {
  const definition = buildFinalSettlementInvoiceDefinition({
    selected: { id: 'reservation-legacy', guest_name: 'Legacy Guest', arrival: '2026-11-01', departure: '2026-11-04', total_amount: 15000 },
    room: { number: 12 },
    charges: [{ id: 'pos-charge', created_at: '2026-11-02T10:00:00Z', category: 'restaurant', source: 'pos', description: 'Restaurant order', amount: 3000 }],
    payments: [{ id: 'paid-1', created_at: '2026-11-03T10:00:00Z', amount: 5000, method: 'cash', status: 'posted' }],
    receipts: [],
    totals: { chargeTotal: 15000, netPayments: 5000, balance: 10000 },
  });
  const sections = Object.fromEntries(definition.sections.map((section) => [section.name, section]));
  const accommodation = sections['folio-ledger'].rows.find((row) => row.type === 'Booking reconciliation');
  assert.equal(accommodation.amount, 12000);
  assert.equal(accommodation.quantity, 3);
  assert.equal(definition.summary.find((row) => row.label === 'Accommodation').value, 12000);
  assert.equal(definition.summary.find((row) => row.label === 'Total charges').value, 15000);
  assert.equal(definition.summary.find((row) => row.label === 'Final balance due').value, 10000);
});

test('Room Planner exports local calendar dates and active reservation fields only', () => {
  const definition = buildRoomPlannerDefinition({
    rooms: [{ id: 'room-6', number: '6', room_type: 'Standard' }],
    reservations: [
      { id: 'active', roomId: 'room-6', guestName: 'Synthetic Guest', checkIn: '2026-10-10', checkOut: '2026-10-12', status: 'booked', paymentStatus: 'paid', adults: 2, totalAmount: 10000, guest_email: 'private@example.test' },
      { id: 'cancelled', roomId: 'room-6', guestName: 'Cancelled Guest', checkIn: '2026-10-10', checkOut: '2026-10-11', status: 'Cancelled', adults: 1 },
    ],
    columns: ['2026-10-10', '2026-10-11'],
    ...period,
  });
  assert.equal(definition.period.from, '2026-10-10');
  assert.equal(definition.sections[0].rows.length, 1);
  assert.equal(definition.sections[0].rows[0].arrival, '2026-10-10');
  assert.equal(definition.sections[1].pdf, false);
  assert.equal(definition.sections[1].rows[0]['2026-10-10'], 'Synthetic Guest · booked');
  assert.ok(!JSON.stringify(definition).includes('private@example.test'));
});

test('shift report includes category, payment shares, guest covers and mapped refund receipt numbers', () => {
  const definition = buildShiftReportDefinition({
    shift: { shift_no: 12, date: '2026-10-12', status: 'closed', opening_cash: 200 },
    orders: [{ id: 'receipt-1', order_number: 'R-1001', table_number: '4', waiter: 'Test Waiter', created_at: '2026-10-12T11:00:00Z', items: [{ name: 'Tea', qty: 2 }], payment_method: 'split', total: 300, guest_name: 'Test Guest', covers: 2 }],
    voidedOrders: [{ order_number: 'V-1', table_number: '5', created_at: '2026-10-12T12:00:00Z', total: 50 }],
    payments: { Cash: { count: 1, amount: 300 } }, grossPayments: { Cash: { amount: 350 } }, refundsByMethod: { Cash: 50 },
    refunds: [{ receipt_id: 'receipt-1', settlement_method: 'Cash', amount: 50 }],
    categories: { food: { qty: 2, amount: 300 }, drinks: { qty: 0, amount: 0 } },
    totalSales: 300, grossSales: 350, refundsTotal: 50, voidedValue: 50, totalTransactions: 1, totalCovers: 2, itemsSold: 2,
    expectedCash: 300, countedCash: 305, variance: 5,
  }, period);
  const sections = Object.fromEntries(definition.sections.map((section) => [section.name, section]));
  assert.equal(sections['detailed-receipts'].rows[0].payment_method, 'Split Payment');
  assert.equal(sections['detailed-receipts'].rows[0].covers, 2);
  assert.equal(sections['refund-details'].rows[0].receipt, 'R-1001');
  assert.equal(sections['payment-breakdown'].rows[0].share_percent, 1);
  assert.ok(sections['items-sold'].rows.some((row) => row.category === 'Food' && row.quantity === 2));
  assert.ok(sections['shift-summary'].rows.some((row) => row.metric === 'Variance' && row.amount === 5));
});

test('export audit metadata keeps safe filters only and records format, delivery, and included row count', () => {
  const filters = normalizeReportExportFilters({ period: 'October', department: ['Bar', 'Kitchen'], reservation: 'R-55', guest_email: 'private@example.test', from: '2026-10-01', notes: 'do not keep' });
  assert.deepEqual(filters, { period: 'October', department: 'Bar, Kitchen', reservation: 'R-55', from: '2026-10-01' });
  const event = buildReportExportAuditEvent({ definition: { key: 'monthly-sales-by-item', rowCount: 999, filters }, format: 'pdf', rowCount: 12, delivery: 'print-preview' });
  assert.deepEqual(event, { report_key: 'monthly-sales-by-item', file_format: 'pdf', delivery: 'print-preview', row_count: 12, filters });
});
