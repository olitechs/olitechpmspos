const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function getPrinterColumns(printer = {}) {
  // Use conservative printable columns rather than the theoretical maximum:
  // 42 columns on 80mm and 30 on 58mm avoids clipping on common thermal heads.
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
  return (Array.isArray(currentLines) ? currentLines : []).flatMap(line => {
    const alreadySent = sentQuantities.get(keyFor(line)) || 0;
    const quantity = Math.max(0, itemQuantity(line) - alreadySent);
    return quantity > 0 ? [{ ...line, qty: quantity }] : [];
  });
}

export function buildOrderTicketText(order = {}, { printer = {}, settings = {}, center = 'KITCHEN', items = order.items || [], now = new Date() } = {}) {
  const safe = value => toReceiptAscii(value);
  items = (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    name: safe(itemName(item)),
    modifiers: (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifier => safe(modifierLabel(modifier))),
    prepNote: safe(item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note || ''),
  }));
  const width = getPrinterColumns(printer);
  const productionCenter = safe(center || 'KITCHEN').toUpperCase();
  const orderNo = safe(order.orderNumber || order.checkNo || order.order_number || order.id || '—');
  const ticketNo = safe(order.ticketNumber || order.ticket_number || (productionCenter.includes('BAR') ? 'BOT-' : 'KOT-') + orderNo);
  const table = safe(order.table || order.tableNumber || order.table_number || '—');
  const waiter = safe(order.waiter || order.server || 'Unassigned');
  const dining = safe(order.diningOption || order.dining_option || order.orderType || order.order_type || '—');
  const company = safe(settings.property_name || order.propertyName || order.property_name || 'OLITECHS PMS + POS');
  const header = centeredBlock([
    company.toUpperCase(),
    safe(settings.address_line1),
    safe(settings.address_line2),
    safe(settings.phone),
    safe(settings.email),
    safe(settings.website),
    settings.kra_pin ? 'KRA PIN: ' + safe(settings.kra_pin) : '',
    safe(settings.extra_header_line),
  ], width);
  const lines = [
    ...header,
    divider(width),
    ...centerRows(productionCenter + ' ORDER TICKET', width).map(emphasize),
    ...labeledRows('ORDER NO', orderNo, width).map(emphasize),
    ...labeledRows('TICKET NO', ticketNo, width).map(emphasize),
    ...labeledRows('TABLE', table, width),
    ...labeledRows('SERVER', waiter.toUpperCase(), width),
    ...labeledRows('DINING', dining.toUpperCase(), width),
  ];
  if (order.covers != null || order.guests != null) lines.push(...labeledRows('COVERS', order.covers ?? order.guests, width));
  lines.push(...labeledRows('TIME', stamp(order.createdAt || order.created_at || now), width));
  if (order.isReprint || order.reprint) lines.push(...centerRows('*** REPRINT ***', width).map(emphasize));
  if (order.isAddition || order.addition) lines.push(...centerRows('*** ADDITIONAL ITEMS ***', width).map(emphasize));
  lines.push(divider(width));

  // Kitchen tickets use normal thermal font size. Bold emphasis keeps the
  // item line readable without doubling its physical height or reducing width.
  for (const item of items) {
    const qty = itemQuantity(item);
    const heading = qty + ' x ' + itemName(item);
    for (const row of wrapThermalText(heading, width)) lines.push(emphasize(row));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note;
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    lines.push('');
  }

  lines.push(divider(width));
  lines.push(...centeredBlock([safe(settings.footer_line1), safe(settings.footer_line2), 'PRODUCTION COPY - ' + productionCenter], width), '');
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
    return { item, qty, lineTotal: roundReceiptMoney(qty * unitPrice) };
  });
  const subtotal = roundReceiptMoney(normalizedItems.reduce((sum, row) => sum + row.lineTotal, 0));
  const vat = resolveUnsettledVat(settings, data, subtotal);
  const header = centeredBlock([
    settings.property_name || data.propertyName || '',
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
    ...receiptCenterRows('Payment pending', width),
  ];

  const info = [
    ['Table', data.table || data.tableNumber || data.table_number],
    ['Server', data.waiter || data.server],
    ['Covers', data.covers ?? data.guests],
    ['Dining', data.diningOption || data.dining_option || data.orderType || data.order_type],
  ];
  for (const [label, value] of info) lines.push(...receiptLeftRows(label, value, width));

  lines.push(divider(width));

  for (const { item, qty, lineTotal } of normalizedItems) {
    const amount = formatReceiptMoney(lineTotal, currency);
    const leftWidth = Math.max(4, width - amount.length);
    const heading = toReceiptAscii(qty + ' x ' + itemName(item));
    const nameRows = wrapThermalText(heading, leftWidth);
    const firstName = nameRows[0] || '';
    lines.push(firstName.padEnd(leftWidth, '.') + amount);
    for (const row of nameRows.slice(1)) lines.push(...wrapThermalText('  ' + row, width));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + toReceiptAscii(modifier), width));
    const note = item.prepNote || item.prep_note || item.notes || item.note;
    if (note) lines.push(...wrapThermalText('  NOTE: ' + toReceiptAscii(note), width));
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
  lines.push(receiptDoubleHeight(
    receiptPairLine('AMOUNT DUE', formatReceiptMoney(vat.amountDue, currency), width)[0]
  ));
  lines.push('='.repeat(width));

  lines.push(...receiptCenterRows('Please settle at the cashier', width));
  lines.push(...receiptCenterRows('Not a tax invoice / Not a paid receipt', width));

  const checkNo = data.checkNo || data.check_no || data.orderNumber || data.order_number || '';
  if (checkNo) lines.push(...receiptCenterRows('Check: ' + toReceiptAscii(checkNo), width).map(emphasize));
  const printedAt = nairobiPrintedAt(now);
  if (printedAt) lines.push(...receiptCenterRows(printedAt, width));
  if (copyLabel) lines.push(...receiptCenterRows(toReceiptAscii(copyLabel), width));

  // All visible lines are wrapped before this point. Do not slice the raw
  // string here: ESC/POS emphasis/size commands are non-printing bytes and
  // must not count against the paper's printable character width.
  return lines.join('\n');
}

export function buildFinalReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const currency = data.currency || 'KES';
  const receiptNo = data.receiptNumber || data.receipt_number || data.receiptId || 'RCT-' + (data.checkNo || data.orderNumber || '—');
  const money = value => currency + ' ' + Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    ...centeredBlock([
      settings.property_name || data.propertyName || 'OLITECHS PMS + POS',
      settings.address_line1, settings.address_line2, settings.phone, settings.email,
      settings.website, settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '', settings.extra_header_line,
    ], width),
    divider(width),
    ...centerRows('FINAL RECEIPT', width).map(emphasize),
    ...labeledRows('COPY', copyLabel, width),
    ...labeledRows('RECEIPT NO', receiptNo, width),
    ...labeledRows('ORDER NO', data.orderNumber || data.checkNo || '—', width),
    ...labeledRows('CHECK', data.checkNo || data.orderNumber || '—', width),
    ...labeledRows('TABLE', data.table || data.tableNumber || '—', width),
    ...labeledRows('SERVER', data.waiter || data.server || 'Unassigned', width),
    ...labeledRows('DATE', stamp(data.createdAt || data.created_at || now), width),
    divider(width),
    pairLine('QTY  ITEM', 'AMOUNT', width),
    divider(width),
  ];
  for (const item of data.items || []) {
    const qty = itemQuantity(item);
    const nameRows = wrapThermalText(qty + ' x ' + itemName(item), Math.max(12, width - 12));
    lines.push(pairLine(nameRows[0], money(qty * Number(item.price || 0)), width), ...nameRows.slice(1));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
  }
  lines.push(divider(width));
  lines.push(pairLine('SUBTOTAL', money(data.subtotal ?? data.total), width));
  if (Number(data.discount || 0) > 0) lines.push(pairLine('DISCOUNT', '-' + money(data.discount), width));
  if (Number(data.serviceCharge || data.service_charge || 0) > 0) lines.push(pairLine('SERVICE CHARGE', money(data.serviceCharge ?? data.service_charge), width));
  lines.push(divider(width), emphasize(pairLine('TOTAL PAID', money(data.total), width)), divider(width));
  lines.push(...labeledRows('PAYMENT METHOD', data.paymentMethod || '—', width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2], width), '');
  return lines.join('\n');
}

export function thermalTextToHtml(text) {
  return '<pre style="margin:0;padding:0;background:white;color:black;white-space:pre-wrap;font-family:monospace">' + escapeHtml(text) + '</pre>';
}

export function estimateThermalFeedLines(text) {
  const lineCount = String(text ?? '').replace(/\r/g, '').split('\n').length;
  // Keep a safe tear/cutter margin and add a little more for unusually long bills.
  return Math.min(14, 6 + Math.floor(Math.max(0, lineCount - 60) / 80));
}

export function toEscPosPayload(text, options = {}) {
  const body = String(text ?? '').replace(/\r/g, '').replace(/\n+$/g, '');
  const requestedFeed = Number(options.feedLines);
  const feedLines = Number.isInteger(requestedFeed)
    ? Math.max(4, Math.min(6, requestedFeed))
    : estimateThermalFeedLines(body);
  const initialize = options.initialize === false ? '' : '\x1B\x40';
  const cut = options.partialCut === true ? '\x1D\x56\x42\x00' : '\x1D\x56\x01';
  return initialize + '\x1B\x61\x00' + body + '\n' +
    '\x1B\x64' + String.fromCharCode(feedLines) + cut;
}
