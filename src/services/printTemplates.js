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

export function buildOrderTicketText(order = {}, { printer = {}, center = 'KITCHEN', items = order.items || [], now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const productionCenter = String(center || 'KITCHEN').toUpperCase();
  const orderNo = order.orderNumber || order.checkNo || order.order_number || order.id || '—';
  const table = order.table || order.tableNumber || order.table_number || '—';
  const waiter = order.waiter || order.server || 'Unassigned';
  const dining = order.diningOption || order.dining_option || order.orderType || order.order_type || '—';
  const lines = [
    fit(order.propertyName || order.property_name || 'OLITECHS PMS + POS', width).toUpperCase(),
    divider(width),
    emphasize(fit(productionCenter + ' ORDER TICKET', width)),
    emphasize(fit('ORDER: ' + orderNo, width)),
    'TABLE: ' + fit(table, Math.max(8, width - 7)).replace(/\n/g, '\n       '),
    'SERVER: ' + fit(waiter, Math.max(8, width - 8)).toUpperCase().replace(/\n/g, '\n        '),
    'DINING: ' + fit(dining, Math.max(8, width - 8)).toUpperCase().replace(/\n/g, '\n        '),
  ];
  if (order.covers != null || order.guests != null) lines.push('COVERS: ' + (order.covers ?? order.guests));
  lines.push('TIME: ' + stamp(order.createdAt || order.created_at || now));
  if (order.isReprint || order.reprint) lines.push(emphasize('*** REPRINT ***'));
  if (order.isAddition || order.addition) lines.push(emphasize('*** ADDITIONAL ITEMS ***'));
  lines.push(divider(width));

  for (const item of items) {
    const qty = itemQuantity(item);
    const heading = qty + ' x ' + itemName(item);
    const rows = wrapThermalText(heading, width);
    lines.push(...rows.map(row => emphasize(row)));
    const modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map(modifierLabel).filter(Boolean);
    for (const modifier of modifiers) lines.push(...wrapThermalText('  + ' + modifier, width));
    const note = item.prepNote || item.prep_note || item.notes || item.note || item.kitchen_note;
    if (note) lines.push(...wrapThermalText('  NOTE: ' + note, width));
    lines.push('');
  }

  lines.push(divider(width), 'PRODUCTION COPY · ' + productionCenter, '');
  return lines.join('\n');
}

export function buildUnsettledReceiptText(settings = {}, data = {}, { printer = {}, copyLabel = 'CUSTOMER COPY', now = new Date() } = {}) {
  const width = getPrinterColumns(printer);
  const currency = data.currency || 'KES';
  const money = value => currency + ' ' + Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    fit(settings.property_name || data.propertyName || 'OLITECHS PMS + POS', width).toUpperCase(),
    ...[settings.address_line1, settings.address_line2, settings.phone, settings.email, settings.website, settings.kra_pin ? 'KRA PIN: ' + settings.kra_pin : '']
      .filter(Boolean).flatMap(value => wrapThermalText(value, width)),
    divider(width),
    emphasize(fit('*** BILL - NOT PAID ***', width)),
    emphasize(fit('PAYMENT PENDING', width)),
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
  if (settings.footer_line1) lines.push(...wrapThermalText(settings.footer_line1, width));
  if (settings.footer_line2) lines.push(...wrapThermalText(settings.footer_line2, width));
  lines.push('');
  lines.push(emphasize(fit('PAYMENT PENDING - NOT PAID', width)));
  lines.push(fit('NOT A TAX INVOICE / NOT A PAID RECEIPT', width));
  lines.push(fit('PLEASE SETTLE AT THE CASHIER', width), '');
  return lines.join('\n');
}

export function thermalTextToHtml(text) {
  return '<pre style="margin:0;padding:0;background:#fff;color:#000;white-space:pre-wrap;font-family:monospace">' + escapeHtml(text) + '</pre>';
}
