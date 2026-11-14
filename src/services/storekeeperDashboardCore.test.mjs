import test from 'node:test';
import assert from 'node:assert/strict';
import {
  departmentComparison,
  filterProducts,
  getPeriodRange,
  getPreviousRange,
  makeSalesConsumptionSeries,
  normalizeDepartment,
  productDepartment,
  summarizeCount,
  summarizeSalesItems,
  summarizeStock,
  summarizeWastage,
} from './storekeeperDashboardCore.js';

test('business periods use Monday weeks and completed elapsed periods through today', () => {
  assert.deepEqual(getPeriodRange('today', '2026-11-07'), { from: '2026-11-07', to: '2026-11-07' });
  assert.deepEqual(getPeriodRange('week', '2026-11-07'), { from: '2026-11-02', to: '2026-11-07' });
  assert.deepEqual(getPeriodRange('month', '2026-11-07'), { from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(getPeriodRange('custom', '2026-11-07', '2026-11-05', '2026-11-02'), { from: '2026-11-02', to: '2026-11-05' });
  assert.deepEqual(getPreviousRange({ from: '2026-11-02', to: '2026-11-07' }), { from: '2026-10-27', to: '2026-11-01' });
});

test('department matching normalizes Bar, Kitchen, Housekeeping and General', () => {
  assert.equal(normalizeDepartment('Bar Store'), 'Bar');
  assert.equal(normalizeDepartment('F&B'), 'Kitchen');
  assert.equal(normalizeDepartment('Room Amenities'), 'Housekeeping');
  assert.equal(productDepartment({ production_center: 'Kitchen', category: 'General' }), 'Kitchen');
  const products = [
    { id: 'a', name: 'Gin', category: 'F&B', production_center: 'Bar', location: 'Bar Store' },
    { id: 'b', name: 'Soup', category: 'F&B', production_center: 'Kitchen', location: 'Kitchen Store' },
    { id: 'c', name: 'Soap', category: 'Housekeeping', location: 'Main Store' },
  ];
  assert.deepEqual(filterProducts(products, { department: 'Bar', location: 'Bar Store', search: 'gin' }).map((item) => item.id), ['a']);
  assert.deepEqual(filterProducts(products, { department: 'Kitchen' }).map((item) => item.id), ['b']);
});

test('stock summary distinguishes zero, critical low, reorder and over-maximum levels', () => {
  const products = [
    { id: 'zero', current_stock: 0, min_stock: 5, max_stock: 15, cost_price: 10 },
    { id: 'critical', current_stock: 2, min_stock: 10, max_stock: 20, cost_price: 4 },
    { id: 'reorder', current_stock: 8, min_stock: 10, max_stock: 20, cost_price: 3 },
    { id: 'normal', current_stock: 12, min_stock: 10, max_stock: 20, cost_price: 2 },
    { id: 'over', current_stock: 25, min_stock: 10, max_stock: 20, cost_price: 1 },
  ];
  const expiry = [{ product_id: 'reorder', expiry_status: 'expiring_soon' }];
  assert.deepEqual(summarizeStock(products, expiry), {
    products: 5,
    value: 81,
    outOfStock: 1,
    criticalLow: 1,
    belowReorder: 2,
    overstock: 1,
    expiring: 1,
  });
});

test('sales and wastage summaries count recorded quantities without inventing rows', () => {
  const sales = summarizeSalesItems([
    { status: 'posted', items: [{ name: 'Tea', qty: 2, price: 50, department: 'Bar' }] },
    { status: 'voided', items: [{ name: 'Tea', qty: 99, price: 50 }] },
    { status: 'posted', items: [{ name: 'Tea', quantity: 1, total: 60 }] },
  ]);
  assert.equal(sales.length, 1);
  assert.equal(sales[0].qty, 3);
  assert.equal(sales[0].revenue, 160);
  const wasted = summarizeWastage([
    { quantity: 2, product: { name: 'Milk', category: 'F&B', cost_price: 40 } },
    { quantity: 1, product: { name: 'Milk', category: 'F&B', cost_price: 40 } },
  ]);
  assert.equal(wasted[0].qty, 3);
  assert.equal(wasted[0].estimatedValue, 120);
});

test('approved count variance is an estimate based on current product costs', () => {
  const counts = [
    { id: 'draft', status: 'draft', created_at: '2026-11-07T12:00:00Z' },
    { id: 'approved', status: 'approved', reference: 'COUNT-1', created_at: '2026-11-06T12:00:00Z', inventory_count_lines: [
      { expected_qty: 10, counted_qty: 8, product: { cost_price: 5 } },
      { expected_qty: 5, counted_qty: 6, product: { cost_price: 2 } },
    ] },
  ];
  assert.deepEqual(summarizeCount(counts), {
    id: 'approved', reference: 'COUNT-1', createdAt: '2026-11-06T12:00:00Z', varianceQty: -1,
    estimatedVarianceValue: -8, variancePercent: (8 / 60) * 100,
  });
  assert.equal(summarizeCount([{ status: 'draft' }]), null);
});

test('sales versus usage series is bounded to supplied business dates and labels current-cost estimate input', () => {
  const series = makeSalesConsumptionSeries({
    from: '2026-11-06',
    to: '2026-11-07',
    salesDaily: [{ business_date: '2026-11-06', revenue: 1200 }],
    movements: [{ created_at: '2026-11-07T08:00:00+03:00', source_type: 'usage', qty: 3, product: { cost_price: 20 } }],
  });
  assert.deepEqual(series, [
    { date: '2026-11-06', sales: 1200, consumptionEstimate: 0 },
    { date: '2026-11-07', sales: 0, consumptionEstimate: 60 },
  ]);
});

test('department comparison separates reported sales from movement-value estimates', () => {
  const result = departmentComparison(
    [{ department: 'Bar', revenue: 500 }, { department: 'Kitchen', revenue: 800 }],
    [{ source_type: 'usage', qty: 2, product: { production_center: 'Bar', cost_price: 10 } }],
  );
  assert.equal(result.find((row) => row.department === 'Bar').sales, 500);
  assert.equal(result.find((row) => row.department === 'Bar').usageEstimate, 20);
  assert.equal(result.find((row) => row.department === 'Kitchen').sales, 800);
});


test('direct POS product sales are included in Storekeeper consumption and department estimates', async () => {
  const { summarizeMovements } = await import('./storekeeperDashboardCore.js');
  const movements = [
    { source_type: 'pos_sale', product_id: 'p1', qty: 2, signed_qty: -2, created_at: '2026-11-07T08:00:00+03:00', product: { name: 'Juice', production_center: 'Bar', cost_price: 30 } },
    { source_type: 'pos_recipe', product_id: 'p2', qty: 1, signed_qty: -1, created_at: '2026-11-07T09:00:00+03:00', product: { name: 'Milk', production_center: 'Kitchen', cost_price: 40 } },
    { source_type: 'purchase', product_id: 'p3', qty: 10, signed_qty: 10, created_at: '2026-11-07T10:00:00+03:00', product: { name: 'Milk', production_center: 'Kitchen', cost_price: 40 } },
  ];
  const daily = makeSalesConsumptionSeries({ from: '2026-11-07', to: '2026-11-07', movements });
  assert.equal(daily[0].consumptionEstimate, 100);
  const comparison = departmentComparison([], movements);
  assert.equal(comparison.find((row) => row.department === 'Bar').usageEstimate, 60);
  assert.equal(comparison.find((row) => row.department === 'Kitchen').usageEstimate, 40);
  const summary = summarizeMovements(movements, { today: '2026-11-07' });
  assert.equal(summary.useRows.length, 2);
  assert.equal(summary.issuedOrConsumedEstimatedValue, 100);
});
