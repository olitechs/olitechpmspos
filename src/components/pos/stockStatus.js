export function getPosStockStatus(stock, minimumStock = 0) {
  if (stock === null || stock === undefined || stock === '') return 'unknown';
  const quantity = Number(stock);
  if (!Number.isFinite(quantity)) return 'unknown';
  if (quantity <= 0) return 'out-of-stock';
  const threshold = Number(minimumStock ?? 0);
  if (Number.isFinite(threshold) && threshold > 0 && quantity <= threshold) return 'low-stock';
  return 'available';
}

function normalizePosSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

export function filterPosMenuItems(items, query) {
  const search = normalizePosSearch(query);
  if (!search) return items;
  const tokens = search.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const searchable = normalizePosSearch([item?.name, item?.sku, item?.category].filter(Boolean).join(' '));
    return tokens.every((token) => searchable.includes(token));
  });
}
