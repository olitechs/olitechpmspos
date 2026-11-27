import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { buildSalesWorkbook } from './salesWorkbook.js';
import { buildAdjustmentFormWorkbook, buildStockWorkbook } from './stockWorkbook.js';
import { buildFrontOfficeWorkbook } from './frontOfficeWorkbook.js';
import { buildShiftWorkbook } from './shiftWorkbook.js';
import {
  adjustmentFormFilename,
  frontOfficeExportFilename,
  salesExportFilename,
  stockExportFilename,
} from './filenames.js';

// Upgrade pack Task 5 contract: the exported workbooks must keep the reference
// layout (sheet order, column headers, formula columns, blue inputs, frozen
// headers) so finance and store staff can keep working the same way.

const NUM = '#,##0.00;(#,##0.00);"-"';
const INPUT_FILL = 'FFFFF6CC';

const formulaOf = (cell) => cell?.value?.formula || (typeof cell?.value === 'string' && cell.value.startsWith('=') ? cell.value.slice(1) : '');

const build = (builder, data) => {
  const workbook = new ExcelJS.Workbook();
  builder(workbook, data);
  return workbook;
};

const salesData = () => ({
  propertyName: 'OliTechs Demo Hotel',
  currency: 'KES',
  generatedAt: new Date('2026-11-11T09:00:00Z'),
  from: '2026-11-01',
  to: '2026-11-11',
  receipts: [
    {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      created_at: '2026-11-01T07:15:00Z',
      order_number: 'ORD-1',
      table_number: '4',
      room_number: '',
      guest_name: 'Walk-in Guest',
      waiter: 'Wanjiku',
      items: [
        { name: 'Tea', category: 'Beverage', center: 'Kitchen', qty: 2, price: 100, product_id: 'p1' },
        { name: 'Mandazi', category: '', center: '', qty: 3, price: 50 },
      ],
      subtotal: 350,
      discount_amount: 0,
      vat: 56,
      total: 406,
      payment_method: 'cash',
      status: 'posted',
      folio_charge_id: null,
      created_by: 'user-1',
      shift_id: 'shift-1',
    },
    {
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      created_at: '2026-11-02T12:00:00Z',
      order_number: 'ORD-2',
      table_number: '7',
      room_number: '204',
      guest_name: 'Room Guest',
      waiter: 'Otieno',
      items: [{ name: 'Soda', category: 'Beverage', center: 'Bar', qty: 1, price: 150, product_id: 'p2' }],
      subtotal: 150,
      discount_amount: 0,
      vat: 24,
      total: 174,
      payment_method: 'room',
      status: 'voided',
      void_reason: 'Wrong table',
      folio_charge_id: 'folio-1',
      created_by: 'user-1',
      shift_id: 'shift-1',
    },
  ],
  shifts: [{ id: 'shift-1', shift_no: 3 }],
  profiles: [{ id: 'user-1', full_name: 'Cashier One' }],
  adjustments: [{ id: 'adj-1', created_at: '2026-11-02T13:00:00Z', shift_id: 'shift-1', adjustment_type: 'void', status: 'approved', amount: 174, reason: 'Wrong table' }],
  voidItems: [{ id: 'void-1', created_at: '2026-11-02T13:05:00Z', void_number: 'V-000001', order_number: 'ORD-2', table_number: '7', waiter: 'Otieno', item_name: 'Soda', category: 'drinks', removed_qty: 1, original_qty: 1, reason: 'Wrong item', removed_by_name: 'Cashier One', status: 'printed' }],
});

test('sales workbook keeps the reference sheet order and formula columns', () => {
  const workbook = build(buildSalesWorkbook, salesData());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Sales Summary', 'Sales by Item', 'By Category', 'Voids & Adjustments', 'Item Lines', 'Notes', 'Receipts',
  ]);

  const receipts = workbook.getWorksheet('Receipts');
  assert.equal(receipts.getCell(4, 1).value, 'Date & time');
  assert.equal(receipts.getCell(4, 18).value, 'Cashier');
  assert.equal(formulaOf(receipts.getCell('O5')), 'ROUND(K5-L5+M5-N5,2)');
  assert.equal(receipts.getCell('K5').numFmt, NUM);
  assert.equal(receipts.getCell('Q5').value, 'n/a');
  assert.equal(receipts.getCell('Q6').value, 'Yes');
  assert.equal(receipts.getCell('P5').value, 3);
  assert.equal(receipts.getCell('R5').value, 'Cashier One');
  assert.equal(receipts.views[0].ySplit, 4, 'header row stays frozen');
  assert.equal(receipts.autoFilter.from.row, 4);

  const summary = workbook.getWorksheet('Sales Summary');
  assert.equal(summary.getCell('A3').value, 'Date from');
  assert.match(formulaOf(summary.getCell('B7')), /COUNTIFS\(Receipts!\$J\$5:\$J\$2000,"posted"/);
  assert.match(formulaOf(summary.getCell('B11')), /SUMIFS\(Receipts!\$N\$5:\$N\$2000/);
  assert.equal(formulaOf(summary.getCell('B12')), 'IFERROR(B11/B7,0)');
  assert.equal(summary.getCell('B3').fill.fgColor.argb, INPUT_FILL, 'date range is a blue input');
  assert.equal(summary.getCell('B3').font.color.argb, 'FF0000FF');
  assert.equal(summary.getCell('B3').numFmt, 'dd-mmm-yyyy');

  const itemLines = workbook.getWorksheet('Item Lines');
  assert.equal(formulaOf(itemLines.getCell('I5')), 'G5*H5');
  assert.equal(itemLines.getCell('M6').value, 'Not recorded');

  const byItem = workbook.getWorksheet('Sales by Item');
  assert.match(formulaOf(byItem.getCell('E7')), /SUMIFS\('Item Lines'!\$G\$5:\$G\$2000/);
  assert.equal(formulaOf(byItem.getCell('A7')), 'RANK(F7,$F$7:$F$8)');
});

test('sales workbook never exports guest phone numbers or notes', () => {
  const data = salesData();
  data.receipts[0].phone = '0700 000 000';
  data.receipts[0].notes = 'Do not export this';
  const workbook = build(buildSalesWorkbook, data);
  const headers = [];
  workbook.worksheets.forEach((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === 'string' && cell.value.length < 40) headers.push(cell.value);
    }));
  });
  assert.ok(!headers.includes('Phone'));
  assert.ok(!headers.includes('Notes'));
  assert.ok(!headers.includes('0700 000 000'));
  assert.ok(headers.includes('Guest'));
  const notes = workbook.getWorksheet('Notes');
  assert.match(String(notes.getCell('A12').value || notes.getCell('A10').value || ''), /phone numbers/i);
});

test('stock workbook keeps status/variance formulas and the adjustment form contract', () => {
  const data = {
    propertyName: 'OliTechs Demo Hotel',
    currency: 'KES',
    generatedAt: new Date('2026-11-11T09:00:00Z'),
    products: [
      { id: 'prod-1111', sku: 'TEA-01', name: 'Tea Leaves', category: 'F&B', unit: 'kg', location: 'Main Store', current_stock: 12, min_stock: 5, max_stock: 40, cost_price: 300, selling_price: 500 },
      { id: 'prod-2222', sku: '', name: 'Cups', category: 'Supplies', unit: 'pcs', location: 'Main Store', current_stock: 0, min_stock: 10, max_stock: 100, cost_price: 0, selling_price: 0 },
    ],
    movements: [
      { id: 'mv-1', created_at: '2026-11-03T08:00:00Z', product_id: 'prod-1111', product: { id: 'prod-1111', name: 'Tea Leaves', sku: 'TEA-01' }, type: 'in', qty: 12, reason: 'Opening import', source_type: 'import', user_profile: { full_name: 'Storekeeper' } },
    ],
    stockLocations: [{ product_id: 'prod-1111', qty: 12, location_name: 'Main Store' }],
    adjustments: [{ id: 'adj-1', created_at: '2026-11-04T08:00:00Z', product_id: 'prod-1111', location_name: 'Main Store', change_qty: -1, reason: 'Damaged / broken', status: 'posted', created_by_name: 'Storekeeper' }],
  };
  const workbook = build(buildStockWorkbook, data);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Stock Summary', 'Stock Position', 'Stock Movements', 'Stock Card', 'Adjustment Form', 'Adjustments Recorded', 'Notes',
  ]);

  const position = workbook.getWorksheet('Stock Position');
  assert.equal(position.getCell(4, 1).value, 'ID');
  assert.match(formulaOf(position.getCell('O5')), /Out of stock/);
  assert.match(formulaOf(position.getCell('P5')), /No cost price/);
  assert.match(formulaOf(position.getCell('O6')), /"Out of stock"/);
  assert.equal(position.views[0].xSplit, 3, 'ID/SKU/Product stay visible');

  const card = workbook.getWorksheet('Stock Card');
  assert.equal(card.getCell('E6').fill.fgColor.argb, INPUT_FILL, 'opening qty is a blue input');
  assert.match(formulaOf(card.getCell('F6')), /SUMIFS\('Stock Movements'!\$F\$6:\$F\$2000/);
  assert.match(formulaOf(card.getCell('M6')), /No movement trail/);

  const form = workbook.getWorksheet('Adjustment Form');
  assert.equal(form.getCell('J9').dataValidation.type, 'list');
  assert.match(form.getCell('J9').dataValidation.formulae[0], /Damaged \/ broken/);
  assert.match(formulaOf(form.getCell('G9')), /\$F9-\$E9/);
  assert.equal(form.getCell('K9').value, 'EXAMPLE ROW - delete before use');

  const movements = workbook.getWorksheet('Stock Movements');
  assert.equal(formulaOf(movements.getCell('G6')), 'IF(E6="in",F6,-F6)');
  assert.equal(formulaOf(movements.getCell('B3')), 'SUMIFS(F6:F2000,E6:E2000,"in")');

  const summary = workbook.getWorksheet('Stock Summary');
  assert.equal(summary.getCell('A5').value, 'Products listed');
  assert.match(formulaOf(summary.getCell('B5')), /COUNTA\('Stock Position'!\$C\$5:\$C\$2000\)/);
});

test('restricted stock workbooks omit cost and valuation columns entirely', () => {
  const forbiddenHeaders = ['Cost price', 'Stock value @ cost', 'Stock value @ selling', 'Margin %', 'Unit cost', 'Value of variance', 'Value @ cost'];
  const data = {
    propertyName: 'OliTechs Demo Hotel',
    currency: 'KES',
    generatedAt: new Date('2026-11-11T09:00:00Z'),
    includeCosts: false,
    products: [
      { id: 'prod-1111', sku: 'TEA-01', name: 'Tea Leaves', category: 'F&B', unit: 'kg', location: 'Main Store', current_stock: 12, min_stock: 5, max_stock: 40, cost_price: 12345.99, selling_price: 500 },
    ],
    movements: [],
    stockLocations: [{ product_id: 'prod-1111', qty: 12, location_name: 'Main Store' }],
    adjustments: [],
  };

  for (const builder of [buildStockWorkbook, buildAdjustmentFormWorkbook]) {
    const workbook = build(builder, data);
    const headers = [];
    const cellText = [];
    workbook.worksheets.forEach((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === 'string') {
        headers.push(cell.value);
        cellText.push(cell.value);
        if (cell.value.formula) cellText.push(cell.value.formula);
      } else if (typeof cell.value === 'number') cellText.push(String(cell.value));
    })));
    for (const header of forbiddenHeaders) assert.ok(!headers.includes(header), `${header} must not appear for a restricted role`);
    assert.ok(!cellText.some((value) => value.includes('12345.99')), 'cost values must never be written');
    assert.ok(cellText.some((value) => /stores\.costs\.view/.test(value)), 'the omission must be explained in the workbook');

    const position = workbook.getWorksheet('Stock Position');
    assert.equal(position.getCell(4, 10).value, 'Selling price');
    assert.equal(position.getCell(4, 11).value, 'Status');
    assert.equal(position.getCell(4, 12).value, 'Data flags');
    assert.match(formulaOf(position.getCell('K5')), /Out of stock/);
    assert.match(formulaOf(position.getCell('L5')), /No selling price/);
    assert.doesNotMatch(formulaOf(position.getCell('L5')), /cost/i);

    const form = workbook.getWorksheet('Adjustment Form');
    assert.equal(form.getCell(8, 8).value, 'Reason');
    assert.equal(form.getCell(8, 9).value, 'Notes');
    assert.equal(form.getCell(8, 10).value, 'Adjusted by');
    assert.equal(form.getCell(8, 11).value, 'Approved by');
    assert.equal(form.getCell('H9').dataValidation.type, 'list');
    assert.match(formulaOf(form.getCell('G9')), /\$F9-\$E9/);
    assert.doesNotMatch(formulaOf(form.getCell('H9')), /\$G9\*\$H9/, 'no unit-cost formula without cost permission');
    assert.doesNotMatch(formulaOf(form.getCell('I9')), /\$G9\*\$H9/, 'no value-of-variance formula without cost permission');
  }
});

test('front office workbook keeps the register formulas and omits private guest data', () => {
  const data = {
    propertyName: 'OliTechs Demo Hotel',
    currency: 'KES',
    generatedAt: new Date('2026-11-11T09:00:00Z'),
    reportDate: '2026-11-11',
    reservations: [
      { id: 'res-1111', guest_name: 'Amina Guest', phone: '0700 111 222', notes: 'Late arrival', room_id: 'room-1', arrival: '2026-11-09', departure: '2026-11-12', adults: 2, children: 0, rate: 8000, total_amount: 16000, amount_paid: 8000, status: 'checked-in', payment_status: 'partial', source: 'direct', meal_plan: 'bed_only' },
    ],
    rooms: [{ id: 'room-1', number: 101, name: 'Garden View', room_type: 'Double', base_rate: 8000, status: 'occupied', active: true }],
    folioCharges: [{ id: 'charge-1', created_at: '2026-11-09T10:00:00Z', reservation_id: 'res-1111', source: 'room', description: 'Room 101', amount: 8000 }],
    payments: [{ id: 'pay-1', created_at: '2026-11-09T10:30:00Z', reservation_id: 'res-1111', amount: 8000, method: 'mpesa', status: 'posted' }],
  };
  const workbook = build(buildFrontOfficeWorkbook, data);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Dashboard', 'Reservations', 'Rooms', 'Folio Charges', 'Payments', 'Folio Summary', 'Occupancy Grid', 'Notes',
  ]);

  const reservations = workbook.getWorksheet('Reservations');
  assert.equal(reservations.getCell(6, 1).value, 'Booking ref');
  assert.equal(reservations.getCell(6, 20).value, 'Attention');
  assert.equal(formulaOf(reservations.getCell('G7')), 'F7-E7');
  assert.equal(formulaOf(reservations.getCell('K7')), 'G7*J7');
  assert.equal(formulaOf(reservations.getCell('O7')), 'L7-N7');
  assert.match(formulaOf(reservations.getCell('T7')), /Dashboard!\$B\$3/);

  const dashboard = workbook.getWorksheet('Dashboard');
  assert.equal(dashboard.getCell('B3').fill.fgColor.argb, INPUT_FILL);
  assert.equal(formulaOf(dashboard.getCell('B11')), 'IFERROR(B8/B10,0)');

  const folio = workbook.getWorksheet('Folio Summary');
  assert.match(formulaOf(folio.getCell('K6')), /Balance due/);
  assert.match(formulaOf(folio.getCell('D6')), /"room"/);

  const grid = workbook.getWorksheet('Occupancy Grid');
  assert.equal(grid.getCell('C5').value, '=$C$3');
  assert.equal(grid.getCell('D5').value, '=C5+1');
  assert.equal(formulaOf(grid.getCell('AG5')), 'AF5+1', '31 day columns reach column AG');

  const text = [];
  workbook.worksheets.forEach((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    if (typeof cell.value === 'string') text.push(cell.value);
  })));
  assert.ok(!text.includes('0700 111 222'), 'guest phone is never written');
  assert.ok(!text.includes('Late arrival'), 'reservation notes are never written');
  assert.ok(text.some((value) => /phone numbers/i.test(value)), 'notes explain the omission');
});

test('shift workbook turns section totals into formulas', () => {
  const data = {
    propertyName: 'OliTechs Demo Hotel',
    generatedAt: new Date('2026-11-11T09:00:00Z'),
    definition: {
      title: 'Shift report',
      sections: [{
        title: 'Payments',
        columns: [
          { key: 'method', label: 'Method', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'number', format: 'currency' },
        ],
        rows: [{ method: 'Cash', amount: 1200 }, { method: 'M-Pesa', amount: 800 }],
      }],
    },
  };
  const workbook = build(buildShiftWorkbook, data);
  const payments = workbook.getWorksheet('Payments');
  assert.equal(payments.getCell('A4').value, 'Method');
  assert.equal(formulaOf(payments.getCell('B7')), 'SUM(B5:B6)');
  assert.equal(payments.getCell('B5').numFmt, NUM);
});

test('export filenames carry the property and the reporting range', () => {
  assert.equal(
    salesExportFilename({ propertyName: 'OliTechs Demo Hotel', from: '2026-11-01', to: '2026-11-11' }),
    'OliTechs-Demo-Hotel_Sales_Reports_2026-11-01_to_2026-11-11.xlsx',
  );
  assert.equal(
    stockExportFilename({ propertyName: 'OliTechs Demo Hotel', from: '2026-11-01', to: '2026-11-11' }),
    'OliTechs-Demo-Hotel_Stock_Reports_2026-11-01_to_2026-11-11.xlsx',
  );
  assert.equal(
    adjustmentFormFilename({ propertyName: 'OliTechs Demo Hotel', date: '2026-11-11' }),
    'OliTechs-Demo-Hotel_Stock_Adjustment_Form_2026-11-11.xlsx',
  );
  assert.equal(
    frontOfficeExportFilename({ propertyName: 'OliTechs Demo Hotel', date: '2026-11-11' }),
    'OliTechs-Demo-Hotel_Front_Office_Reports_2026-11-11.xlsx',
  );
});
