import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePosPaymentMethod, summarizePosReceipts } from './posFinancials.js';

test('payment methods normalize room tender and unknown values safely', () => {
  assert.equal(normalizePosPaymentMethod('room'), 'room_charge');
  assert.equal(normalizePosPaymentMethod('ROOM_CHARGE'), 'room_charge');
  assert.equal(normalizePosPaymentMethod('Mpesa'), 'mpesa');
  assert.equal(normalizePosPaymentMethod('unrecognized'), 'other');
  assert.equal(normalizePosPaymentMethod(null), 'other');
});

test('shift summary reconciles posted tender totals and expected cash', () => {
  const summary = summarizePosReceipts([
    { id: 'cash-1', status: 'posted', payment_method: 'cash', total: '1250', items: [{ name: 'Tea', qty: 2, price: 250, category: 'Hot Drinks' }] },
    { id: 'room-1', status: 'posted', payment_method: 'room', total: 700, items: [{ name: 'Lunch', qty: 1, total: 700, center: 'Kitchen' }] },
    { id: 'mpesa-1', status: 'posted', payment_method: 'mpesa', total: 300, items: [{ name: 'Soda', quantity: 3, price: 100, center: 'Bar' }] },
    { id: 'void-1', status: 'voided', payment_method: 'cash', total: 9000, items: [{ name: 'Cancelled', qty: 1, price: 9000 }] },
  ], 500);

  assert.equal(summary.totalTransactions, 3);
  assert.equal(summary.totalSales, 2250);
  assert.equal(summary.payments.cash.amount, 1250);
  assert.equal(summary.payments.cash.count, 1);
  assert.equal(summary.payments.room_charge.amount, 700);
  assert.equal(summary.payments.mpesa.amount, 300);
  assert.equal(summary.expectedCash, 1750);
  assert.equal(summary.categories.drinks.qty, 5);
  assert.equal(summary.categories.drinks.amount, 800);
  assert.equal(summary.categories.food.qty, 1);
  assert.equal(summary.categories.food.amount, 700);
});

test('shift summary tolerates absent or malformed optional receipt data', () => {
  const summary = summarizePosReceipts([
    { payment_method: 'card', total: 'not-a-number', items: [{ qty: -2, price: 50 }] },
    { payment_method: 'bank', total: 100 },
    null,
  ], 'invalid');

  assert.equal(summary.totalTransactions, 2);
  assert.equal(summary.totalSales, 100);
  assert.equal(summary.expectedCash, 0);
  assert.equal(summary.categories.food.qty, 0);
});


test('split receipts reconcile against tender allocations without double-counting sales', () => {
  const summary = summarizePosReceipts([
    { id: 'split-1', status: 'posted', payment_method: 'split', total: 1000, items: [{ qty: 2, price: 500, category: 'Food' }] },
    { id: 'split-legacy', status: 'posted', payment_method: 'split', total: 200, items: [] },
  ], 100, [
    { receipt_id: 'split-1', payment_method: 'cash', amount: 400 },
    { receipt_id: 'split-1', payment_method: 'mpesa', amount: 600 },
  ]);

  assert.equal(summary.totalSales, 1200);
  assert.equal(summary.totalTransactions, 2);
  assert.equal(summary.payments.cash.amount, 400);
  assert.equal(summary.payments.mpesa.amount, 600);
  assert.equal(summary.payments.split_unallocated.amount, 200);
  assert.equal(summary.expectedCash, 500);
  assert.equal(Object.values(summary.payments).reduce((sum, payment) => sum + payment.amount, 0), 1200);
});


test('split tender reconciliation exposes missing and mismatched allocations', () => {
  const summary = summarizePosReceipts([
    { id: 'underpaid', status: 'posted', payment_method: 'split', total: 1000, items: [] },
    { id: 'unallocated', status: 'posted', payment_method: 'split', total: 250, items: [] },
  ], 0, [
    { receipt_id: 'underpaid', payment_method: 'cash', amount: 700 },
    { receipt_id: 'underpaid', payment_method: 'mpesa', amount: 200 },
  ]);

  assert.equal(summary.reconciliation.splitReceiptCount, 2);
  assert.equal(summary.reconciliation.splitUnallocatedCount, 1);
  assert.equal(summary.reconciliation.splitAllocationVarianceCount, 1);
  assert.equal(summary.reconciliation.splitAllocationVariance, 100);
  assert.equal(summary.payments.split_unallocated.amount, 250);
});

test('unexpected split allocation method cannot crash shift reporting', () => {
  const summary = summarizePosReceipts([
    { id: 'split-1', status: 'posted', payment_method: 'split', total: 100, items: [] },
  ], 0, [
    { receipt_id: 'split-1', payment_method: 'split', amount: 100 },
  ]);

  assert.equal(summary.payments.other.amount, 100);
  assert.equal(summary.totalSales, 100);
});
