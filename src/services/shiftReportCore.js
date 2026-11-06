const PAYMENT_METHODS = ['cash', 'mpesa', 'card', 'bank', 'room_charge', 'other'];

export function normalizeShiftPaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'room' || method === 'room_charge') return 'room_charge';
  return PAYMENT_METHODS.includes(method) ? method : 'other';
}

export function buildShiftSalesSummary(receipts = [], allocations = []) {
  const payments = Object.fromEntries(PAYMENT_METHODS.map((method) => [method, { amount: 0, count: 0 }]));
  const allocationMap = new Map();
  for (const allocation of allocations) {
    const receiptId = String(allocation.receipt_id || '');
    if (!allocationMap.has(receiptId)) allocationMap.set(receiptId, []);
    allocationMap.get(receiptId).push(allocation);
  }

  const countedByMethod = new Map(PAYMENT_METHODS.map((method) => [method, new Set()]));
  const categories = { food: { qty: 0, amount: 0 }, drinks: { qty: 0, amount: 0 } };
  let totalSales = 0;
  let totalCovers = 0;
  let itemsSold = 0;

  for (const receipt of receipts) {
    const receiptTotal = Number(receipt.total || 0);
    totalSales += receiptTotal;
    totalCovers += Math.max(1, Number(receipt.covers || 1));

    const methodRows = String(receipt.payment_method || '').toLowerCase() === 'split'
      ? (allocationMap.get(String(receipt.id)) || [])
      : [{ payment_method: receipt.payment_method, amount: receiptTotal }];

    for (const row of methodRows) {
      const method = normalizeShiftPaymentMethod(row.payment_method);
      payments[method].amount += Number(row.amount || 0);
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

  for (const method of PAYMENT_METHODS) payments[method].count = countedByMethod.get(method).size;

  return {
    payments,
    categories,
    totalSales,
    totalTransactions: receipts.length,
    totalCovers,
    itemsSold,
  };
}
