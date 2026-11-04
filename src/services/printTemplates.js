const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function getPrinterColumns(printer = {}) {
  const override = Number(printer.character_width ?? printer.characters_per_line);
  if (Number.isInteger(override) && override >= 24 && override <= 64) return override;
  return String(printer.paper_width || '80mm').toLowerCase() === '58mm' ? 32 : 48;
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

function fit(value, width) {
  return wrapThermalText(value, width).join('\n');
}

function centerRows(value, width) {
  return wrapThermalText(value, width).map(row => row.padStart(Math.floor((width + row.length) / 2)).padEnd(width));
}

function centeredBlock(values, width) {
  return values.filter(value => value != null && String(value).trim() !== '')
    .flatMap(value => centerRows(value, width));
}

function divider(width) {
  return '-'.repeat(width);
}

function pairLine(label, value, width) {
  const left = String(label || '');
  const right = String(value ?? '');
  if (left.length + right.length + 1 > width) {
    return fit(left, width) + '\n' + right.slice(0, width).padStart(width);
  }
  return left + ' '.repeat(width - left.length - right.length) + right;
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

export function buildOrderTicketText(order = {}, { printer = {}, settings = {}, center = 'KITCHEN', items = order.items || [], now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const productionCenter = String(center || 'KITCHEN').toUpperCase();
  const orderNo = order.orderNumber || order.checkNo || order.order_number || order.id || '—';
  const table = order.table || order.tableNumber || order.table_number || '—';
  const waiter = order.waiter || order.server || 'Unassigned';
  const dining = order.diningOption || order.dining_option || order.orderType || order.order_type || '—';
  const company = settings.property_name || order.propertyName || order.property_name || 'OLITECHS PMS + POS';
  const header = centeredBlock([
    company.toUpperCase(),
    settings.address_line1,
    settings.address_line2,
    settings.phone,
    settings.email,
    settings.website,
    settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '',
    settings.extra_header_line,
  ], width);
  const lines = [
    ...header,
    divider(width),
    ...centerRows(productionCenter + ' ORDER TICKET', width).map(emphasize),
    ...centerRows('ORDER: ' + orderNo, width).map(emphasize),
    'TABLE: ' + fit(table, Math.max(8, width - 7)).replace(/\n/g, '\n       '),
    'SERVER: ' + fit(waiter, Math.max(8, width - 8)).toUpperCase().replace(/\n/g, '\n        '),
    'DINING: ' + fit(dining, Math.max(8, width - 8)).toUpperCase().replace(/\n/g, '\n        '),
  ];
  if (order.covers != null || order.guests != null) lines.push('COVERS: ' + (order.covers ?? order.guests));
  lines.push('TIME: ' + stamp(order.createdAt || order.created_at || now));
  if (order.isReprint || order.reprint) lines.push(...centerRows('*** REPRINT ***', width).map(emphasize));
  if (order.isAddition || order.addition) lines.push(...centerRows('*** ADDITIONAL ITEMS ***', width).map(emphasize));
  lines.push(divider(width));

  // ESC/POS double-size mode improves kitchen readability. Wrap at half-width
  // so large text never overruns the configured 58mm/80mm paper width.
  const itemWidth = Math.max(12, Math.floor(width / 2));
  for (const item of items) {
    const qty = itemQuantity(item);
    const heading = qty + ' x ' + itemName(item);
    const rows = wrapThermalText(heading, itemWidth);
    lines.push('\x1D\x21\x11' + rows.map(row => emphasize(row)).join('\n') + '\x1D\x21\x00');
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note;
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    lines.push('');
  }

  lines.push(divider(width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2, 'PRODUCTION COPY · ' + productionCenter], width), '');
  return lines.join('\n');
}

export function buildUnsettledReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const currency = data.currency || 'KES';
  const money = value => currency + ' ' + Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const header = centeredBlock([
    settings.property_name || data.propertyName || 'OLITECHS PMS + POS',
    settings.address_line1,
    settings.address_line2,
    settings.phone,
    settings.email,
    settings.website,
    settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '',
    settings.extra_header_line,
  ], width);
  const lines = [
    ...header,
    divider(width),
    ...centerRows(settings.unsettled_receipt_title || '*** BILL - NOT PAID ***', width).map(emphasize),
    ...centerRows('PAYMENT PENDING', width).map(emphasize),
    'COPY: ' + copyLabel,
    'CHECK: ' + (data.checkNo || data.orderNumber || '—'),
    'TABLE: ' + (data.table || data.tableNumber || '—'),
    'SERVER: ' + (data.waiter || data.server || 'Unassigned'),
    'DINING: ' + (data.diningOption || data.dining_option || '—'),
    'COVERS: ' + (data.covers ?? '—'),
    'DATE: ' + stamp(data.createdAt || data.created_at || now),
    divider(width),
    pairLine('QTY  ITEM', 'AMOUNT', width),
    divider(width),
  ];

  for (const item of data.items || []) {
    const qty = itemQuantity(item);
    const nameRows = wrapThermalText(qty + ' x ' + itemName(item), Math.max(12, width - 12));
    lines.push(pairLine(nameRows[0], money(qty * Number(item.price || 0)), width));
    for (const row of nameRows.slice(1)) lines.push(row);
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = item.prepNote || item.prep_note || item.notes || item.note;
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
  }

  lines.push(divider(width));
  lines.push(pairLine('SUBTOTAL', money(data.subtotal ?? data.total), width));
  if (Number(data.discount || 0) > 0) lines.push(pairLine('DISCOUNT', '-' + money(data.discount), width));
  if (Number(data.vat || 0) > 0) lines.push(pairLine('VAT', money(data.vat), width));
  if (Number(data.serviceCharge || data.service_charge || 0) > 0) {
    lines.push(pairLine('SERVICE CHARGE', money(data.serviceCharge ?? data.service_charge), width));
  }
  lines.push(divider(width));
  lines.push(emphasize(pairLine('TOTAL DUE', money(data.total), width)));
  lines.push(divider(width));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2], width));
  lines.push('');
  lines.push(...centerRows('PAYMENT PENDING - NOT PAID', width).map(emphasize));
  lines.push(...centerRows('NOT A TAX INVOICE / NOT A PAID RECEIPT', width));
  lines.push(...centerRows('PLEASE SETTLE AT THE CASHIER', width), '');
  return lines.join('\n');
}

export function buildFinalReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const currency = data.currency || 'KES';
  const money = value => currency + ' ' + Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    ...centeredBlock([
      settings.property_name || data.propertyName || 'OLITECHS PMS + POS',
      settings.address_line1, settings.address_line2, settings.phone, settings.email,
      settings.website, settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '', settings.extra_header_line,
    ], width),
    divider(width),
    ...centerRows('FINAL RECEIPT', width).map(emphasize),
    'COPY: ' + copyLabel,
    'CHECK: ' + (data.checkNo || data.orderNumber || '—'),
    'TABLE: ' + (data.table || data.tableNumber || '—'),
    'SERVER: ' + (data.waiter || data.server || 'Unassigned'),
    'DATE: ' + stamp(data.createdAt || data.created_at || now),
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
  if (Number(data.vat || 0) > 0) lines.push(pairLine('VAT', money(data.vat), width));
  if (Number(data.serviceCharge || data.service_charge || 0) > 0) lines.push(pairLine('SERVICE CHARGE', money(data.serviceCharge ?? data.service_charge), width));
  lines.push(divider(width), emphasize(pairLine('TOTAL PAID', money(data.total), width)), divider(width));
  lines.push('PAYMENT METHOD: ' + (data.paymentMethod || '—'));
  lines.push(...centeredBlock([settings.footer_line1, settings.footer_line2], width), '');
  return lines.join('\n');
}

export function thermalTextToHtml(text) {
  return '<pre style="margin:0;padding:0;background:white;color:black;white-space:pre-wrap;font-family:monospace">' + escapeHtml(text) + '</pre>';
}

export function toEscPosPayload(text) {
  return '\x1B\x40\x1B\x61\x00' + String(text ?? '').replace(/\r/g, '').trimEnd() + '\n\n\x1D\x56\x01';
}
