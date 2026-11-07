const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('en');

export function isProductUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function createPosSaleIdempotencyKey({ propertyId, tableKey, orderNumber } = {}) {
  const parts = [propertyId, tableKey, orderNumber].map((value) => String(value || '').trim());
  if (parts.some((value) => !value)) {
    throw new Error('Property, table, and order identity are required for POS sale idempotency.');
  }
  return `pos-sale:v1:${parts.map(encodeURIComponent).join(':')}`;
}

export function buildPosSaleItems(orderLines = [], recipeMenuNames = [], recipeLookupAvailable = true) {
  const recipeNames = new Set((recipeMenuNames || []).map((recipe) => normalizeName(
    typeof recipe === 'string' ? recipe : recipe?.menu_item_name
  )).filter(Boolean));

  return (Array.isArray(orderLines) ? orderLines : []).map((line, index) => {
    const productId = line?.productId || line?.product_id || null;
    const name = String(line?.name || line?.item_name || '').trim();
    const isRecipe = recipeNames.has(normalizeName(name));
    const hasProduct = isProductUuid(productId);
    const stockTrackingStatus = isRecipe
      ? 'recipe'
      : hasProduct
        ? 'product'
        : recipeLookupAvailable
          ? 'unlinked'
          : 'unverified';
    const orderLineId = String(line?.id || '').trim() || `line-${index + 1}`;
    const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

    return {
      order_line_id: orderLineId,
      product_id: hasProduct ? productId : null,
      name,
      qty: numeric(line?.qty ?? line?.quantity),
      price: numeric(line?.price),
      base_price: numeric(line?.basePrice ?? line?.base_price ?? line?.price),
      modifier_total: numeric(line?.modifierTotal ?? line?.modifier_total),
      modifiers: Array.isArray(line?.modifiers) ? line.modifiers : [],
      category: line?.category || null,
      center: line?.center || null,
      stock_tracking_status: stockTrackingStatus,
    };
  });
}
