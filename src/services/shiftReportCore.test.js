import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftSalesSummary } from './shiftReportCore.js';

test('aggregates direct and split payments by their actual tender methods', () => {
  const receipts = [
    { id: 'r1', payment_method: 'cash', total: 100, covers: 2, items: [{ name: 'Tea', qty: 2, price: 50, category: 'drinks' }] },
    { id: 'r2', payment_method: 'split', total: 300, covers: 3, items: [{ name: 'Lunch', qty: 3, price: 100, category: 'food' }] },
  ];
  const allocations = [
    { receipt_id: 'r2', payment_method: 'cash', amount: 100 },
    { receipt_id: 'r2', payment_method: 'mpesa', amount: 200 },
  ];

  const report = buildShiftSalesSummary(receipts, allocations);
  assert.equal(report.totalSales, 400);
  assert.equal(report.totalTransactions, 2);
  assert.equal(report.totalCovers, 5);
  assert.equal(report.itemsSold, 5);
  assert.deepEqual(report.payments.cash, { amount: 200, count: 2 });
  assert.deepEqual(report.payments.mpesa, { amount: 200, count: 1 });
  assert.equal(report.grossPayments.cash.amount, 200);
  assert.equal(report.refundsByMethod.cash, 0);
  assert.equal(report.payments.card.amount, 0);
  assert.equal(report.categories.drinks.qty, 2);
  assert.equal(report.categories.food.amount, 300);
});

test('subtracts refunds by settlement method and reports voided receipt value separately', () => {
  const report = buildShiftSalesSummary(
    [
      { id: 'r1', payment_method: 'cash', total: 100, covers: 2, items: [] },
      { id: 'r2', payment_method: 'split', total: 200, covers: 3, items: [] },
    ],
    [
      { receipt_id: 'r2', payment_method: 'cash', amount: 50 },
      { receipt_id: 'r2', payment_method: 'mpesa', amount: 150 },
    ],
    [
      { receipt_id: 'r1', settlement_method: 'cash', amount: 20 },
      { receipt_id: 'r2', settlement_method: 'mpesa', amount: 10 },
    ],
    [{ id: 'v1', total: 50 }],
  );
  assert.equal(report.grossSales, 300);
  assert.equal(report.refundsTotal, 30);
  assert.equal(report.voidedValue, 50);
  assert.equal(report.totalSales, 270);
  assert.equal(report.payments.cash.amount, 130);
  assert.equal(report.payments.mpesa.amount, 140);
  assert.equal(report.grossPayments.cash.amount, 150);
  assert.equal(report.refundsByMethod.cash, 20);
  assert.equal(report.refundsByMethod.mpesa, 10);
  assert.equal(report.totalCovers, 5);
});

test('normalizes room charge and unknown tenders without losing receipt totals', () => {
  const report = buildShiftSalesSummary([
    { id: 'r1', payment_method: 'room', total: 250, items: [] },
    { id: 'r2', payment_method: 'voucher', total: 50, items: [] },
  ]);
  assert.equal(report.payments.room_charge.amount, 250);
  assert.equal(report.payments.other.amount, 50);
  assert.equal(report.totalSales, 300);
  assert.equal(report.totalCovers, 2);
});

test('split tender diagnostics identify missing and mismatched receipt allocations without confirming unallocated money', () => {
  const receipts = [
    { id: 'split-ok', order_number: 'R-100', payment_method: 'split', total: 100, items: [] },
    { id: 'split-missing', order_number: 'R-101', payment_method: 'split', total: 75, items: [] },
    { id: 'split-short', order_number: 'R-102', payment_method: 'split', total: 200, items: [] },
    { id: 'cash', order_number: 'R-103', payment_method: 'cash', total: 50, items: [] },
  ];
  const allocations = [
    { receipt_id: 'split-ok', payment_method: 'cash', amount: 40 },
    { receipt_id: 'split-ok', payment_method: 'mpesa', amount: 60 },
    { receipt_id: 'split-short', payment_method: 'cash', amount: 120 },
  ];
  const report = buildShiftSalesSummary(receipts, allocations);
  assert.deepEqual(report.splitReconciliation, {
    splitReceiptCount: 3,
    reconciledCount: 1,
    exceptionCount: 2,
    missingAllocationCount: 1,
    mismatchedAllocationCount: 1,
    receiptTotal: 375,
    allocatedTotal: 220,
    unallocatedOrVariance: 155,
    exceptions: [
      { receipt_id: 'split-missing', receipt_number: 'R-101', expected_total: 75, allocated_total: 0, difference: 75, status: 'missing', allocations: [] },
      { receipt_id: 'split-short', receipt_number: 'R-102', expected_total: 200, allocated_total: 120, difference: 80, status: 'mismatched', allocations: [{ payment_method: 'cash', amount: 120 }] },
    ],
  });
  assert.equal(report.grossSales, 425);
  assert.equal(report.payments.cash.amount, 210);
  assert.equal(report.payments.mpesa.amount, 60);
  assert.equal(report.payments.cash.amount + report.payments.mpesa.amount, 270);
  assert.notEqual(report.payments.cash.amount + report.payments.mpesa.amount, report.grossSales);
});

test('split tender diagnostics flag over-allocation and retain confirmed tender amounts', () => {
  const report = buildShiftSalesSummary(
    [{ id: 'split-over', order_number: 'R-200', payment_method: 'split', total: 100, items: [] }],
    [{ receipt_id: 'split-over', payment_method: 'card', amount: 110 }],
  );
  assert.equal(report.splitReconciliation.exceptions[0].status, 'mismatched');
  assert.equal(report.splitReconciliation.exceptions[0].difference, -10);
  assert.equal(report.payments.card.amount, 110);
  assert.equal(report.grossSales, 100);
});
