export function getPosStockStatus(stock, minimumStock = 0) {
  if (stock === null || stock === undefined || stock === '') return 'unknown';
  const quantity = Number(stock);
  if (!Number.isFinite(quantity)) return 'unknown';
  if (quantity <= 0) return 'out-of-stock';
  const threshold = Number(minimumStock ?? 0);
  if (Number.isFinite(threshold) && threshold > 0 && quantity <= threshold) return 'low-stock';
  return 'available';
}
