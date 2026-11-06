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
  const orderName = safe(order.orderName || order.order_name || order.customerName || order.customer_name || order.guestName || order.guest_name || order.name || '—');
  const employee = safe(order.employeeName || order.employee_name || order.employee || order.staffName || order.staff_name || order.createdByName || order.created_by_name || order.waiter || order.server || '—');
  const posName = safe(order.posName || order.pos_name || order.terminalName || order.terminal_name || order.deviceName || order.device_name || order.pos || '—');
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
    lines.push(...wrapThermalText(qty + ' x ' + name, width).map(emphasize));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifier => safe(modifierLabel(modifier))).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = safe(item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note || '');
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    lines.push('');
  }

  lines.push(divider(width));
  const footer = [settings.footer_line1, settings.footer_line2].map(safe).filter(Boolean);
  lines.push(...centeredBlock(footer, width));
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
  const posName = data.posName || data.pos_name || data.terminalName || data.terminal_name || data.deviceName || data.device_name || data.pos || '—';
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
  if (copyLabel) lines.push(...receiptCenterRows(toReceiptAscii(copyLabel), width));
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
  const receiptNo = data.receiptNumber || data.receipt_number || data.receiptId || 'RCT-' + (data.checkNo || data.orderNumber || '—');
  const lines = [
    ...centeredBlock([
      settings.property_name || data.propertyName || 'VISIWA BEACH RESORT',
      settings.address_line1, settings.address_line2, settings.phone, settings.email,
      settings.website, settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '',
    ], width),
    divider(width),
    ...receiptCenterRows('RECEIPT', width).map(receiptDoubleHeight),
    ...receiptLeftRows('Order', orderName, width),
    ...receiptLeftRows('Employee', employee, width),
    ...receiptLeftRows('POS', posName, width),
    divider(width),
  ];
  if (dining) {
    lines.push(...receiptCenterRows(dining, width).map(emphasize), divider(width));
  }
  for (const item of (Array.isArray(data.items) ? data.items : [])) {
    const qty = itemQuantity(item);
    const unitPrice = Number(item?.price ?? item?.unitPrice ?? item?.unit_price ?? 0);
    const lineTotal = roundReceiptMoney(qty * unitPrice);
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
  if (Number(data.discount || 0) > 0) lines.push(...receiptPairLine('Discount', '-' + money(data.discount), width));
  if (Number(data.serviceCharge || data.service_charge || 0) > 0) lines.push(...receiptPairLine('Service charge', money(data.serviceCharge ?? data.service_charge), width));
  lines.push('='.repeat(width));
  lines.push(receiptDoubleHeight(receiptPairLine('AMOUNT PAID', money(data.total), width)[0]));
  lines.push('='.repeat(width));
  lines.push(...receiptLeftRows('Payment', data.paymentMethod || data.payment_method || '—', width));
  lines.push(...receiptLeftRows('Receipt No', receiptNo, width));
  lines.push(...receiptLeftRows('Date', nairobiPrintedAt(data.createdAt || data.created_at || now), width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2, copyLabel], width));
  return lines.join('\n');
}
export function thermalTextToHtml(text) {
  return '<pre style="margin:0;padding:0;background:white;color:black;white-space:pre-wrap;font-family:monospace">' + escapeHtml(text) + '</pre>';
}

export function estimateThermalFeedLines(text) {
  const lineCount = String(text ?? '').replace(/\r/g, '').split('\n').length;
  // Keep a safe tear/cutter margin and add a little more for unusually long bills.
  return Math.min(24, 20 + Math.floor(Math.max(0, lineCount - 60) / 80));
}

export function toEscPosPayload(text, options = {}) {
  const body = String(text ?? '').replace(/\r/g, '').replace(/\n+$/g, '');
  const requestedFeed = Number(options.feedLines);
  const feedLines = Number.isInteger(requestedFeed)
    ? Math.max(4, Math.min(24, requestedFeed))
    : estimateThermalFeedLines(body);
  const initialize = options.initialize === false ? '' : '\x1B\x40';
  const cut = options.partialCut === true ? '\x1D\x56\x42\x00' : '\x1D\x56\x01';
  return initialize + '\x1B\x61\x00' + body + '\n' +
    '\x1B\x64' + String.fromCharCode(feedLines) + cut;
}
