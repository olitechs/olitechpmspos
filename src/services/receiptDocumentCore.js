const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstPresent = (...values) => values.find((value) => value !== null && value !== undefined && value !== '');

function normalizeReceiptItem(item = {}, index = 0) {
  const quantity = number(firstPresent(item.qty, item.quantity, item.count), 1);
  const unitPrice = number(firstPresent(item.unit_price, item.price, item.selling_price), 0);
  const explicitTotal = firstPresent(item.total, item.line_total, item.amount);
  const lineTotal = explicitTotal === undefined ? unitPrice * quantity : number(explicitTotal, 0);
  const department = text(firstPresent(item.department, item.production_center, item.category)) || 'Unassigned';
  const category = text(firstPresent(item.category, item.pos_category, item.department, item.production_center)) || 'Uncategorized';
  const modifiers = Array.isArray(item.modifiers)
    ? item.modifiers.map((modifier) => typeof modifier === 'string'
      ? text(modifier)
      : text(firstPresent(modifier?.name, modifier?.label, modifier?.value))).filter(Boolean)
    : [];

  return {
    id: text(firstPresent(item.order_line_id, item.id, item.product_id, item.sku)) || `line-${index + 1}`,
    productId: text(firstPresent(item.product_id, item.productId)) || null,
    sku: text(firstPresent(item.sku, item.product_sku)) || null,
    name: text(firstPresent(item.name, item.item_name, item.product_name)) || 'Unnamed item',
    quantity,
    unitPrice,
    lineTotal,
    category,
    department,
    modifiers,
    raw: item,
  };
}

/**
 * Build the shared, read-only receipt document model.
 *
 * This deliberately does not synthesize historical company settings, receipt
 * numbers, or FOOD/DRINKS classifications. Those values must come from an
 * issuance-time snapshot or explicit item metadata.
 */
export function buildReceiptDocument(receipt = {}, { paymentAllocations = receipt.pos_receipt_payments ?? receipt.payment_allocations ?? [] } = {}) {
  const rawItems = Array.isArray(receipt.items) ? receipt.items : [];
  const items = rawItems.map(normalizeReceiptItem);
  const grouped = new Map();

  for (const item of items) {
    const rows = grouped.get(item.department) || [];
    rows.push(item);
    grouped.set(item.department, rows);
  }

  const allocations = Array.isArray(paymentAllocations)
    ? paymentAllocations.map((payment) => ({
      id: text(payment.id) || null,
      method: text(firstPresent(payment.payment_method, payment.method)) || 'Unspecified',
      amount: number(payment.amount),
      reservationId: text(payment.reservation_id) || null,
      folioChargeId: text(payment.folio_charge_id) || null,
      createdAt: payment.created_at || null,
    }))
    : [];

  const paymentMethod = text(receipt.payment_method) || 'Unspecified';
  const hasSplitAllocations = paymentMethod.toLowerCase() === 'split' && allocations.length > 0;
  const effectiveAllocations = hasSplitAllocations
    ? allocations
    : paymentMethod.toLowerCase() === 'split'
      ? []
      : [{
        id: null,
        method: paymentMethod,
        amount: number(receipt.total),
        reservationId: text(receipt.reservation_id) || null,
        folioChargeId: text(receipt.folio_charge_id) || null,
        createdAt: receipt.created_at || null,
      }];

  const storedReceiptNumber = text(receipt.receipt_number) || null;
  const receiptId = text(receipt.id) || null;
  const orderNumber = text(receipt.order_number) || null;
  const receiptSnapshot = receipt.receipt_document_snapshot
    ?? receipt.document_snapshot
    ?? receipt.receipt_snapshot
    ?? null;

  return {
    id: receiptId,
    propertyId: text(receipt.property_id) || null,
    receiptNumber: storedReceiptNumber,
    receiptNumberStatus: storedReceiptNumber ? 'assigned' : 'missing',
    displayReference: storedReceiptNumber || orderNumber || (receiptId ? receiptId.slice(0, 8) : 'Unnumbered receipt'),
    orderNumber,
    createdAt: receipt.created_at || null,
    businessDate: receipt.business_date || null,
    createdBy: text(receipt.created_by) || null,
    waiter: text(receipt.waiter) || null,
    tableNumber: text(receipt.table_number) || null,
    covers: receipt.covers === null || receipt.covers === undefined ? null : number(receipt.covers),
    diningOption: text(firstPresent(receipt.dining_option, receipt.dining_type)) || null,
    guestName: text(receipt.guest_name) || null,
    roomNumber: text(receipt.room_number) || null,
    reservationId: text(receipt.reservation_id) || null,
    folioChargeId: text(receipt.folio_charge_id) || null,
    status: text(firstPresent(receipt.receipt_status, receipt.status)) || 'unknown',
    receiptSnapshot,
    snapshotStatus: receiptSnapshot ? 'captured' : 'not-captured-or-legacy',
    items,
    groups: [...grouped.entries()].map(([department, rows]) => ({
      department,
      items: rows,
      quantity: rows.reduce((sum, item) => sum + item.quantity, 0),
      itemLineTotal: rows.reduce((sum, item) => sum + item.lineTotal, 0),
    })),
    paymentMethod,
    paymentAllocations: effectiveAllocations,
    totals: {
      subtotal: number(receipt.subtotal),
      discountAmount: number(receipt.discount_amount),
      vat: number(receipt.vat),
      total: number(receipt.total),
      itemLineTotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    },
    // Receipt-level discounts and VAT are not silently spread across item lines.
    receiptAdjustmentsAllocatedToItems: false,
  };
}


const COMPANY_SNAPSHOT_FIELDS = [
  'property_name', 'logo_url', 'address_line1', 'address_line2', 'phone',
  'email', 'website', 'kra_pin', 'extra_header_line', 'footer_line1', 'footer_line2',
];

/**
 * Resolve the canonical receipt record for UI and print surfaces.
 * Snapshot company settings win when present; legacy records deliberately
 * fall back to current settings only for presentation, and remain labelled legacy.
 */
export function resolveReceiptDocumentPresentation(receipt = {}) {
  const snapshot = receipt.receipt_document_snapshot
    ?? receipt.document_snapshot
    ?? receipt.receipt_snapshot
    ?? null;
  const snapshotReceipt = snapshot?.receipt && typeof snapshot.receipt === 'object'
    ? snapshot.receipt
    : {};
  const source = { ...receipt, ...snapshotReceipt, receipt_document_snapshot: snapshot };
  const document = buildReceiptDocument(source, {
    paymentAllocations: snapshot?.payment_allocations
      ?? receipt.pos_receipt_payments
      ?? receipt.payment_allocations
      ?? [],
  });
  const company = snapshot?.company && typeof snapshot.company === 'object'
    ? snapshot.company
    : null;
  const settings = company
    ? Object.fromEntries(COMPANY_SNAPSHOT_FIELDS.map((field) => [field, company[field] ?? '']))
    : {};

  return {
    document,
    settings,
    data: {
      receiptNumber: document.receiptNumber,
      orderNumber: document.orderNumber,
      checkNo: document.orderNumber,
      table: document.tableNumber ? 'Table ' + document.tableNumber : '—',
      waiter: document.waiter || 'Unassigned',
      covers: document.covers,
      diningOption: document.diningOption,
      guestName: document.guestName,
      room: document.roomNumber,
      items: source.items || [],
      subtotal: document.totals.subtotal,
      discount: document.totals.discountAmount,
      discountName: source.discount_name || '',
      vat: document.totals.vat,
      total: document.totals.total,
      paymentMethod: document.paymentMethod,
      paymentAllocations: document.paymentAllocations,
      createdAt: document.createdAt,
      receiptStatus: document.status,
      snapshotStatus: document.snapshotStatus,
    },
  };
}
