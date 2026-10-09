const PAYMENT_METHOD_ALIASES = Object.freeze({
  room: 'room_charge',
  room_charge: 'room_charge',
  cash: 'cash',
  mpesa: 'mpesa',
  card: 'card',
  bank: 'bank',
  other: 'other',
});

export function normalizePosPaymentMethod(method) {
  const key = String(method || 'other').trim().toLowerCase();
  return PAYMENT_METHOD_ALIASES[key] || 'other';
}

const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function summarizePosReceipts(rows = [], openingCash = 0) {
  const payments = {
    cash: { amount: 0, count: 0 },
    mpesa: { amount: 0, count: 0 },
    card: { amount: 0, count: 0 },
    bank: { amount: 0, count: 0 },
    room_charge: { amount: 0, count: 0 },
    other: { amount: 0, count: 0 },
  };
  const categories = {
    food: { qty: 0, amount: 0 },
    drinks: { qty: 0, amount: 0 },
  };

  const orders = (Array.isArray(rows) ? rows : [])
    .filter((receipt) => !receipt?.status || receipt.status === 'posted')
    .map((receipt) => {
      const method = normalizePosPaymentMethod(receipt.payment_method);
      payments[method].amount += amount(receipt.total);
      payments[method].count += 1;

      (Array.isArray(receipt.items) ? receipt.items : []).forEach((item) => {
        const qty = Math.max(0, amount(item?.qty ?? item?.quantity ?? 1));
        const lineAmount = item?.total != null
          ? amount(item.total)
          : amount(item?.price) * qty;
        const categoryLabel = String(item?.category || '').toLowerCase();
        const center = String(item?.center || '').toLowerCase();
        const category = categoryLabel.includes('drink') || center === 'bar' ? 'drinks' : 'food';
        categories[category].qty += qty;
        categories[category].amount += lineAmount;
      });
      return receipt;
    });

  const totalSales = Object.values(payments).reduce((sum, payment) => sum + payment.amount, 0);
  const cashSales = payments.cash.amount;
  return {
    orders,
    payments,
    categories,
    totalSales,
    totalTransactions: orders.length,
    expectedCash: amount(openingCash) + cashSales,
    countedCash: null,
    variance: null,
  };
}
