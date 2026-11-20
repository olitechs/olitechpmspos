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


/**
 * Composite menu products are stocked through their recipe components, not
 * through the sellable menu-product row. Keep direct-stock checks for normal
 * products, and derive composite availability only from component rows.
 */
export function getPosTileAvailability(item, componentRows = []) {
  const isComposite = item?.inventory_tracking_mode === 'composite'
    || item?.tracking_mode === 'composite';
  if (!isComposite) {
    const status = getPosStockStatus(item?.stock, item?.minimumStock);
    return { status, outOfStock: status === 'out-of-stock', componentOutOfStock: false, componentLowStock: false };
  }
  const rows = Array.isArray(componentRows) ? componentRows : [];
  const availabilityUnknown = rows.length === 0;
  const componentOutOfStock = rows.some((component) =>
    Number(component.available_stock ?? 0) < Number(component.required_per_sale ?? 0)
  );
  const componentLowStock = rows.some((component) => component.stock_status === 'low_stock');
  return {
    status: availabilityUnknown ? 'unknown' : componentOutOfStock ? 'out-of-stock' : componentLowStock ? 'low-stock' : 'available',
    outOfStock: componentOutOfStock,
    availabilityUnknown,
    componentOutOfStock,
    componentLowStock,
  };
}
