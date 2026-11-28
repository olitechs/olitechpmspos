import { buildEscPosPayload } from './escposJob.js';
import { getPrintColor } from '../utils/printTheme.js';
export { finishPrintJob } from './escposJob.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function getPrinterColumns(printer = {}) {
  // Leave a physical side margin on both paper sizes. Configured widths may
  // narrow the layout, but must never exceed the safe printable area.
  const paperLimit = String(printer.paper_width || '80mm').toLowerCase() === '58mm' ? 30 : 46;
  const override = Number(printer.character_width ?? printer.characters_per_line);
  if (Number.isInteger(override) && override >= 24) return Math.min(override, paperLimit);
  return paperLimit;
}

export function getOrderTicketColumns(printer = {}) {
  // Production tickets use a conservative safe width to avoid clipped thermal lines.
  const paperLimit = String(printer.paper_width || '80mm').toLowerCase() === '58mm' ? 30 : 42;
  const override = Number(printer.character_width ?? printer.characters_per_line);
  if (Number.isInteger(override) && override >= 24 && override <= paperLimit) return override;
  return paperLimit;
}

export function wrapThermalText(value, width = 48) {
  const limit = Math.max(8, Number(width) || 48);
  const words = String(value ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const rows = [];
  let row = '';
  for (const word of words) {
    if (word.length > limit) {
      if (row) rows.push(row);
      row = '';
      for (let index = 0; index < word.length; index += limit) rows.push(word.slice(index, index + limit));
      continue;
    }
    if (!row) row = word;
    else if ((row + ' ' + word).length <= limit) row += ' ' + word;
    else { rows.push(row); row = word; }
  }
  if (row) rows.push(row);
  return rows.length ? rows : [''];
}

function centerRows(value, width) {
  return wrapThermalText(value, width).map(row => row.padStart(Math.floor((width + row.length) / 2)).padEnd(width));
}

function centeredBlock(values, width) {
  return values.filter(value => value != null && String(value).trim() !== '')
    .flatMap(value => centerRows(value, width));
}

function labeledRows(label, value, width) {
  const prefix = String(label || '') + ': ';
  const available = Math.max(8, width - prefix.length);
  const rows = wrapThermalText(value == null || value === '' ? '—' : value, available);
  return rows.map((row, index) => (index === 0 ? prefix : ' '.repeat(prefix.length)) + row);
}

function divider(width) {
  return '-'.repeat(width);
}

function pairLine(label, value, width) {
  const left = String(label || '');
  const right = String(value ?? '');
  if (left.length + right.length + 1 <= width) {
    return left + ' '.repeat(width - left.length - right.length) + right;
  }
  const leftRows = wrapThermalText(left, width);
  const rightRows = wrapThermalText(right, width);
  return [...leftRows, ...rightRows.map(row => row.padStart(width))].join('\n');
}

function stamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

function modifierLabel(modifier) {
  if (typeof modifier === 'string') return modifier;
  return modifier?.name || modifier?.label || modifier?.option_name || '';
}

function itemQuantity(item) {
  return Number(item?.qty ?? item?.quantity ?? 1) || 1;
}

function itemName(item) {
  return item?.name || item?.item_name || item?.product_name || 'Item';
}

function emphasize(value) {
  return '\x1BE\x01' + value + '\x1BE\x00';
}

export function getUnsentOrderLines(currentLines = [], previouslySentLines = []) {
  const keyFor = line => {
    const identity = line?.id ?? line?.productId ?? line?.product_id ?? line?.menu_item_id ?? itemName(line);
    const modifiers = (Array.isArray(line?.modifiers) ? line.modifiers : [])
      .map(modifierLabel).filter(Boolean).sort().join('|');
    return String(identity) + '::' + modifiers;
  };
  const sentQuantities = new Map();
  for (const line of Array.isArray(previouslySentLines) ? previouslySentLines : []) {
    const key = keyFor(line);
    sentQuantities.set(key, (sentQuantities.get(key) || 0) + itemQuantity(line));
  }
  // Consume sent quantities as rows are traversed. Merged/re-hydrated
  // sessions may contain duplicate keys; each row must not subtract the same
  // previously fired quantity independently.
  return (Array.isArray(currentLines) ? currentLines : []).flatMap(line => {
    const key = keyFor(line);
    const alreadySent = sentQuantities.get(key) || 0;
    const currentQuantity = itemQuantity(line);
    const consumed = Math.min(currentQuantity, alreadySent);
    sentQuantities.set(key, Math.max(0, alreadySent - consumed));
    const quantity = Math.max(0, currentQuantity - consumed);
    return quantity > 0 ? [{ ...line, qty: quantity }] : [];
  });
}

export function buildOrderTicketText(order = {}, { printer = {}, settings = {}, center = 'KITCHEN', items = order.items || [], now = new Date() } = {}) {
  const safe = value => toReceiptAscii(value);
  const width = getOrderTicketColumns(printer);
  const productionCenter = safe(center || 'KITCHEN').toUpperCase();
  const orderNo = safe(order.ticketNumber || order.ticket_number || order.orderNumber || order.checkNo || order.order_number || order.id || '—');
  const displayOrderNo = orderNo.startsWith('#') ? orderNo : '#' + orderNo;
  const orderName = safe(order.orderName || order.order_name || order.customerName || order.customer_name || order.guestName || order.guest_name || order.name || order.table || order.tableNumber || order.orderNumber || '—');
  const employee = safe(order.employeeName || order.employee_name || order.employee || order.staffName || order.staff_name || order.createdByName || order.created_by_name || order.waiter || order.server || '—');
  const posName = safe(order.posName || order.pos_name || order.posNumber || order.pos_number || order.terminalName || order.terminal_name || order.terminal || order.deviceName || order.device_name || order.pos || 'POS');
  const dining = safe(order.diningOption || order.dining_option || order.orderType || order.order_type || '—').toUpperCase();
  const lines = [
    ...centerRows('*** ' + productionCenter + ' POS ***', width).map(emphasize),
    '',
    ...centerRows(displayOrderNo, width).map(receiptDoubleHeight),
    ...centerRows(orderName, width).map(receiptDoubleHeight),
    '',
    ...wrapThermalText(stamp(order.createdAt || order.created_at || now), width),
    ...wrapThermalText('Employee: ' + employee, width),
    ...wrapThermalText('POS: ' + posName, width),
    divider(width),
    ...centerRows(dining, width).map(emphasize),
    divider(width),
  ];

  for (const item of (Array.isArray(items) ? items : [])) {
    const qty = itemQuantity(item);
    const name = safe(itemName(item));
    lines.push(...wrapThermalText(qty + ' x ' + name, width));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifier => safe(modifierLabel(modifier))).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = safe(item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note || '');
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    lines.push('');
  }

  lines.push(divider(width));
  return lines.join('\n');
}
function toReceiptAscii(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundReceiptMoney(value) {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function formatReceiptMoney(value, currency = 'KES') {
  return toReceiptAscii(currency || 'KES') + ' ' + roundReceiptMoney(value).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function nairobiPrintedAt(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return get('day') + ' ' + get('month') + ' ' + get('year') + ', ' + get('hour') + ':' + get('minute');
}

function receiptCenterRows(value, width) {
  return wrapThermalText(toReceiptAscii(value), width).map(row =>
    row.padStart(Math.floor((width + row.length) / 2))
  );
}

function receiptLeftRows(label, value, width) {
  if (value == null || String(value).trim() === '') return [];
  const prefix = String(label) + ': ';
  return wrapThermalText(toReceiptAscii(value), Math.max(4, width - prefix.length))
    .map((row, index) => (index === 0 ? prefix : ' '.repeat(prefix.length)) + row);
}

function receiptPairLine(label, amount, width) {
  const left = toReceiptAscii(label);
  const right = toReceiptAscii(amount);
  if (right.length >= width - 2 || left.length + right.length + 1 > width) {
    return [left, right.padStart(width)].filter(Boolean);
  }
  return [left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right];
}

function receiptDoubleHeight(value) {
  return '\x1D\x21\x01' + emphasize(value) + '\x1D\x21\x00';
}

function getUnsettledReceiptWidth(settings = {}, printer = {}) {
  const paper = String(printer.paper_width || settings.unsettled_receipt_paper_width || '80mm').toLowerCase();
  return paper === '58mm' ? 30 : 46;
}

function resolveUnsettledVat(settings = {}, data = {}, subtotal = 0) {
  const snapshot = data.vatSnapshot || data.vat_snapshot || data.receiptVatSnapshot || data.receipt_vat_snapshot || null;
  const enabled = snapshot
    ? snapshot.enabled === true || snapshot.showVat === true || snapshot.show_vat === true
    : settings.unsettled_receipt_show_vat === true;
  const rateValue = snapshot?.rate ?? snapshot?.vatRate ?? snapshot?.vat_rate ?? settings.unsettled_receipt_vat_rate ?? 16;
  const rate = Math.max(0, Math.min(100, Number(rateValue) || 0));
  const modeValue = snapshot?.mode ?? snapshot?.vatMode ?? snapshot?.vat_mode ?? settings.unsettled_receipt_vat_mode ?? 'exclusive';
  const mode = String(modeValue).toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive';
  const discount = roundReceiptMoney(Math.max(0, Number(snapshot?.discount ?? data.discount ?? 0)));
  const taxableSubtotal = roundReceiptMoney(Math.max(0, Number(snapshot?.taxableSubtotal ?? snapshot?.taxable_subtotal ?? subtotal - discount)));
  if (!enabled || rate <= 0) return { enabled: false, rate, mode, discount, taxableSubtotal, vat: 0, amountDue: taxableSubtotal };
  const vat = roundReceiptMoney(Number(snapshot?.vat ?? (mode === 'inclusive'
    ? taxableSubtotal * rate / (100 + rate)
    : taxableSubtotal * rate / 100)));
  const amountDue = roundReceiptMoney(Number(snapshot?.total ?? snapshot?.amountDue ?? snapshot?.amount_due ?? (mode === 'inclusive'
    ? taxableSubtotal
    : taxableSubtotal + vat)));
  return { enabled: true, rate, mode, discount, taxableSubtotal, vat, amountDue };
}

export function buildUnsettledReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getUnsettledReceiptWidth(settings, printer);
  const currency = data.currency || 'KES';
  const items = Array.isArray(data.items) ? data.items : [];
  const normalizedItems = items.map(item => {
    const qty = itemQuantity(item);
    const unitPrice = Number(item?.price ?? item?.unitPrice ?? item?.unit_price ?? 0);
    return { item, qty, unitPrice, lineTotal: roundReceiptMoney(qty * unitPrice) };
  });
  const subtotal = roundReceiptMoney(normalizedItems.reduce((sum, row) => sum + row.lineTotal, 0));
  const vat = resolveUnsettledVat(settings, data, subtotal);
  const orderName = data.orderName || data.order_name || data.customerName || data.customer_name || data.guestName || data.guest_name || data.name || data.orderNumber || data.checkNo || '—';
  const employee = data.employeeName || data.employee_name || data.employee || data.staffName || data.staff_name || data.waiter || data.server || '—';
  const posName = data.posName || data.pos_name || data.posNumber || data.pos_number || data.terminalName || data.terminal_name || data.terminal || data.deviceName || data.device_name || data.pos || 'POS';
  const dining = data.diningOption || data.dining_option || data.orderType || data.order_type || '';
  const header = centeredBlock([
    settings.property_name || data.propertyName || 'VISIWA BEACH RESORT',
    settings.address_line1,
    settings.address_line2,
    settings.phone,
    settings.email,
    settings.website,
    settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '',
  ].map(value => toReceiptAscii(value)), width);
  const lines = [
    ...header,
    divider(width),
    ...receiptCenterRows('UNSETTLED BILL', width).map(receiptDoubleHeight),
    ...receiptCenterRows('PAYMENT PENDING', width),
    ...receiptLeftRows('Order', orderName, width),
    ...receiptLeftRows('Employee', employee, width),
    ...receiptLeftRows('POS', posName, width),
    ...(data.table ? receiptLeftRows('Table', data.table, width) : []),
    ...(data.covers !== null && data.covers !== undefined ? receiptLeftRows('Covers', data.covers, width) : []),
    ...(data.guestName ? receiptLeftRows('Guest', data.guestName, width) : []),
    ...(data.room ? receiptLeftRows('Room', data.room, width) : []),
    divider(width),
  ];
  if (dining) lines.push(...receiptCenterRows(dining, width).map(emphasize), divider(width));

  for (const { item, qty, unitPrice, lineTotal } of normalizedItems) {
    const name = toReceiptAscii(itemName(item));
    const amount = formatReceiptMoney(lineTotal, currency);
    const available = Math.max(8, width - amount.length - 1);
    if (name.length <= available) lines.push(name.padEnd(available) + ' ' + amount);
    else {
      lines.push(...wrapThermalText(name, width));
      lines.push(amount.padStart(width));
    }
    lines.push(...wrapThermalText(qty + ' x ' + formatReceiptMoney(unitPrice, currency), width));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + toReceiptAscii(modifier), width));
  }

  lines.push(divider(width));
  if (vat.enabled) {
    lines.push(...receiptPairLine('Subtotal', formatReceiptMoney(subtotal, currency), width));
    if (vat.discount > 0) lines.push(...receiptPairLine('Discount', '-' + formatReceiptMoney(vat.discount, currency), width));
    const vatLabel = vat.mode === 'inclusive' ? 'VAT included (' + vat.rate + '%)' : 'VAT (' + vat.rate + '%)';
    lines.push(...receiptPairLine(vatLabel, formatReceiptMoney(vat.vat, currency), width));
  } else if (vat.discount > 0) {
    lines.push(...receiptPairLine('Discount', '-' + formatReceiptMoney(vat.discount, currency), width));
  }
  lines.push('='.repeat(width));
  lines.push(receiptDoubleHeight(receiptPairLine('AMOUNT DUE', formatReceiptMoney(vat.amountDue, currency), width)[0]));
  lines.push('='.repeat(width));
  lines.push(...receiptCenterRows('Please settle at the cashier', width));
  lines.push(...receiptCenterRows('Not a tax invoice / Not a paid receipt', width));
  const checkNo = data.checkNo || data.check_no || data.orderNumber || data.order_number || '';
  if (checkNo) lines.push(...receiptCenterRows('Check: ' + toReceiptAscii(checkNo), width).map(emphasize));
  const printedAt = nairobiPrintedAt(now);
  if (printedAt) lines.push(...receiptCenterRows(printedAt, width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2, copyLabel], width));
  return lines.join('\n');
}
export function buildFinalReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const currency = data.currency || 'KES';
  const money = value => formatReceiptMoney(value, currency);
  const orderName = data.orderName || data.order_name || data.customerName || data.customer_name || data.guestName || data.guest_name || data.name || data.orderNumber || data.checkNo || '—';
  const employee = data.employeeName || data.employee_name || data.employee || data.staffName || data.staff_name || data.waiter || data.server || '—';
  const posName = data.posName || data.pos_name || data.terminalName || data.terminal_name || data.deviceName || data.device_name || data.pos || '—';
  const dining = data.diningOption || data.dining_option || data.orderType || data.order_type || '';
  const receiptNo = data.receiptNumber || data.receipt_number || 'Not assigned (legacy receipt)';
  const lines = [
    ...centeredBlock([
      settings.property_name || data.propertyName || 'VISIWA BEACH RESORT',
      settings.address_line1, settings.address_line2, settings.phone, settings.email,
      settings.website, settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '',
      settings.extra_header_line,
    ], width),
    divider(width),
    ...receiptCenterRows('RECEIPT', width).map(receiptDoubleHeight),
    ...receiptLeftRows('Order', orderName, width),
    ...receiptLeftRows('Employee', employee, width),
    ...receiptLeftRows('POS', posName, width),
    ...(data.table ? receiptLeftRows('Table', data.table, width) : []),
    ...(data.covers !== null && data.covers !== undefined ? receiptLeftRows('Covers', data.covers, width) : []),
    ...(data.guestName ? receiptLeftRows('Guest', data.guestName, width) : []),
    ...(data.room ? receiptLeftRows('Room', data.room, width) : []),
    divider(width),
  ];
  if (String(data.receiptStatus || '').toLowerCase() === 'voided') {
    lines.push(...receiptCenterRows('VOIDED RECEIPT', width).map(receiptDoubleHeight), divider(width));
  }
  if (dining) {
    lines.push(...receiptCenterRows(dining, width).map(emphasize), divider(width));
  }
  for (const item of (Array.isArray(data.items) ? data.items : [])) {
    const qty = itemQuantity(item);
    const unitPrice = Number(item?.unit_price ?? item?.price ?? item?.unitPrice ?? 0);
    const lineTotal = roundReceiptMoney(item?.total ?? item?.line_total ?? item?.amount ?? qty * unitPrice);
    const name = toReceiptAscii(itemName(item));
    const amount = money(lineTotal);
    const available = Math.max(8, width - amount.length - 1);
    if (name.length <= available) lines.push(name.padEnd(available) + ' ' + amount);
    else {
      lines.push(...wrapThermalText(name, width));
      lines.push(amount.padStart(width));
    }
    lines.push(...receiptPairLine(qty + ' x ' + money(unitPrice), '', width).filter(Boolean));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + toReceiptAscii(modifier), width));
  }
  lines.push(divider(width));
  lines.push(...receiptPairLine('Subtotal', money(data.subtotal ?? data.total), width));
  if (Number(data.discount || 0) > 0) lines.push(...receiptPairLine('Discount' + (data.discountName ? ' · ' + data.discountName : ''), '-' + money(data.discount), width));
  if (Number(data.vat || 0) > 0) lines.push(...receiptPairLine('VAT / tax', money(data.vat), width));
  if (Number(data.serviceCharge || data.service_charge || 0)) lines.push(...receiptPairLine('Service charge', money(data.serviceCharge ?? data.service_charge), width));
  lines.push('='.repeat(width));
  lines.push(receiptDoubleHeight(receiptPairLine('AMOUNT PAID', money(data.total), width)[0]));
  lines.push('='.repeat(width));
  if (Array.isArray(data.paymentAllocations) && data.paymentAllocations.length > 1) {
    lines.push(...receiptLeftRows('Payment', 'Split tender', width));
    for (const allocation of data.paymentAllocations) {
      const method = allocation.method || allocation.payment_method || 'Unspecified';
      lines.push(...receiptPairLine(String(method).toUpperCase(), money(allocation.amount), width));
    }
  } else {
    lines.push(...receiptLeftRows('Payment', data.paymentMethod || data.payment_method || '—', width));
  }
  lines.push(...receiptLeftRows('Receipt No', receiptNo, width));
  lines.push(...receiptLeftRows('Date', nairobiPrintedAt(data.createdAt || data.created_at || now), width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2, copyLabel], width));
  return lines.join('\n');
}
function formatShiftMoney(value) {
  return 'KSh ' + roundReceiptMoney(value).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function amountFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    return firstNumber(value.amount, value.total, value.revenue, value.value);
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = amountFrom(value);
    if (number !== null) return number;
  }
  return null;
}

function sumAmounts(value) {
  if (!Array.isArray(value)) return Number(value ?? 0) || 0;
  return value.reduce((sum, row) => sum + (Number(row?.amount ?? row?.value ?? row ?? 0) || 0), 0);
}

function drawerAdjustment(data, drawer, names) {
  for (const name of names) {
    const value = data?.[name] ?? drawer?.[name];
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) return sumAmounts(value);
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function shiftSection(label, width) {
  return [divider(width), ...receiptCenterRows(label, width).map(emphasize), divider(width)];
}

function shiftMoneyRows(label, value, width, { strong = false } = {}) {
  const rows = receiptPairLine(label, formatShiftMoney(value), width);
  return strong ? rows.map((row, index) => (index === 0 ? emphasize(row) : row)) : rows;
}

function resolveDepartmentRows(data = {}) {
  const explicit = data.departments || data.revenueByDepartment || data.revenue_by_department || {};
  const categories = data.categories || {};
  const rows = [];
  const room = firstNumber(explicit.room, explicit.rooms, explicit.room_charge, data.roomRevenue);
  if (room !== null) rows.push(['Room', room]);
  const restaurant = firstNumber(explicit.restaurant, explicit.restaurant_services, categories.food?.amount, categories.food);
  if (restaurant !== null) rows.push(['Restaurant', restaurant]);
  const spa = firstNumber(explicit.spa, explicit.spa_services, explicit['SPA Services'], data.spaRevenue);
  if (spa !== null) rows.push(['SPA Services', spa]);
  const drinks = firstNumber(explicit.bar, explicit.drinks, categories.drinks?.amount, categories.drinks);
  if (drinks !== null && (drinks > 0 || explicit.bar !== null || explicit.drinks !== null || categories.drinks !== null)) {
    rows.push(['Bar / Drinks', drinks]);
  }
  return rows;
}

export function buildShiftReportText(data = {}, { printer = {}, settings = {}, copyLabel = null, preview = false, now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const documentSettings = { ...(data.settings || {}), ...(settings || {}) };
  const shift = data.shift || {};
  const payments = data.payments || {};
  const refundsByMethod = data.refundsByMethod || {};
  const drawer = data.cashDrawer || data.cash_drawer || {};

  const shiftNumber = String(shift.shift_no ?? shift.shiftNo ?? shift.id ?? '—');
  const businessDate = shift.date ? String(shift.date) : '—';
  const openedAt = shift.opened_at || shift.openedAt;
  const closedAt = shift.closed_at || shift.closedAt || data.closedAt;
  const cashier = String(data.closedBy || data.openedBy || 'Staff');
  const terminal = String(data.posName || data.pos_name || data.terminalName || data.terminal_name || shift.terminal_name || shift.device_name || shift.pos_terminal || '—');

  const openingCash = firstNumber(shift.opening_cash, shift.openingCash, data.openingCash) ?? 0;
  const grossCash = firstNumber(data.grossPayments?.cash?.amount, data.grossPayments?.cash) ?? 0;
  const cashRefunds = firstNumber(refundsByMethod.cash, refundsByMethod.cash?.amount) ?? 0;
  const cashRefundsReceived = drawerAdjustment(data, drawer, ['cashRefundsReceived', 'cash_refunds_received']);
  const paidIn = drawerAdjustment(data, drawer, ['paidIn', 'paidInTotal', 'paid_in'])
    + drawerAdjustment(data, drawer, ['paidIns', 'paid_ins']);
  const paidOut = drawerAdjustment(data, drawer, ['paidOut', 'paidOutTotal', 'paid_out'])
    + drawerAdjustment(data, drawer, ['paidOuts', 'paid_outs']);
  const expectedCash = firstNumber(data.expectedCash, data.expected_cash)
    ?? roundReceiptMoney(openingCash + grossCash + cashRefundsReceived - cashRefunds + paidIn - paidOut);

  const discounts = firstNumber(data.discountsTotal, data.discounts) ?? 0;
  const refunds = firstNumber(data.refundsTotal, data.refunds) ?? 0;
  const grossSales = firstNumber(data.salesBeforeDiscount, data.grossSales) ?? roundReceiptMoney(grossCash + discounts);
  const netSales = firstNumber(data.netSales, data.totalSales) ?? roundReceiptMoney(grossSales - discounts - refunds);
  const vatTotal = firstNumber(data.vatTotal, data.vat) ?? 0;

  const methods = [
    ['cash', 'Cash', true],
    ['card', 'Card', true],
    ['mpesa', 'M-Pesa', true],
    ['bank', 'Bank Transfer', false],
    ['room_charge', 'Room Charge', false],
    ['other', 'Other', false],
  ];
  const copy = String(copyLabel || (preview ? 'PRE-CLOSE - SHIFT STILL OPEN' : 'CASHIER COPY'));
  const generatedAt = nairobiPrintedAt(now);
  const lines = [
    ...receiptCenterRows(copy, width).map(emphasize),
    ...centeredBlock([
      documentSettings.property_name || data.propertyName || 'OliTechs PMS + POS',
      documentSettings.address_line1,
      documentSettings.address_line2,
      documentSettings.phone,
      documentSettings.email,
      documentSettings.website,
      documentSettings.kra_pin ? 'KRA PIN: ' + documentSettings.kra_pin : '',
    ], width),
    divider(width),
    ...receiptCenterRows(preview ? 'LIVE SHIFT SUMMARY' : 'SHIFT CLOSING REPORT', width).map(receiptDoubleHeight),
    ...receiptLeftRows('Shift No', shiftNumber, width),
    ...receiptLeftRows('Terminal', terminal, width),
    ...receiptLeftRows('Cashier', cashier, width),
    ...receiptLeftRows('Business date', businessDate, width),
    ...receiptLeftRows('Opened at', openedAt ? nairobiPrintedAt(openedAt) : '—', width),
    ...receiptLeftRows('Closed at', preview ? 'STILL OPEN' : (closedAt ? nairobiPrintedAt(closedAt) : '—'), width),
    ...shiftSection('CASH DRAWER SUMMARY', width),
    ...shiftMoneyRows('Starting Cash', openingCash, width),
    ...shiftMoneyRows('Cash Payments', grossCash, width),
    ...(cashRefundsReceived > 0 ? shiftMoneyRows('Cash Refunds to Drawer', cashRefundsReceived, width) : []),
    ...shiftMoneyRows('Cash Refunds Paid Out', -cashRefunds, width),
    ...shiftMoneyRows('Paid In', paidIn, width),
    ...shiftMoneyRows('Paid Out', -paidOut, width),
    ...shiftMoneyRows(preview ? 'Expected Cash in Drawer' : 'Expected Cash Amount', expectedCash, width, { strong: true }),
    ...shiftSection('SALES SUMMARY', width),
    ...shiftMoneyRows('Gross Sales', grossSales, width),
    ...shiftMoneyRows('Refunds', refunds, width),
    ...shiftMoneyRows('Discounts', discounts, width),
    ...(vatTotal !== 0 ? shiftMoneyRows('VAT / tax', vatTotal, width) : []),
    ...shiftMoneyRows('Net Sales', netSales, width, { strong: true }),
    ...shiftSection('PAYMENT METHOD BREAKDOWN', width),
  ];

  for (const [key, label, alwaysShow] of methods) {
    const amount = firstNumber(payments?.[key]?.amount, payments?.[key]) ?? 0;
    if (alwaysShow || amount !== 0) lines.push(...shiftMoneyRows(label, amount, width));
  }

  const departments = resolveDepartmentRows(data);
  if (departments.length) {
    lines.push(...shiftSection('DEPARTMENT / REVENUE BREAKDOWN', width));
    for (const [label, amount] of departments) lines.push(...shiftMoneyRows(label, amount, width));
  }

  const voidedCount = Array.isArray(data.voidedOrders)
    ? data.voidedOrders.length
    : (firstNumber(data.voidedCount, data.voided_count) ?? 0);
  lines.push(
    divider(width),
  );
  if (voidedCount > 0) lines.push(...receiptLeftRows('Voided receipts excluded', String(voidedCount), width));
  if (!preview && data.countedCash !== null && data.countedCash !== undefined) {
    lines.push(...shiftMoneyRows('Counted Cash', firstNumber(data.countedCash) ?? 0, width));
  }
  if (!preview && data.variance !== null && data.variance !== undefined) {
    lines.push(...shiftMoneyRows('Variance', firstNumber(data.variance) ?? 0, width));
  }
  lines.push(
    ...receiptLeftRows('Generated', generatedAt || '—', width),
    ...receiptLeftRows('Cashier', cashier, width),
    ...receiptLeftRows('Shift No', shiftNumber, width),
    divider(width),
    ...receiptCenterRows('Manager verification: __________________', width),
    ...receiptCenterRows(copy, width),
  );
  return lines.join('\n');
}

export function buildShiftPreviewText(data = {}, options = {}) {
  return buildShiftReportText(data, {
    ...options,
    preview: true,
    copyLabel: options.copyLabel || 'PRE-CLOSE - SHIFT STILL OPEN',
  });
}

export function buildVoidTicketText(data = {}, { printer = {}, settings = {}, center = null, now = new Date() } = {}) {
  const width = getOrderTicketColumns(printer);
  const documentSettings = { ...(data.settings || {}), ...(settings || {}) };
  const safe = toReceiptAscii;
  const rawCenter = String(center || data.center || data.category || 'KITCHEN').toUpperCase();
  const productionCenter = rawCenter === 'DRINKS' || rawCenter === 'BAR' ? 'BAR' : 'KITCHEN';
  const orderNumber = safe(data.orderNumber || data.order_number || data.checkNo || data.check_no || data.originalOrderNumber || data.id || '—');
  const displayOrderNumber = orderNumber.startsWith('#') ? orderNumber : '#' + orderNumber;
  const voidNumber = safe(data.voidNumber || data.void_number || '—');
  const location = safe(data.tableNo || data.table_number || data.table || data.room || data.location || '—');
  const orderBy = safe(data.waiterName || data.waiter || data.employeeName || data.createdByName || '—');
  const voidBy = safe(data.removedBy || data.removedByName || data.removed_by_name || '—');
  const authorisedBy = safe(data.approvedByName || data.approved_by_name || data.authorisedBy || data.managerSignature || data.manager_signature || '—');
  const orderedAt = data.orderCreatedAt || data.order_created_at || data.original_order_at || null;
  const voidedAt = data.voidedAt || data.timestamp || data.created_at || now;
  const reason = safe(data.reason || data.voidReason || data.void_reason || 'Not specified');
  const originalTotal = amountFrom(data.originalTotal ?? data.original_total ?? data.orderTotal ?? data.order_total);
  const rawItems = Array.isArray(data.items) && data.items.length ? data.items : [data];
  const lines = [
    ...receiptCenterRows('*** ' + productionCenter + ' VOID ***', width).map(emphasize),
    ...centeredBlock([
      documentSettings.property_name || data.propertyName || 'OliTechs PMS + POS',
      documentSettings.address_line1,
      documentSettings.address_line2,
      documentSettings.phone,
    ], width),
    divider(width),
    ...receiptCenterRows('VOID ORDER', width).map(receiptDoubleHeight),
    ...receiptCenterRows('NOT A COMPLETED SALE', width),
    divider(width),
    ...receiptLeftRows('Order', displayOrderNumber, width),
    ...receiptLeftRows('Void Ref', voidNumber, width),
    ...receiptLeftRows('Location', location, width),
    ...receiptLeftRows('Terminal', data.posName || data.terminalName || '—', width),
    ...receiptLeftRows('Order by', orderBy, width),
    ...receiptLeftRows('Void by', voidBy, width),
    ...receiptLeftRows('Authorised by', authorisedBy, width),
    ...receiptLeftRows('Ordered at', orderedAt ? nairobiPrintedAt(orderedAt) : '—', width),
    ...receiptLeftRows('Voided at', nairobiPrintedAt(voidedAt) || '—', width),
    ...shiftSection('VOIDED ITEMS', width),
  ];

  for (const item of rawItems) {
    const name = safe(item.item || item.itemName || item.item_name || itemName(item));
    const qty = firstNumber(
      item.removedQty,
      item.removed_qty,
      item.voidedQty,
      item.voided_qty,
      item.qty ?? item.quantity,
    ) ?? 1;
    const originalQty = amountFrom(item.originalQty ?? item.original_qty);
    const remainingQty = amountFrom(item.newQty ?? item.new_qty ?? item.remainingQty ?? item.remaining_qty);
    lines.push(...wrapThermalText(qty + ' x ' + name, width));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : [])
      .map(modifier => safe(modifierLabel(modifier)))
      .filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = safe(item.note || item.notes || item.prepNote || item.prep_note || item.kitchen_note || '');
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    if (originalQty !== null || remainingQty !== null) {
      lines.push(...wrapThermalText(
        'Qty voided ' + qty + ' | Original ' + (originalQty ?? '—') + ' | Remaining ' + (remainingQty ?? '—'),
        width,
      ));
    }
    lines.push('');
  }

  lines.push(
    ...shiftSection('VOID INFORMATION', width),
  );
  lines.push(...receiptLeftRows('Reason', reason, width));
  lines.push(...receiptLeftRows('Responsible staff', voidBy, width));
  lines.push(...receiptLeftRows('Authorising manager', authorisedBy, width));
  lines.push(...receiptLeftRows('Original order', displayOrderNumber, width));
  if (originalTotal !== null) lines.push(...shiftMoneyRows('Original total', originalTotal, width));
  lines.push(...receiptLeftRows('Void timestamp', nairobiPrintedAt(voidedAt) || '—', width));
  lines.push(
    divider(width),
    ...receiptCenterRows('NOT A SALES RECEIPT', width).map(emphasize),
    ...receiptCenterRows('CONTROL COPY - RETAIN FOR AUDIT', width),
    ...receiptCenterRows('Manager verification: __________________', width),
  );
  return lines.join('\n');
}

export function thermalTextToHtml(text) {
  const paper = getPrintColor('--print-paper');
  const ink = getPrintColor('--print-ink');
  return '<pre style="margin:0;padding:0 0 2em;background:' + paper + ';color:' + ink + ';white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:400;line-height:1.35;letter-spacing:0.05px;font-kerning:normal;-webkit-font-smoothing:antialiased">' + escapeHtml(text) + '</pre>';
}

export function estimateThermalFeedLines() {
  // Leave approximately two blank lines after the footer before the cutter.
  return 2;
}

export function toEscPosPayload(text, options = {}) {
  return buildEscPosPayload(text, options);
}
