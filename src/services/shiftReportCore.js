const PAYMENT_METHODS = ['cash', 'mpesa', 'card', 'bank', 'room_charge', 'other'];

export function normalizeShiftPaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'room' || method === 'room_charge') return 'room_charge';
  return PAYMENT_METHODS.includes(method) ? method : 'other';
}

export function diagnoseSplitTenderAllocations(receipts = [], allocations = []) {
  const byReceipt = new Map();
  for (const allocation of Array.isArray(allocations) ? allocations : []) {
    const id = String(allocation.receipt_id || '');
    if (!id) continue;
    if (!byReceipt.has(id)) byReceipt.set(id, []);
    byReceipt.get(id).push(allocation);
  }
  const exceptions = [];
  let splitReceiptCount = 0;
  let allocatedTotal = 0;
  let receiptTotal = 0;
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (String(receipt?.payment_method || '').toLowerCase() !== 'split') continue;
    splitReceiptCount += 1;
    const expected = Number(receipt.total || 0);
    const rows = byReceipt.get(String(receipt.id)) || [];
    const allocated = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const difference = Math.round((expected - allocated) * 100) / 100;
    receiptTotal += expected;
    allocatedTotal += allocated;
    if (!rows.length || Math.abs(difference) > 0.01) {
      exceptions.push({
        receipt_id: receipt.id,
        receipt_number: String(receipt.order_number || receipt.receipt_number || receipt.id || 'Unknown receipt'),
        expected_total: expected,
        allocated_total: allocated,
        difference,
        status: rows.length ? 'mismatched' : 'missing',
        allocations: rows.map((row) => ({
          payment_method: normalizeShiftPaymentMethod(row.payment_method),
          amount: Number(row.amount || 0),
        })),
      });
    }
  }
  return {
    splitReceiptCount,
    reconciledCount: splitReceiptCount - exceptions.length,
    exceptionCount: exceptions.length,
    missingAllocationCount: exceptions.filter((row) => row.status === 'missing').length,
    mismatchedAllocationCount: exceptions.filter((row) => row.status === 'mismatched').length,
    receiptTotal: Math.round(receiptTotal * 100) / 100,
    allocatedTotal: Math.round(allocatedTotal * 100) / 100,
    unallocatedOrVariance: Math.round((receiptTotal - allocatedTotal) * 100) / 100,
    exceptions,
  };
}

export function buildShiftSalesSummary(receipts = [], allocations = [], refunds = [], voidedReceipts = []) {
  const payments = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, { amount: 0, count: 0 }]));
  const grossPayments = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, { amount: 0, count: 0 }]));
  const refundsByMethod = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, 0]));
  const allocationMap = new Map();
  for (const allocation of allocations) {
    const receiptId = String(allocation.receipt_id || '');
    if (!allocationMap.has(receiptId)) allocationMap.set(receiptId, []);
    allocationMap.get(receiptId).push(allocation);
  }

  const splitReconciliation = diagnoseSplitTenderAllocations(receipts, allocations);
  const countedByMethod = new Map(PAYMENT_METHODS.map((method) => [method, new Set()]));
  const categories = { food: { qty: 0, amount: 0 }, drinks: { qty: 0, amount: 0 } };
  let grossSales = 0;
  let refundsTotal = 0;
  let totalCovers = 0;
  let itemsSold = 0;

  for (const receipt of receipts) {
    const receiptTotal = Number(receipt.total || 0);
    grossSales += receiptTotal;
    totalCovers += Math.max(1, Number(receipt.covers || 1));

    const methodRows = String(receipt.payment_method || '').toLowerCase() === 'split'
      ? (allocationMap.get(String(receipt.id)) || [])
      : [{ payment_method: receipt.payment_method, amount: receiptTotal }];

    for (const row of methodRows) {
      const method = normalizeShiftPaymentMethod(row.payment_method);
      payments[method].amount += Number(row.amount || 0);
      grossPayments[method].amount += Number(row.amount || 0);
      countedByMethod.get(method).add(String(receipt.id));
    }

    for (const item of Array.isArray(receipt.items) ? receipt.items : []) {
      const qty = Math.max(0, Number(item.qty ?? item.quantity ?? 1));
      const amount = Number(item.total || 0) || Number(item.price || 0) * qty;
      const categoryText = String(item.category || item.center || '').toLowerCase();
      const category = categoryText.includes('drink') || String(item.center || '').toLowerCase() === 'bar' ? 'drinks' : 'food';
      categories[category].qty += qty;
      categories[category].amount += amount;
      itemsSold += qty;
    }
  }

  for (const refund of refunds) {
    const method = normalizeShiftPaymentMethod(refund.settlement_method || refund.method);
    const amount = Number(refund.amount || 0);
    payments[method].amount -= amount;
    refundsByMethod[method] += amount;
    refundsTotal += amount;
  }

  for (const method of PAYMENT_METHODS) {
    payments[method].count = countedByMethod.get(method).size;
    grossPayments[method].count = countedByMethod.get(method).size;
  }

  const voidedValue = voidedReceipts.reduce((sum, receipt) => sum + Number(receipt.total || 0), 0);
  return {
    payments,
    grossPayments,
    refundsByMethod,
    categories,
    grossSales,
    refundsTotal,
    voidedValue,
    totalSales: grossSales - refundsTotal,
    totalTransactions: receipts.length,
    totalCovers,
    itemsSold,
  };
}
