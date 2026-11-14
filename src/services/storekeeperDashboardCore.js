const EAT = 'Africa/Nairobi';

export function formatBusinessDate(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EAT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const part = (name) => parts.find((entry) => entry.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getPeriodRange(period, today = formatBusinessDate(), customFrom = today, customTo = today) {
  if (period === 'custom') {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (period === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    return { from: shiftDate(today, mondayOffset), to: today };
  }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: today, to: today };
}

export function getPreviousRange(range) {
  const start = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const previousTo = shiftDate(range.from, -1);
  return { from: shiftDate(previousTo, -(days - 1)), to: previousTo };
}

export function normalizeDepartment(value) {
  const text = String(value || '').toLowerCase().trim();
  if (text.includes('bar')) return 'Bar';
  if (text.includes('kitchen') || text === 'f&b' || text.includes('food') || text.includes('beverage')) return 'Kitchen';
  if (text.includes('housekeep') || text.includes('room amenit')) return 'Housekeeping';
  return 'General';
}

export function productDepartment(product) {
  return normalizeDepartment(product?.production_center || product?.department || product?.category || product?.location);
}

export function matchesDepartment(product, department = 'All') {
  return department === 'All' || productDepartment(product) === department;
}

export function matchesLocation(product, location = 'All locations') {
  return location === 'All locations' || String(product?.location || '').trim() === location;
}

export function filterProducts(products = [], { department = 'All', location = 'All locations', search = '' } = {}) {
  const query = String(search || '').trim().toLocaleLowerCase();
  return products.filter((product) => {
    if (!matchesDepartment(product, department) || !matchesLocation(product, location)) return false;
    if (!query) return true;
    return [product.name, product.sku, product.barcode, product.category, product.location]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
}

export function summarizeStock(products = [], expiry = [], { department = 'All', location = 'All locations' } = {}) {
  const scoped = products.filter((product) => matchesDepartment(product, department) && matchesLocation(product, location));
  const expiryIds = new Set(expiry.filter((item) => item.expiry_status === 'expiring_soon' || item.expiry_status === 'expired').map((item) => item.product_id));
  return {
    products: scoped.length,
    value: scoped.reduce((sum, product) => sum + Math.max(0, Number(product.current_stock) || 0) * (Number(product.cost_price) || 0), 0),
    outOfStock: scoped.filter((product) => Number(product.current_stock) <= 0).length,
    criticalLow: scoped.filter((product) => Number(product.current_stock) > 0 && Number(product.min_stock) > 0 && Number(product.current_stock) <= Number(product.min_stock) / 2).length,
    belowReorder: scoped.filter((product) => Number(product.current_stock) > 0 && Number(product.min_stock) > 0 && Number(product.current_stock) <= Number(product.min_stock)).length,
    overstock: scoped.filter((product) => Number(product.max_stock) > 0 && Number(product.current_stock) > Number(product.max_stock)).length,
    expiring: scoped.filter((product) => expiryIds.has(product.id)).length,
  };
}

export function isStockConsumptionMovement(movement) {
  return ['usage', 'pos_recipe', 'pos_sale'].includes(String(movement?.source_type || '').toLowerCase());
}

export function estimateMovementValue(movement) {
  const unitCost = Number(movement?.product?.cost_price);
  if (!Number.isFinite(unitCost)) return null;
  return Math.abs(Number(movement.signed_qty ?? movement.qty) || 0) * unitCost;
}

export function summarizeMovements(movements = [], { today, products = [] } = {}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const todayRows = movements.filter((movement) => formatBusinessDate(movement.created_at) === today);
  const useRows = todayRows.filter((movement) => isStockConsumptionMovement(movement));
  const wasteRows = todayRows.filter((movement) => ['wastage', 'inventory_wastage'].includes(String(movement.source_type || '').toLowerCase()));
  const valueFor = (rows) => rows.reduce((sum, movement) => sum + (estimateMovementValue({
    ...movement,
    product: { ...productById.get(movement.product_id), ...movement.product },
  }) || 0), 0);
  return {
    issuedOrConsumedEstimatedValue: valueFor(useRows),
    wastedEstimatedValue: valueFor(wasteRows),
    useRows,
    wasteRows,
  };
}

export function makeSalesConsumptionSeries({ from, to, salesDaily = [], movements = [] } = {}) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || from > to) return [];
  const salesByDate = new Map(salesDaily.map((row) => [String(row.business_date).slice(0, 10), Number(row.revenue) || 0]));
  const consumeByDate = new Map();
  for (const movement of movements) {
    if (!isStockConsumptionMovement(movement)) continue;
    const day = formatBusinessDate(movement.created_at);
    consumeByDate.set(day, (consumeByDate.get(day) || 0) + (estimateMovementValue(movement) || 0));
  }
  const result = [];
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    result.push({ date: day, sales: salesByDate.get(day) || 0, consumptionEstimate: consumeByDate.get(day) || 0 });
  }
  return result;
}

export function summarizeSalesItems(receipts = []) {
  const totals = new Map();
  for (const receipt of receipts) {
    if (receipt.status && receipt.status !== 'posted') continue;
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    for (const item of items) {
      const name = String(item.name || item.product_name || 'Unlabelled item').trim();
      const qty = Number(item.qty ?? item.quantity) || 0;
      if (qty <= 0) continue;
      const revenue = Number(item.total) || (Number(item.price) || 0) * qty;
      const existing = totals.get(name) || { name, qty: 0, revenue: 0, department: normalizeDepartment(item.department || item.production_center || item.category) };
      existing.qty += qty;
      existing.revenue += revenue;
      totals.set(name, existing);
    }
  }
  return [...totals.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10);
}

export function summarizeWastage(wastage = []) {
  const totals = new Map();
  for (const row of wastage) {
    const product = row.product || {};
    const name = product.name || row.product_name || 'Unlabelled item';
    const qty = Number(row.quantity || row.qty) || 0;
    const existing = totals.get(name) || { name, qty: 0, estimatedValue: 0, department: productDepartment(product) };
    existing.qty += qty;
    existing.estimatedValue += qty * (Number(product.cost_price) || 0);
    totals.set(name, existing);
  }
  return [...totals.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
}

export function summarizeCount(counts = []) {
  const latest = counts.find((count) => count.status === 'approved');
  if (!latest) return null;
  const lines = latest.inventory_count_lines || latest.lines || [];
  let expectedValue = 0;
  let varianceValue = 0;
  let varianceQty = 0;
  for (const line of lines) {
    const expected = Number(line.expected_qty ?? line.system_qty ?? line.expected_quantity) || 0;
    const counted = Number(line.counted_qty ?? line.actual_qty ?? line.counted_quantity) || 0;
    const cost = Number(line.product?.cost_price ?? line.cost_price) || 0;
    expectedValue += Math.abs(expected) * cost;
    varianceValue += (counted - expected) * cost;
    varianceQty += counted - expected;
  }
  return {
    id: latest.id,
    reference: latest.reference || 'Physical count',
    createdAt: latest.created_at,
    varianceQty,
    estimatedVarianceValue: varianceValue,
    variancePercent: expectedValue > 0 ? Math.abs(varianceValue) / expectedValue * 100 : null,
  };
}

export function departmentComparison(salesDepartments = [], movements = []) {
  const saleValues = new Map();
  for (const row of salesDepartments) {
    const dept = normalizeDepartment(row.department);
    saleValues.set(dept, (saleValues.get(dept) || 0) + (Number(row.revenue) || 0));
  }
  const useValues = new Map();
  for (const movement of movements) {
    if (!isStockConsumptionMovement(movement)) continue;
    const dept = productDepartment(movement.product || {});
    useValues.set(dept, (useValues.get(dept) || 0) + (estimateMovementValue(movement) || 0));
  }
  return ['Bar', 'Kitchen', 'Housekeeping', 'General'].map((department) => ({
    department,
    sales: saleValues.get(department) || 0,
    usageEstimate: useValues.get(department) || 0,
  }));
}

export function getStockLocations(products = []) {
  return [...new Set(products.map((product) => String(product.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
