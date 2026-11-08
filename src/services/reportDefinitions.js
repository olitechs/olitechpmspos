const toNumber = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const cleanText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const dateLabel = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

export const formatReportValue = (value, column = {}) => {
  if (value === null || value === undefined || value === '') return '—';
  if (column.format === 'currency') return `KES ${toNumber(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (column.format === 'number' || column.format === 'quantity') return toNumber(value).toLocaleString('en-KE', { maximumFractionDigits: 3 });
  if (column.format === 'percent') return `${(toNumber(value) * 100).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`;
  if (column.format === 'date' || column.format === 'datetime') {
    const text = String(value);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-KE', column.format === 'date' ? { dateStyle: 'medium', timeZone: 'Africa/Nairobi' } : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
  }
  return String(value);
};

export function createReportDefinition({
  key,
  title,
  subtitle = '',
  propertyName = 'OliTechs',
  period = {},
  filters = {},
  generatedBy = 'Authorized user',
  generatedAt = new Date().toISOString(),
  summary = [],
  sections = [],
  notes = [],
}) {
  const normalizedSections = (sections || []).map((section) => ({
    name: cleanText(section.name, 'Report data'),
    title: cleanText(section.title, section.name || 'Report data'),
    columns: Array.isArray(section.columns) ? section.columns : [],
    rows: Array.isArray(section.rows) ? section.rows : [],
    pdf: section.pdf !== false,
    excel: section.excel !== false,
  }));
  if (!key || !title || !normalizedSections.length) throw new Error('A report key, title and at least one data section are required.');
  const rowCount = normalizedSections.reduce((total, section) => total + section.rows.length, 0);
  return {
    key,
    title,
    subtitle,
    propertyName,
    period: { from: period.from || '', to: period.to || '' },
    filters: { ...filters },
    generatedBy,
    generatedAt,
    summary: Array.isArray(summary) ? summary : [],
    sections: normalizedSections,
    notes: Array.isArray(notes) ? notes : [],
    rowCount,
  };
}

const metric = (label, value, format = 'number') => ({ label, value: toNumber(value), format });
const sumColumn = (key, label, format = 'number', width = 16) => ({ key, label, type: 'number', format, width, total: 'sum', align: 'right' });
const textColumn = (key, label, width = 24) => ({ key, label, type: 'text', width });
const dateColumn = (key, label, width = 18) => ({ key, label, type: 'date', format: 'date', width });
const dateTimeColumn = (key, label, width = 22) => ({ key, label, type: 'datetime', format: 'datetime', width });
const numberColumn = (key, label, format = 'number', width = 16) => ({ key, label, type: 'number', format, width, align: 'right' });

export function buildSalesSummaryDefinition({ report = {}, sales = {}, from, to, propertyName, generatedBy }) {
  const details = sales || {};
  const totals = report?.sales || {};
  const departmentRows = (details.departments || []).map((row) => ({ department: cleanText(row.department, 'Unassigned'), qty: toNumber(row.qty), revenue: toNumber(row.revenue) }));
  const departmentSheets = ['Bar', 'Kitchen'].map((department) => ({
    department,
    rows: departmentRows.filter((row) => row.department.toLowerCase() === department.toLowerCase()),
  })).filter((group) => group.rows.length);
  return createReportDefinition({
    key: 'sales-summary',
    title: 'Sales Summary',
    subtitle: 'Management summary from posted POS and PMS transactions',
    propertyName,
    period: { from, to },
    filters: { period: `${from} to ${to}`, scope: 'All departments' },
    generatedBy,
    summary: [
      metric('POS gross sales', totals.pos_gross, 'currency'),
      metric('POS net sales', totals.pos_net, 'currency'),
      metric('POS tax', totals.pos_tax, 'currency'),
      metric('Discounts', totals.discounts, 'currency'),
      metric('Refunds', totals.refunds, 'currency'),
      metric('Voids', totals.voids, 'currency'),
      ...departmentSheets.map((group) => metric(`${group.department} revenue`, group.rows.reduce((sum, row) => sum + row.revenue, 0), 'currency')),
    ],
    sections: [
      {
        name: 'sales-kpis', title: 'Sales KPIs',
        columns: [textColumn('metric', 'Metric', 26), { key: 'value', label: 'Value', type: 'number', format: 'currency', width: 20, align: 'right' }],
        rows: [
          { metric: 'POS gross sales', value: toNumber(totals.pos_gross) },
          { metric: 'POS net sales', value: toNumber(totals.pos_net) },
          { metric: 'POS tax', value: toNumber(totals.pos_tax) },
          { metric: 'Discounts', value: toNumber(totals.discounts) },
          { metric: 'Refunds', value: toNumber(totals.refunds) },
          { metric: 'Voids', value: toNumber(totals.voids) },
        ],
      },
      {
        name: 'sales-by-department', title: 'Sales by Department',
        columns: [textColumn('department', 'Department'), sumColumn('qty', 'Quantity', 'quantity'), sumColumn('revenue', 'Revenue', 'currency', 20)],
        rows: departmentRows,
      },
      ...departmentSheets.map((group) => ({
        name: `${group.department.toLowerCase()}-sales`, title: `${group.department} Sales`, pdf: false,
        columns: [textColumn('department', 'Department'), sumColumn('qty', 'Quantity', 'quantity'), sumColumn('revenue', 'Revenue', 'currency', 20)],
        rows: group.rows,
      })),
    ],
    notes: ['Sales measures follow the authoritative management-report RPC for the selected property and Kenya business-date range.'],
  });
}

export function buildSalesReportDefinition({ report = {}, sales = {}, from, to, propertyName, generatedBy }) {
  const salesSummary = buildSalesSummaryDefinition({ report, sales, from, to, propertyName, generatedBy });
  const detail = sales || {};
  const daily = (detail.daily || []).map((row) => ({ business_date: cleanText(row.business_date), revenue: toNumber(row.revenue) }));
  return createReportDefinition({
    key: 'sales-report',
    title: 'Sales Report',
    subtitle: 'Transactional sales breakdown by day, department and payment type',
    propertyName,
    period: { from, to },
    filters: { period: `${from} to ${to}`, scope: 'All departments', status: 'Posted transactions' },
    generatedBy,
    summary: salesSummary.summary,
    sections: [
      ...salesSummary.sections,
      {
        name: 'daily-sales', title: 'Daily POS Sales',
        columns: [dateColumn('business_date', 'Business date', 22), sumColumn('revenue', 'Revenue', 'currency', 20)],
        rows: daily,
      },
      {
        name: 'payment-methods', title: 'Payment Methods',
        columns: [textColumn('method', 'Payment type'), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 20)],
        rows: (detail.payments || []).map((row) => ({ method: cleanText(row.method, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) })),
      },
      {
        name: 'discounts', title: 'Discounts',
        columns: [textColumn('discount', 'Discount'), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 20)],
        rows: (detail.discounts || []).map((row) => ({ discount: cleanText(row.discount, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) })),
      },
      {
        name: 'voids', title: 'Voids',
        columns: [textColumn('reason', 'Reason'), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 20)],
        rows: (detail.voids || []).map((row) => ({ reason: cleanText(row.reason, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) })),
      },
      {
        name: 'refunds', title: 'Refunds',
        columns: [textColumn('method', 'Settlement method'), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 20)],
        rows: (detail.refunds || []).map((row) => ({ method: cleanText(row.method, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) })),
      },
    ],
    notes: ['Daily and category/payment breakdowns are drawn from the selected property-scoped management RPC results. This is not a settlement reconciliation.'],
  });
}

const normalizeReceiptItem = (item = {}) => {
  const quantity = toNumber(item.qty ?? item.quantity ?? item.count ?? 1);
  const unitPrice = toNumber(item.unit_price ?? item.price ?? item.selling_price ?? 0);
  const amount = item.total ?? item.line_total ?? item.amount;
  const lineRevenue = amount === null || amount === undefined ? unitPrice * quantity : toNumber(amount);
  const category = cleanText(item.category ?? item.pos_category ?? item.department ?? item.production_center, 'Uncategorized');
  const departmentSource = cleanText(item.production_center ?? item.center ?? item.department ?? item.category ?? item.pos_category);
  const department = /^bar$/i.test(departmentSource) ? 'Bar' : /^kitchen$/i.test(departmentSource) ? 'Kitchen' : '';
  return {
    name: cleanText(item.name ?? item.item_name ?? item.product_name, 'Unnamed item'),
    sku: cleanText(item.sku ?? item.product_sku),
    category,
    department,
    quantity,
    revenue: lineRevenue,
  };
};

export function aggregatePostedSalesReceipts(receipts = [], shifts = []) {
  const posted = (Array.isArray(receipts) ? receipts : []).filter((receipt) => receipt.status === 'posted');
  const itemTotals = new Map();
  const categoryTotals = new Map();
  const departmentItemTotals = new Map();
  const departmentCategoryTotals = new Map();
  const departmentTotals = new Map();
  const shiftTotals = new Map();
  const shiftDepartmentTotals = new Map();
  const shiftMap = new Map((Array.isArray(shifts) ? shifts : []).map((shift) => [String(shift.id), shift]));
  const separator = String.fromCharCode(0);

  posted.forEach((receipt) => {
    const shiftId = String(receipt.pos_shift_id || receipt.shift_id || 'unassigned');
    const shift = shiftMap.get(shiftId);
    const receiptDepartmentTotals = new Map();
    const items = Array.isArray(receipt.items) ? receipt.items : [];
    items.forEach((rawItem) => {
      const item = normalizeReceiptItem(rawItem);
      const key = `${item.sku}${separator}${item.name}`;
      const current = itemTotals.get(key) || { sku: item.sku, item: item.name, category: item.category, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.revenue;
      if (current.category === 'Uncategorized' && item.category !== 'Uncategorized') current.category = item.category;
      itemTotals.set(key, current);

      const category = categoryTotals.get(item.category) || { category: item.category, quantity: 0, revenue: 0 };
      category.quantity += item.quantity;
      category.revenue += item.revenue;
      categoryTotals.set(item.category, category);

      if (!item.department) return;
      const departmentItemKey = `${item.department}${separator}${item.sku}${separator}${item.name}`;
      const departmentItem = departmentItemTotals.get(departmentItemKey) || { department: item.department, sku: item.sku, item: item.name, category: item.category, quantity: 0, revenue: 0 };
      departmentItem.quantity += item.quantity;
      departmentItem.revenue += item.revenue;
      departmentItemTotals.set(departmentItemKey, departmentItem);

      const departmentCategoryKey = `${item.department}${separator}${item.category}`;
      const departmentCategory = departmentCategoryTotals.get(departmentCategoryKey) || { department: item.department, category: item.category, quantity: 0, revenue: 0 };
      departmentCategory.quantity += item.quantity;
      departmentCategory.revenue += item.revenue;
      departmentCategoryTotals.set(departmentCategoryKey, departmentCategory);

      const department = departmentTotals.get(item.department) || { department: item.department, quantity: 0, revenue: 0 };
      department.quantity += item.quantity;
      department.revenue += item.revenue;
      departmentTotals.set(item.department, department);

      const receiptDepartment = receiptDepartmentTotals.get(item.department) || { quantity: 0, revenue: 0 };
      receiptDepartment.quantity += item.quantity;
      receiptDepartment.revenue += item.revenue;
      receiptDepartmentTotals.set(item.department, receiptDepartment);
    });

    const currentShift = shiftTotals.get(shiftId) || {
      shift: shift?.shift_no || (shiftId === 'unassigned' ? 'Unassigned shift' : `Shift ${shiftId.slice(0, 8)}`),
      shift_date: shift?.date || '', posted_receipts: 0, gross_sales: 0,
    };
    currentShift.posted_receipts += 1;
    currentShift.gross_sales += toNumber(receipt.total);
    shiftTotals.set(shiftId, currentShift);

    receiptDepartmentTotals.forEach((values, departmentName) => {
      const key = `${departmentName}${separator}${shiftId}`;
      const row = shiftDepartmentTotals.get(key) || {
        department: departmentName,
        shift: shift?.shift_no || (shiftId === 'unassigned' ? 'Unassigned shift' : `Shift ${shiftId.slice(0, 8)}`),
        shift_date: shift?.date || '', posted_receipts: 0, quantity: 0, item_line_revenue: 0,
      };
      row.posted_receipts += 1;
      row.quantity += values.quantity;
      row.item_line_revenue += values.revenue;
      shiftDepartmentTotals.set(key, row);
    });
  });

  const sortByRevenue = (a, b) => b.revenue - a.revenue || a.item.localeCompare(b.item);
  const departments = ['Bar', 'Kitchen'];
  const rowsByDepartment = (rows) => Object.fromEntries(departments.map((department) => [department, rows.filter((row) => row.department === department)]));
  return {
    postedReceiptCount: posted.length,
    itemRows: [...itemTotals.values()].sort(sortByRevenue),
    categoryRows: [...categoryTotals.values()].sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category)),
    shiftRows: [...shiftTotals.values()].sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)) || String(a.shift).localeCompare(String(b.shift))),
    itemRowsByDepartment: rowsByDepartment([...departmentItemTotals.values()].sort(sortByRevenue)),
    categoryRowsByDepartment: rowsByDepartment([...departmentCategoryTotals.values()].sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category))),
    shiftRowsByDepartment: rowsByDepartment([...shiftDepartmentTotals.values()].sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)) || String(a.shift).localeCompare(String(b.shift)))),
    departmentRows: [...departmentTotals.values()],
  };
}

const departmentSummaryMetrics = (aggregated) => (aggregated.departmentRows || [])
  .filter((row) => ['bar', 'kitchen'].includes(String(row.department).toLowerCase()))
  .map((row) => metric(`${row.department} item-line revenue`, row.revenue, 'currency'));

const departmentSections = (rowsByDepartment, reportKind, columns) => ['Bar', 'Kitchen']
  .filter((department) => rowsByDepartment?.[department]?.length)
  .map((department) => ({
    name: `${department.toLowerCase()}-${reportKind}`,
    title: `${department} ${reportKind.replaceAll('-', ' ')}`,
    columns,
    rows: rowsByDepartment[department],
    pdf: false,
  }));

export function buildMonthlySalesByItemDefinition({ receipts = [], shifts = [], from, to, propertyName, generatedBy }) {
  const aggregated = aggregatePostedSalesReceipts(receipts, shifts);
  const columns = [textColumn('sku', 'SKU', 16), textColumn('item', 'Item', 34), textColumn('category', 'Category', 22), sumColumn('quantity', 'Quantity', 'quantity'), sumColumn('revenue', 'Line revenue', 'currency', 20)];
  return createReportDefinition({
    key: 'monthly-sales-by-item', title: 'Monthly Sales by Item',
    subtitle: 'Posted POS receipt item lines; line revenue excludes unallocated receipt-level tax and discounts',
    propertyName, period: { from, to }, filters: { period: `${from} to ${to}`, status: 'Posted receipts' }, generatedBy,
    summary: [metric('Posted receipts', aggregated.postedReceiptCount), metric('Items sold', aggregated.itemRows.reduce((sum, row) => sum + row.quantity, 0), 'quantity'), metric('Item-line revenue', aggregated.itemRows.reduce((sum, row) => sum + row.revenue, 0), 'currency'), ...departmentSummaryMetrics(aggregated)],
    sections: [
      { name: 'item-sales', title: 'Sales by Item', columns, rows: aggregated.itemRows },
      ...departmentSections(aggregated.itemRowsByDepartment, 'sales-by-item', columns),
    ],
    notes: ['Rows are grouped by item SKU and name from posted receipt item JSON. Where source rows contain no category, the category is shown as Uncategorized. Receipt-level taxes/discounts are not allocated to items.', 'When receipt item JSON explicitly identifies a Bar or Kitchen production center/department, Excel includes a separate sheet for that department and retains the combined Summary and Sales by Item sheet.'],
  });
}

export function buildMonthlySalesByCategoryDefinition({ receipts = [], shifts = [], from, to, propertyName, generatedBy }) {
  const aggregated = aggregatePostedSalesReceipts(receipts, shifts);
  const columns = [textColumn('category', 'Category', 28), sumColumn('quantity', 'Quantity', 'quantity'), sumColumn('revenue', 'Line revenue', 'currency', 20)];
  return createReportDefinition({
    key: 'monthly-sales-by-category', title: 'Monthly Sales by Category',
    subtitle: 'Posted POS receipt item lines grouped by the category saved on the item',
    propertyName, period: { from, to }, filters: { period: `${from} to ${to}`, status: 'Posted receipts' }, generatedBy,
    summary: [metric('Posted receipts', aggregated.postedReceiptCount), metric('Categories', aggregated.categoryRows.length), metric('Item-line revenue', aggregated.categoryRows.reduce((sum, row) => sum + row.revenue, 0), 'currency'), ...departmentSummaryMetrics(aggregated)],
    sections: [
      { name: 'category-sales', title: 'Sales by Category', columns, rows: aggregated.categoryRows },
      ...departmentSections(aggregated.categoryRowsByDepartment, 'sales-by-category', [textColumn('category', 'Category', 28), sumColumn('quantity', 'Quantity', 'quantity'), sumColumn('revenue', 'Line revenue', 'currency', 20)]),
    ],
    notes: ['Category uses the category, POS category, department or production-center value present in each receipt item. Missing source values are labeled Uncategorized; they are not inferred.', 'Where receipt item JSON explicitly identifies a Bar or Kitchen production center/department, separate department worksheets are included alongside the combined sheet.'],
  });
}

export function buildMonthlySalesByShiftDefinition({ receipts = [], shifts = [], from, to, propertyName, generatedBy }) {
  const aggregated = aggregatePostedSalesReceipts(receipts, shifts);
  const columns = [dateColumn('shift_date', 'Shift date', 18), textColumn('shift', 'Shift', 32), sumColumn('posted_receipts', 'Posted receipts'), sumColumn('gross_sales', 'Gross sales', 'currency', 20)];
  const departmentColumns = [dateColumn('shift_date', 'Shift date', 18), textColumn('shift', 'Shift', 32), sumColumn('posted_receipts', 'Receipts with department items'), sumColumn('quantity', 'Item quantity', 'quantity'), sumColumn('item_line_revenue', 'Item-line revenue', 'currency', 20)];
  return createReportDefinition({
    key: 'monthly-sales-by-shift', title: 'Monthly Sales by Shift',
    subtitle: 'Posted POS receipt totals grouped by the linked POS shift',
    propertyName, period: { from, to }, filters: { period: `${from} to ${to}`, status: 'Posted receipts' }, generatedBy,
    summary: [metric('Posted receipts', aggregated.postedReceiptCount), metric('Shifts with sales', aggregated.shiftRows.length), metric('Posted gross sales', aggregated.shiftRows.reduce((sum, row) => sum + row.gross_sales, 0), 'currency'), ...departmentSummaryMetrics(aggregated)],
    sections: [
      { name: 'shift-sales', title: 'Sales by Shift', columns, rows: aggregated.shiftRows },
      ...departmentSections(aggregated.shiftRowsByDepartment, 'shift-sales', departmentColumns),
    ],
    notes: ['Receipts without a linked shift are grouped as Unassigned shift. This report is a sales aggregate, not a cashier settlement reconciliation.', 'Bar/Kitchen shift worksheets are item-line revenue grouped by the linked shift; receipt-level taxes and discounts are not allocated to departments. They are separate from combined posted gross sales.'],
  });
}

export function buildSalesByPaymentTypeDefinition({ payments = [], from, to, propertyName, generatedBy }) {
  const rows = (payments || []).map((row) => ({ method: cleanText(row.method, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) }));
  return createReportDefinition({
    key: 'sales-by-payment-type', title: 'Sales by Payment Type',
    subtitle: 'Posted POS payment-method totals from the management sales-detail report',
    propertyName, period: { from, to }, filters: { period: `${from} to ${to}`, status: 'Posted transactions' }, generatedBy,
    summary: [metric('Transactions', rows.reduce((sum, row) => sum + row.transactions, 0)), metric('Reported payments', rows.reduce((sum, row) => sum + row.amount, 0), 'currency')],
    sections: [{ name: 'payment-types', title: 'Payment Types', columns: [textColumn('method', 'Payment type', 28), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 22)], rows }],
    notes: ['This is the management RPC payment-method aggregate. It does not reconcile settlements or expose card, M-Pesa, guest, or payment-reference data.'],
  });
}

export function buildStockControlDefinition({ products = [], movements = [], from = '', to = '', category = 'all', location = 'all', propertyName, generatedBy, showCost = false }) {
  const productRows = (products || []).map((product) => {
    const row = {
      sku: cleanText(product.sku), product: cleanText(product.name, 'Unnamed item'), category: cleanText(product.category, 'Uncategorized'),
      location: cleanText(product.location, 'Unassigned'), unit: cleanText(product.unit, 'pcs'), expiry_date: cleanText(product.expiry_date),
      current_stock: toNumber(product.current_stock), min_stock: toNumber(product.min_stock),
      stock_status: toNumber(product.current_stock) <= 0 ? 'Out of stock' : toNumber(product.current_stock) <= toNumber(product.min_stock) ? 'Below reorder level' : 'In stock',
    };
    if (showCost && product.cost_price !== null && product.cost_price !== undefined) {
      row.unit_cost = toNumber(product.cost_price);
      row.stock_value = row.current_stock * row.unit_cost;
    }
    return row;
  });
  const movementRows = (movements || []).map((movement) => ({
    date: dateLabel(movement.created_at),
    product: cleanText(movement.product?.name, 'Unknown item'),
    category: cleanText(movement.product?.category, 'Uncategorized'),
    location: cleanText(movement.product?.location, 'Unassigned'),
    movement_type: cleanText(movement.type, toNumber(movement.qty) >= 0 ? 'in' : 'out'),
    quantity: Math.abs(toNumber(movement.qty)),
    unit: cleanText(movement.product?.unit),
    reason: cleanText(movement.reason),
    source_document: cleanText(movement.source_document ?? movement.source_doc ?? movement.document_reference ?? movement.reference ?? movement.reference_id),
    recorded_by: cleanText(movement.user_profile?.full_name),
  }));
  const summary = [metric('Products', productRows.length), metric('Out of stock', productRows.filter((row) => row.current_stock <= 0).length), metric('Below reorder', productRows.filter((row) => row.current_stock > 0 && row.current_stock <= row.min_stock).length)];
  if (showCost) summary.push(metric('Stock value', productRows.reduce((sum, row) => sum + toNumber(row.stock_value), 0), 'currency'));
  const productColumns = [textColumn('sku', 'SKU', 16), textColumn('product', 'Product', 30), textColumn('category', 'Category', 20), textColumn('location', 'Location', 22), textColumn('unit', 'Unit', 12), numberColumn('current_stock', 'Current stock', 'quantity'), numberColumn('min_stock', 'Reorder level', 'quantity'), dateColumn('expiry_date', 'Expiry date', 18), textColumn('stock_status', 'Status', 24)];
  if (showCost) productColumns.push(numberColumn('unit_cost', 'Unit cost', 'currency', 18), sumColumn('stock_value', 'Stock value', 'currency', 20));
  return createReportDefinition({
    key: 'stock-control', title: 'Stock Control', subtitle: 'Current stock position and filtered stock movements',
    propertyName, period: { from, to }, filters: { period: from || to ? `${from || 'All'} to ${to || 'Current'}` : 'Current stock', category, location }, generatedBy, summary,
    sections: [
      { name: 'stock-position', title: 'Current Stock Position', columns: productColumns, rows: productRows },
      { name: 'stock-movements', title: 'Stock Movements', columns: [dateTimeColumn('date', 'Date / time', 22), textColumn('product', 'Product', 28), textColumn('category', 'Category', 18), textColumn('location', 'Location', 20), textColumn('movement_type', 'Movement', 14), numberColumn('quantity', 'Quantity', 'quantity'), textColumn('unit', 'Unit', 12), textColumn('reason', 'Reason', 30), textColumn('source_document', 'Source document', 22), textColumn('recorded_by', 'Recorded by', 22)], rows: movementRows },
    ],
    notes: [showCost ? 'Cost/value columns are included because the current user role is permitted to view cost data.' : 'Cost/value columns are omitted because the current user role is not permitted to view cost data.'],
  });
}

export function buildFolioStatementDefinition({ selected = {}, charges = [], payments = [], employees = [], from, to, propertyName, generatedBy, totals = {} }) {
  const employeeName = (id) => employees.find((employee) => employee.user_id === id || employee.id === id)?.full_name || (id ? String(id).slice(0, 8) : 'System');
  const rows = [
    ...(charges || []).map((charge) => ({
      date: dateLabel(charge.created_at), type: charge.reversal_of_id ? 'Reversal' : 'Charge',
      description: cleanText(charge.description, cleanText(charge.category, 'Charge')),
      reference: cleanText(charge.reference, String(charge.id || '').slice(0, 8)),
      source: cleanText(charge.source_module || charge.source), quantity: toNumber(charge.quantity ?? 1),
      amount: toNumber(charge.amount), recorded_by: employeeName(charge.created_by), status: charge.reversal_of_id ? 'Reversal' : 'Posted',
    })),
    ...(payments || []).map((payment) => ({
      date: dateLabel(payment.created_at), type: toNumber(payment.amount) < 0 ? 'Refund' : 'Payment',
      description: cleanText(payment.method, 'Payment'), reference: cleanText(payment.reference, String(payment.id || '').slice(0, 8)),
      source: 'Cashier', quantity: 1, amount: toNumber(payment.amount), recorded_by: employeeName(payment.created_by), status: cleanText(payment.status),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return createReportDefinition({
    key: 'folio-statement', title: 'Guest Folio Statement',
    subtitle: `Reservation ${String(selected.id || '').slice(0, 8)} · Room ${cleanText(selected.room_id, '—')}`,
    propertyName, period: { from: from || '', to: to || '' }, filters: { reservation: String(selected.id || '').slice(0, 8) }, generatedBy,
    summary: [metric('Total charges', totals.chargeTotal, 'currency'), metric('Net payments', totals.netPayments, 'currency'), metric('Outstanding balance', totals.balance, 'currency')],
    sections: [{ name: 'folio-ledger', title: 'Ledger Activity', columns: [dateTimeColumn('date', 'Date / time', 22), textColumn('type', 'Type', 14), textColumn('description', 'Description', 30), textColumn('reference', 'Reference', 18), textColumn('source', 'Source', 16), sumColumn('quantity', 'Qty', 'quantity'), sumColumn('amount', 'Amount', 'currency', 18), textColumn('recorded_by', 'Recorded by', 22), textColumn('status', 'Status', 14)], rows }],
    notes: ['This statement contains only the selected reservation’s charges, payments and refunds. Do not distribute outside the authorized guest-account workflow.'],
  });
}


export function buildFinalSettlementInvoiceDefinition({
  selected = {}, room = {}, charges = [], payments = [], receipts = [], employees = [],
  propertyName, generatedBy, totals = {}, header = {},
}) {
  const employeeName = (id) => employees.find((employee) => employee.user_id === id || employee.id === id)?.full_name || (id ? String(id).slice(0, 8) : 'System');
  const arrival = cleanText(selected.arrival ?? selected.check_in ?? selected.checkIn);
  const departure = cleanText(selected.departure ?? selected.check_out ?? selected.checkOut);
  const roomLabel = cleanText(room.number ?? selected.room_number ?? header.roomNumber, cleanText(selected.room_id, '—'));
  const reservationRef = String(selected.id || '');
  const receiptRows = (receipts || []).map((receipt) => ({
    receipt_number: cleanText(receipt.receipt_number ?? receipt.order_number, String(receipt.id || '').slice(0, 8)),
    receipt_id: String(receipt.id || ''),
    order_number: cleanText(receipt.order_number, '—'),
    date: dateLabel(receipt.created_at),
    table: cleanText(receipt.table_number, '—'),
    payment_method: cleanText(receipt.payment_method, '—'),
    subtotal: toNumber(receipt.subtotal),
    discount: toNumber(receipt.discount_amount),
    tax: toNumber(receipt.vat),
    total: toNumber(receipt.total),
    folio_charge: cleanText(receipt.folio_charge_id, 'Not linked'),
  }));
  const itemRows = (receipts || []).flatMap((receipt) => (Array.isArray(receipt.items) ? receipt.items : []).map((item) => {
    const quantity = toNumber(item.qty ?? item.quantity ?? item.count ?? 1);
    const unitPrice = toNumber(item.unit_price ?? item.price ?? item.selling_price ?? 0);
    const lineTotal = toNumber(item.total ?? item.line_total ?? item.amount ?? unitPrice * quantity);
    const modifiers = Array.isArray(item.modifiers)
      ? item.modifiers.map((modifier) => typeof modifier === 'string' ? modifier : cleanText(modifier.name ?? modifier.label ?? modifier.value)).filter(Boolean).join(', ')
      : '';
    return {
      receipt_number: cleanText(receipt.receipt_number ?? receipt.order_number, String(receipt.id || '').slice(0, 8)),
      order_number: cleanText(receipt.order_number, '—'),
      date: dateLabel(receipt.created_at),
      item: cleanText(item.name ?? item.item_name ?? item.product_name, 'Unnamed item'),
      modifiers,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
    };
  }));
  const ledgerRows = [
    ...(charges || []).map((charge) => ({
      date: dateLabel(charge.created_at),
      type: charge.reversal_of_id ? 'Reversal' : 'Charge',
      description: cleanText(charge.description, cleanText(charge.category, 'Charge')),
      reference: cleanText(charge.reference, String(charge.id || '').slice(0, 8)),
      source: cleanText(charge.source_module || charge.source),
      quantity: toNumber(charge.quantity ?? 1),
      amount: toNumber(charge.amount),
      recorded_by: employeeName(charge.created_by),
      status: charge.reversal_of_id ? 'Reversal' : 'Posted',
    })),
    ...(payments || []).filter((payment) => payment.status === 'posted').map((payment) => ({
      date: dateLabel(payment.created_at),
      type: toNumber(payment.amount) < 0 ? 'Refund' : 'Payment',
      description: cleanText(payment.method, 'Payment'),
      reference: cleanText(payment.reference, String(payment.id || '').slice(0, 8)),
      source: payment.folio_charge_id ? 'Allocated cashier payment' : 'Cashier',
      quantity: 1,
      amount: toNumber(payment.amount),
      recorded_by: employeeName(payment.created_by),
      status: cleanText(payment.status),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const headerRows = [
    ['Invoice reference', header.invoiceReference],
    ['Bill to', header.billTo ?? selected.guest_name],
    ['Guest address', header.guestAddress],
    ['Guest phone', header.guestPhone ?? selected.phone],
    ['Guest email', header.guestEmail ?? selected.email],
    ['Guest tax PIN', header.guestTaxPin],
    ['Business address', header.businessAddress],
    ['Business phone', header.businessPhone],
    ['Business email', header.businessEmail],
    ['Business tax PIN', header.businessTaxPin],
    ['Room', roomLabel],
    ['Reservation', reservationRef],
    ['Check-in', arrival],
    ['Check-out', departure],
    ['Additional header details', header.headerNote],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([field, value]) => ({ field, value: String(value) }));
  const accommodation = (charges || []).filter((charge) => charge.category === 'accommodation' || charge.source === 'room').reduce((sum, charge) => sum + toNumber(charge.amount), 0);
  const posCharges = (charges || []).filter((charge) => charge.source === 'pos' || ['restaurant', 'bar', 'room_service'].includes(charge.category)).reduce((sum, charge) => sum + toNumber(charge.amount), 0);
  const posDiscounts = (receipts || []).reduce((sum, receipt) => sum + toNumber(receipt.discount_amount), 0);
  const posTax = (receipts || []).reduce((sum, receipt) => sum + toNumber(receipt.vat), 0);

  return createReportDefinition({
    key: 'folio-final-settlement-invoice',
    title: cleanText(header.invoiceTitle, 'Final Settlement Invoice'),
    subtitle: `Room ${roomLabel} · Stay ${arrival || '—'} to ${departure || '—'} · Reservation ${reservationRef.slice(0, 8)}`,
    propertyName: cleanText(header.businessName, propertyName || 'OliTechs'),
    period: { from: arrival, to: departure },
    filters: {
      reservation: reservationRef.slice(0, 8),
      room: roomLabel,
      stay: arrival && departure ? `${arrival} to ${departure}` : '',
      invoice_reference: cleanText(header.invoiceReference),
    },
    generatedBy,
    summary: [
      metric('Accommodation', accommodation, 'currency'),
      metric('POS charges on folio', posCharges, 'currency'),
      metric('POS receipt discounts', posDiscounts, 'currency'),
      metric('POS receipt VAT / tax', posTax, 'currency'),
      metric('Total charges', totals.chargeTotal, 'currency'),
      metric('Net payments received', totals.netPayments, 'currency'),
      metric('Final balance due', totals.balance, 'currency'),
      metric('POS receipts attached', receiptRows.length),
      metric('Consumed product lines', itemRows.length),
    ],
    sections: [
      {
        name: 'invoice-header',
        title: 'Invoice and Guest Details',
        columns: [textColumn('field', 'Field', 26), textColumn('value', 'Details', 58)],
        rows: headerRows,
      },
      {
        name: 'folio-ledger',
        title: 'Complete PMS Folio Ledger',
        columns: [dateTimeColumn('date', 'Date / time', 22), textColumn('type', 'Type', 14), textColumn('description', 'Description', 30), textColumn('reference', 'Transaction / receipt reference', 28), textColumn('source', 'Source', 20), numberColumn('quantity', 'Qty', 'quantity'), numberColumn('amount', 'Amount', 'currency', 18), textColumn('recorded_by', 'Recorded by', 22), textColumn('status', 'Status', 14)],
        rows: ledgerRows,
      },
      {
        name: 'pos-receipts',
        title: 'POS Receipts Posted to This Stay',
        columns: [textColumn('receipt_number', 'POS receipt no.', 20), textColumn('receipt_id', 'Receipt record ID', 34), textColumn('order_number', 'Order no.', 18), dateTimeColumn('date', 'Date / time', 22), textColumn('table', 'Table', 10), textColumn('payment_method', 'Tender', 14), numberColumn('subtotal', 'Subtotal', 'currency', 16), numberColumn('discount', 'Discount', 'currency', 16), numberColumn('tax', 'VAT / tax', 'currency', 16), numberColumn('total', 'Receipt total', 'currency', 16), textColumn('folio_charge', 'Linked folio charge', 34)],
        rows: receiptRows,
      },
      {
        name: 'pos-consumed-items',
        title: 'Consumed POS Products and Services',
        columns: [textColumn('receipt_number', 'POS receipt no.', 20), textColumn('order_number', 'Order no.', 18), dateTimeColumn('date', 'Date / time', 22), textColumn('item', 'Consumed product / service', 30), textColumn('modifiers', 'Modifiers / options', 26), numberColumn('quantity', 'Qty', 'quantity'), numberColumn('unit_price', 'Unit price', 'currency', 16), numberColumn('line_total', 'Line total', 'currency', 16)],
        rows: itemRows,
      },
    ],
    notes: [
      cleanText(header.footerNote, 'Thank you for staying with us.'),
      'This invoice is assembled from the selected reservation’s PMS folio, posted payments/refunds and linked POS receipts for the recorded room and stay dates.',
      'POS receipt and consumed-item sections provide source detail only. Their totals are already represented by linked folio charges and are not added a second time to the final balance.',
      'Only posted ledger entries are included in the final settlement calculation. Review the outstanding balance before accepting final payment.',
    ],
  });
}

export function buildPaymentReceiptDefinition({ selected = {}, payment = {}, propertyName, generatedBy }) {
  return createReportDefinition({
    key: 'guest-payment-receipt', title: 'Guest Payment Receipt',
    subtitle: 'This receipt reflects a transaction already saved in the guest ledger.',
    propertyName, generatedBy, filters: { document: 'Saved folio payment' },
    summary: [metric('Amount', Math.abs(toNumber(payment.amount)), 'currency')],
    sections: [{ name: 'payment-details', title: 'Payment Details', columns: [textColumn('field', 'Field', 28), textColumn('value', 'Value', 48)], rows: [
      { field: 'Guest', value: cleanText(selected.guest_name, 'Guest') },
      { field: 'Reservation', value: String(selected.id || '') },
      { field: 'Receipt reference', value: cleanText(payment.reference, String(payment.id || '')) },
      { field: 'Date', value: dateLabel(payment.created_at) },
      { field: 'Method', value: cleanText(payment.method) },
      { field: 'Transaction', value: toNumber(payment.amount) < 0 ? 'Refund' : 'Payment' },
      { field: 'Amount', value: `KES ${Math.abs(toNumber(payment.amount)).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
      { field: 'Status', value: cleanText(payment.status) },
    ] }],
    notes: ['Customer-specific financial document. Share only with the named guest or an authorized accounting recipient.'],
  });
}

export function buildRoomPlannerDefinition({ rooms = [], reservations = [], columns = [], propertyName, generatedBy }) {
  const roomMap = new Map((rooms || []).map((room) => [String(room.id), room]));
  const allActiveReservations = (reservations || []).filter((reservation) => !['cancelled', 'canceled'].includes(String(reservation.status || reservation.bookingStatus || '').toLowerCase()));
  const days = (columns || []).map((day) => {
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    const date = day instanceof Date ? day : new Date(day);
    return Number.isNaN(date.getTime()) ? String(day) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const from = days[0] || '';
  const to = days[days.length - 1] || '';
  const activeReservations = allActiveReservations.filter((reservation) => {
    const arrival = String(reservation.checkIn ?? reservation.arrival ?? '').slice(0, 10);
    const departure = String(reservation.checkOut ?? reservation.departure ?? '').slice(0, 10);
    return Boolean(arrival && departure && from && to) && arrival <= to && departure > from;
  });
  const scheduleRows = activeReservations.map((reservation) => {
    const room = roomMap.get(String(reservation.roomId || reservation.room_id));
    return {
      room: cleanText(room?.number ?? reservation.roomNumber, 'Unassigned'),
      room_type: cleanText(room?.roomTypeName ?? room?.room_type, 'Unassigned'),
      guest: cleanText(reservation.guestName ?? reservation.guest_name, 'Guest'),
      arrival: cleanText(reservation.checkIn ?? reservation.arrival),
      departure: cleanText(reservation.checkOut ?? reservation.departure),
      status: cleanText(reservation.bookingStatus ?? reservation.status, 'booked'),
      payment_status: cleanText(reservation.paymentStatus, 'not_paid'),
      channel: cleanText(reservation.channel, 'direct'),
      party: `${toNumber(reservation.adults || 1)} adults${toNumber(reservation.kidsCount) ? `, ${toNumber(reservation.kidsCount)} children` : ''}`,
      total_amount: toNumber(reservation.totalAmount ?? reservation.total ?? reservation.rate),
      room_id: String(reservation.roomId || reservation.room_id || ''),
      check_in: cleanText(reservation.checkIn ?? reservation.arrival),
      check_out: cleanText(reservation.checkOut ?? reservation.departure),
    };
  }).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }) || a.arrival.localeCompare(b.arrival));
  const matrixRows = (rooms || []).map((room) => {
    const row = { room: cleanText(room.number, 'Unassigned'), room_type: cleanText(room.roomTypeName ?? room.room_type, 'Unassigned') };
    days.forEach((day) => {
      const reservation = activeReservations.find((candidate) => String(candidate.roomId || candidate.room_id) === String(room.id)
        && String(candidate.checkIn ?? candidate.arrival ?? '').slice(0, 10) <= day
        && String(candidate.checkOut ?? candidate.departure ?? '').slice(0, 10) > day);
      row[day] = reservation ? `${cleanText(reservation.guestName ?? reservation.guest_name, 'Occupied')} · ${cleanText(reservation.bookingStatus ?? reservation.status, 'booked')}` : '';
    });
    return row;
  });
  const scheduleColumns = [
    textColumn('room', 'Room', 12), textColumn('room_type', 'Room type', 20), textColumn('guest', 'Guest', 28),
    dateColumn('arrival', 'Arrival', 16), dateColumn('departure', 'Departure', 16), textColumn('status', 'Status', 16),
    textColumn('payment_status', 'Payment status', 20), textColumn('channel', 'Channel', 16), textColumn('party', 'Party', 18),
    sumColumn('total_amount', 'Booking total', 'currency', 20),
  ];
  const matrixColumns = [textColumn('room', 'Room', 12), textColumn('room_type', 'Room type', 20), ...days.map((day) => textColumn(day, day, 22))];
  return createReportDefinition({
    key: 'room-planner-schedule', title: 'Room Planner Schedule',
    subtitle: 'Reservation schedule and daily room matrix generated from the active planner data',
    propertyName, period: { from, to }, filters: { period: `${from || 'Current'} to ${to || 'Current'}`, status: 'Active reservations' }, generatedBy,
    summary: [metric('Active reservations', scheduleRows.length), metric('Rooms', rooms.length)],
    sections: [
      { name: 'reservation-schedule', title: 'Reservation Schedule', columns: scheduleColumns, rows: scheduleRows },
      { name: 'daily-room-matrix', title: 'Daily Room Matrix', columns: matrixColumns, rows: matrixRows, pdf: false },
    ],
    notes: ['Only guest name, room, stay dates, booking status, payment status, channel, party size and booking total are included. Guest phone, email, ID, address and booking notes are excluded.'],
  });
}

export function buildShiftReportDefinition(report, { propertyName, generatedBy } = {}) {
  const shift = report?.shift || {};
  const money = toNumber;
  const orders = report?.orders || [];
  const totalSales = money(report?.totalSales);
  const paymentRows = Object.entries(report?.payments || {}).map(([method, value]) => {
    const netAmount = money(value.amount);
    return { method, transactions: money(value.count), gross_amount: money(report?.grossPayments?.[method]?.amount), refunds: money(report?.refundsByMethod?.[method]), net_amount: netAmount, share_percent: totalSales ? netAmount / totalSales : 0 };
  });
  const receiptRows = orders.map((receipt) => ({
    receipt: cleanText(receipt.order_number), table: cleanText(receipt.table_number), waiter: cleanText(receipt.waiter),
    time: dateLabel(receipt.created_at), items: (Array.isArray(receipt.items) ? receipt.items : []).map((item) => `${cleanText(item.name ?? item.item_name, 'Item')} × ${toNumber(item.qty ?? item.quantity ?? 1)}`).join(', '),
    payment_method: cleanText(receipt.payment_method).toLowerCase() === 'split' ? 'Split Payment' : cleanText(receipt.payment_method).replaceAll('_', ' '), amount: money(receipt.total), guest: cleanText(receipt.guest_name), covers: toNumber(receipt.covers || 1),
  }));
  const summaryRows = [
    { metric: 'Opening cash', amount: money(shift.opening_cash), count: 1 },
    ...paymentRows.map((row) => ({ metric: row.method, amount: row.net_amount, count: row.transactions })),
    { metric: 'Gross sales', amount: money(report?.grossSales), count: toNumber(report?.totalTransactions) },
    { metric: 'Refunds', amount: money(report?.refundsTotal), count: '' },
    { metric: 'Voided value', amount: money(report?.voidedValue), count: '' },
    { metric: 'Net sales', amount: money(report?.totalSales), count: toNumber(report?.totalTransactions) },
    { metric: 'Guest covers', amount: money(report?.totalCovers), count: '' },
    { metric: 'Items sold', amount: money(report?.itemsSold), count: '' },
    { metric: 'Expected cash', amount: money(report?.expectedCash), count: '' },
    { metric: 'Counted cash', amount: report?.countedCash == null ? '' : money(report.countedCash), count: '' },
    { metric: 'Variance', amount: report?.variance == null ? '' : money(report.variance), count: '' },
  ];
  return createReportDefinition({
    key: 'shift-report', title: `Shift Report ${cleanText(shift.shift_no)}`,
    subtitle: 'Shift close report · existing thermal print actions remain separate',
    propertyName, period: { from: cleanText(shift.date), to: cleanText(shift.date) }, filters: { shift: cleanText(shift.shift_no), status: cleanText(shift.status) }, generatedBy,
    summary: summaryRows.map((row) => metric(row.metric, row.amount, 'currency')),
    sections: [
      { name: 'shift-summary', title: 'Shift Summary', columns: [textColumn('metric', 'Metric', 28), sumColumn('amount', 'Amount', 'currency', 18), sumColumn('count', 'Count')], rows: summaryRows },
      { name: 'detailed-receipts', title: 'Detailed Receipts', columns: [textColumn('receipt', 'Receipt', 18), textColumn('table', 'Table', 12), textColumn('waiter', 'Waiter', 18), dateTimeColumn('time', 'Time', 22), textColumn('items', 'Items', 40), textColumn('payment_method', 'Payment method', 18), sumColumn('amount', 'Amount', 'currency', 18), textColumn('guest', 'Guest', 24), sumColumn('covers', 'Covers')], rows: receiptRows },
      { name: 'voided-receipts', title: 'Voided Receipts', columns: [textColumn('receipt', 'Receipt', 18), textColumn('table', 'Table', 14), dateTimeColumn('time', 'Time', 22), sumColumn('amount', 'Voided value', 'currency', 20)], rows: (report?.voidedOrders || []).map((receipt) => ({ receipt: cleanText(receipt.order_number), table: cleanText(receipt.table_number), time: dateLabel(receipt.created_at), amount: money(receipt.total) })) },
      { name: 'payment-breakdown', title: 'Payment Breakdown', columns: [textColumn('method', 'Payment method', 22), sumColumn('transactions', 'Transactions'), sumColumn('gross_amount', 'Gross', 'currency', 18), sumColumn('refunds', 'Refunds', 'currency', 18), sumColumn('net_amount', 'Net', 'currency', 18), { key: 'share_percent', label: '% of Net Sales', type: 'number', format: 'percent', width: 16, align: 'right' }], rows: paymentRows },
      { name: 'refund-details', title: 'Refund Details', columns: [textColumn('receipt', 'Receipt', 24), textColumn('method', 'Settlement method', 22), sumColumn('amount', 'Refund amount', 'currency', 20)], rows: (report?.refunds || []).map((refund) => { const receipt = orders.find((item) => item.id === refund.receipt_id); return { receipt: cleanText(receipt?.order_number || refund.receipt_id), method: cleanText(refund.settlement_method || refund.method), amount: money(refund.amount) }; }) },
      { name: 'items-sold', title: 'Items Sold by Category', columns: [textColumn('category', 'Category', 22), sumColumn('quantity', 'Quantity', 'quantity'), sumColumn('gross_sales', 'Gross sales', 'currency', 20)], rows: [
        { category: 'Food', quantity: money(report?.categories?.food?.qty), gross_sales: money(report?.categories?.food?.amount) },
        { category: 'Drinks', quantity: money(report?.categories?.drinks?.qty), gross_sales: money(report?.categories?.drinks?.amount) },
        { category: 'All Items', quantity: money(report?.itemsSold), gross_sales: money(report?.grossSales) },
      ] },
    ],
    notes: ['The document includes internal shift financial and transaction information. Apply existing Shift Reports access restrictions. Thermal Re-print and Print & Close Shift are not affected.'],
  });
}


export function buildManagementReportDefinition({ report = {}, sales = {}, from, to, propertyName, generatedBy }) {
  const hotel = report?.hotel || {};
  const inventory = report?.inventory || {};
  const cashier = report?.cashier || {};
  const salesKpis = report?.sales || {};
  const valueColumn = { key: 'value', label: 'Value', type: 'number', format: 'number', width: 18, align: 'right' };
  const moneyValueColumn = { ...valueColumn, format: 'currency', width: 22 };
  const summary = [
    metric('Room revenue', hotel.room_revenue, 'currency'),
    metric('POS net sales', salesKpis.pos_net, 'currency'),
    metric('Inventory valuation', inventory.valuation, 'currency'),
    metric('Open shifts', cashier.open_shifts),
    metric('Closed shifts', cashier.closed_shifts),
  ];
  return createReportDefinition({
    key: 'management-report', title: 'Management Report',
    subtitle: 'PMS, POS, cashier and inventory KPIs from the selected Kenya business-date range',
    propertyName, period: { from, to }, filters: { period: `${from} to ${to}`, scope: 'All management sections' }, generatedBy, summary,
    sections: [
      { name: 'hotel-kpis', title: 'Hotel KPIs', columns: [textColumn('metric', 'Metric', 30), valueColumn], rows: [
        ['Sellable rooms', hotel.sellable_rooms], ['Available room nights', hotel.available_room_nights], ['Occupied room nights', hotel.occupied_room_nights],
        ['Occupancy percent', hotel.occupancy_percent], ['Room revenue', hotel.room_revenue], ['ADR', hotel.adr], ['RevPAR', hotel.revpar],
        ['Arrivals', hotel.arrivals], ['Departures', hotel.departures], ['Reservations', hotel.reservations],
      ].map(([label, value]) => ({ metric: label, value: toNumber(value) })) },
      { name: 'sales-kpis', title: 'POS Sales KPIs', columns: [textColumn('metric', 'Metric', 30), moneyValueColumn], rows: [
        ['POS gross', salesKpis.pos_gross], ['POS tax', salesKpis.pos_tax], ['Discounts', salesKpis.discounts],
        ['Refunds', salesKpis.refunds], ['Voids', salesKpis.voids], ['POS net', salesKpis.pos_net],
      ].map(([label, value]) => ({ metric: label, value: toNumber(value) })) },
      { name: 'sales-by-department', title: 'Sales by Department', columns: [textColumn('department', 'Department', 28), sumColumn('qty', 'Quantity', 'quantity'), sumColumn('revenue', 'Revenue', 'currency', 22)], rows: (sales.departments || []).map((row) => ({ department: cleanText(row.department, 'Unassigned'), qty: toNumber(row.qty), revenue: toNumber(row.revenue) })) },
      { name: 'payment-methods', title: 'Payment Methods', columns: [textColumn('method', 'Payment type', 28), sumColumn('transactions', 'Transactions'), sumColumn('amount', 'Amount', 'currency', 22)], rows: (sales.payments || []).map((row) => ({ method: cleanText(row.method, 'Unspecified'), transactions: toNumber(row.transactions), amount: toNumber(row.amount) })) },
      { name: 'inventory-kpis', title: 'Inventory KPIs', columns: [textColumn('metric', 'Metric', 30), valueColumn], rows: [
        ['Valuation', inventory.valuation], ['Purchases', inventory.purchases], ['Consumption quantity', inventory.consumption_qty],
        ['Wastage quantity', inventory.wastage_qty], ['Stock movements', inventory.stock_movements], ['Transfer orders', inventory.transfer_orders],
      ].map(([label, value]) => ({ metric: label, value: toNumber(value) })) },
      { name: 'cashier-controls', title: 'Cashier Controls', columns: [textColumn('metric', 'Metric', 30), valueColumn], rows: [
        ['Open shifts', cashier.open_shifts], ['Closed shifts', cashier.closed_shifts], ['Cash variance', cashier.cash_variance],
      ].map(([label, value]) => ({ metric: label, value: toNumber(value) })) },
    ],
    notes: ['Values are limited to the live management and sales-detail RPC results for the active property. This report does not expand beyond the source queries.'],
  });
}
