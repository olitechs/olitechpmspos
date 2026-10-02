import { supabase } from '@/lib/supabaseClient';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export async function getPrinters(propertyId) {
  if (!propertyId) return [];
  const { data, error } = await supabase.from('property_printers').select('*').eq('property_id', propertyId).order('created_at');
  if (error) throw error;
  return data || [];
}

export async function getAssignments(propertyId) {
  if (!propertyId) return [];
  const { data, error } = await supabase.from('printer_assignments').select('*, property_printers(*)').eq('property_id', propertyId).order('created_at');
  if (error) throw error;
  return data || [];
}

async function logPrint(propertyId, printerId, jobType, copyType, status, errorMessage = null) {
  if (!propertyId) return;
  try {
    await supabase.from('print_logs').insert({
      property_id: propertyId,
      printer_id: printerId || null,
      job_type: jobType,
      copy_type: copyType || null,
      status,
      error_message: errorMessage,
    });
  } catch (error) {
    console.warn('[printService] failed to write print log', error);
  }
}

async function printWindow(contentHtml, title = 'OliTechs Print') {
  if (typeof document === 'undefined') return { ok: false, friendlyError: 'Printing is not available in this environment.' };
  const css = `@page { size: 80mm auto; margin: 0; } * { box-sizing: border-box; } body { width: 80mm; margin: 0; padding: 4mm; background:#fff; color:#000; font-family: Arial, Helvetica, sans-serif; font-size:11px; line-height:1.35; } .receipt { width:100%; } .center{text-align:center}.right{text-align:right}.bold{font-weight:800}.muted{color:#444}.divider{border-top:1px dashed #000;margin:8px 0}.cut{border-top:1px dashed #000;margin:16px 0 12px;text-align:center;font-size:9px}.logo{max-width:42mm;max-height:18mm;object-fit:contain;margin:0 auto 4px;display:block}.items{width:100%;border-collapse:collapse}.items td{padding:2px 0;vertical-align:top}.qty{width:10mm}.amount{text-align:right;white-space:nowrap}.section{font-weight:800;text-align:center;margin:7px 0 4px}.total{font-size:16px;font-weight:900;border-top:1px solid #000;padding-top:6px;margin-top:8px}.footer{margin-top:10px;text-align:center;font-size:10px}.copy{font-size:10px;font-weight:800;text-align:center;border:1px solid #000;padding:3px;margin-bottom:7px}`;
  const frame = document.createElement('iframe');
  frame.setAttribute('title', title);
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) { frame.remove(); return { ok: false, friendlyError: 'The print document could not be created.' }; }
  win.document.open();
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>${css}</style></head><body>${contentHtml}</body></html>`);
  win.document.close();
  const cleanup = () => setTimeout(() => frame.remove(), 300);
  try {
    win.onafterprint = cleanup;
    await new Promise((resolve) => setTimeout(resolve, 50));
    win.focus();
    win.print();
    cleanup();
    return { ok: true };
  } catch (error) {
    frame.remove();
    return { ok: false, friendlyError: 'The system print dialog could not be opened.', rawError: String(error?.message || error) };
  }
}

export async function printToPrinter(printer, contentHtml, { propertyId, jobType = 'document', copyType = null, title = 'OliTechs Print' } = {}) {
  if (!printer) return { ok: false, friendlyError: 'Printer not configured.' };
  // MVP: every configured connection uses the system dialog. IP/USB/Bluetooth
  // details are persisted now so a print-agent / ESC-POS transport can be added
  // without changing assignment data.
  const result = await printWindow(contentHtml, title);
  await logPrint(propertyId, printer.id, jobType, copyType, result.ok ? 'printed' : 'failed', result.friendlyError || null);
  return result;
}

export async function testPrint(printer, propertyId) {
  const now = new Date();
  const html = `<div class="receipt center"><div class="bold">Test Print - ${esc(printer.name)} - OK - ${esc(now.toLocaleString('en-KE'))}</div></div>`;
  return printToPrinter(printer, html, { propertyId, jobType: 'test', title: `Test Print - ${printer.name}` });
}

const itemIsDrink = (item) => {
  const category = String(item?.category || '').toLowerCase();
  return category === 'drinks' || category === 'drink' || category === 'bibite' || String(item?.center || '').toLowerCase() === 'bar';
};

function orderTicketHtml(order, kind, items) {
  const title = kind === 'food' ? 'KITCHEN ORDER' : 'BAR ORDER';
  const rows = items.map((item) => `<tr><td class="qty">${esc(item.qty)}x</td><td>${esc(item.name)}</td></tr>`).join('');
  return `<div class="receipt"><div class="copy">${title}</div><div class="bold">Table: ${esc(order.table || order.tableNumber || '')}</div><div>Waiter: ${esc(order.waiter || 'Unassigned')}</div><div>Time: ${esc(new Date(order.createdAt || Date.now()).toLocaleString('en-KE'))}</div><div class="divider"></div><table class="items">${rows}</table><div class="divider"></div><div class="muted">Check No: ${esc(order.checkNo || order.orderNumber || '')}</div></div>`;
}

export async function printOrderByCategory(order) {
  const propertyId = order.propertyId;
  const printers = await getPrinters(propertyId);
  const assignments = await getAssignments(propertyId);
  const food = (order.items || []).filter((item) => !itemIsDrink(item));
  const drinks = (order.items || []).filter(itemIsDrink);
  const groups = [
    { type: 'food_orders', kind: 'food', items: food },
    { type: 'drinks_orders', kind: 'drinks', items: drinks },
  ];
  const results = [];
  for (const group of groups) {
    if (!group.items.length) continue;
    const targets = assignments.filter((a) => a.assignment_type === group.type).map((a) => printers.find((p) => p.id === a.printer_id)).filter(Boolean);
    if (!targets.length) {
      results.push({ ok:false, assignmentType:group.type, friendlyError:`No printer assigned to ${group.type}.` });
      continue;
    }
    for (const printer of targets) {
      results.push(await printToPrinter(printer, orderTicketHtml(order, group.kind, group.items), { propertyId, jobType: group.kind === 'food' ? 'KOT' : 'BOT', title: group.kind === 'food' ? 'Kitchen Order' : 'Bar Order' }));
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

function receiptHtml(settings, type, data, copyType) {
  const items = data.items || [];
  const food = items.filter((i) => !itemIsDrink(i));
  const drinks = items.filter(itemIsDrink);
  const rows = (list) => list.map((i) => `<tr><td class="qty">${esc(i.qty)}x</td><td>${esc(i.name)}</td><td class="amount">${esc(data.currency || '')} ${(Number(i.qty || 0) * Number(i.price || 0)).toFixed(2)}</td></tr>`).join('');
  const itemMarkup = food.length && drinks.length
    ? `<div class="section">--- FOOD ---</div><table class="items">${rows(food)}</table><div class="section">--- DRINKS ---</div><table class="items">${rows(drinks)}</table>`
    : `<table class="items">${rows(food.length ? food : drinks)}</table>`;
  const logo = settings.logo_url ? `<img class="logo" src="${esc(settings.logo_url)}" alt="">` : '';
  const title = type === 'UNSETTLED' ? 'UNSETTLED RECEIPT' : 'FINAL RECEIPT';
  const payment = type === 'RECEIPT' ? `<div class="divider"></div><div>Payment Method: <b>${esc(data.paymentMethod || '—')}</b></div>` : '';
  const total = Number(data.total || 0).toFixed(2);
  return `<div class="receipt"><div class="copy">${esc(copyType)}</div>${logo}<div class="center bold">${esc(settings.property_name)}</div><div class="center">${esc(settings.address_line1)}<br>${esc(settings.address_line2)}<br>${esc(settings.phone)}<br>${esc(settings.email)}<br>${esc(settings.website)}<br>KRA PIN: ${esc(settings.kra_pin)}${settings.extra_header_line ? `<br>${esc(settings.extra_header_line)}` : ''}</div><div class="divider"></div><div class="center bold">${title}</div><div>Waiter: ${esc(data.waiter || 'Unassigned')} &nbsp; Table: ${esc(data.table || '')}</div><div>Covers: ${esc(data.covers ?? '—')} &nbsp; Date: ${esc(new Date(data.createdAt || Date.now()).toLocaleString('en-KE'))}</div>${itemMarkup}<div class="total">TOTAL ${esc(data.currency || '')} ${total}</div>${payment}<div class="footer">${esc(settings.footer_line1)}<br>${esc(settings.footer_line2)}</div><div class="right bold">Check No: ${esc(data.checkNo || data.orderNumber || '')}</div></div>`;
}

export async function printReceipt(type, data) {
  const propertyId = data.propertyId;
  const settings = data.settings || await (async () => { const { data: row, error } = await supabase.from('property_settings').select('*').eq('property_id', propertyId).maybeSingle(); if(error) throw error; return row; })();
  if (!settings) return { ok:false, friendlyError:'Receipt company details are not configured.' };
  const assignmentType = type === 'UNSETTLED' ? 'unsettled_bills' : 'final_receipts';
  const printers = await getPrinters(propertyId);
  const assignments = await getAssignments(propertyId);
  const targets = assignments.filter((a) => a.assignment_type === assignmentType).map((a) => printers.find((p) => p.id === a.printer_id)).filter(Boolean);
  if (!targets.length) return { ok:false, friendlyError:`No printer assigned to ${assignmentType}.` };
  const copies = ['CUSTOMER COPY', type === 'UNSETTLED' ? 'FRONT OFFICE COPY' : 'CASHIER COPY'];
  const content = `<div class="receipt">${receiptHtml(settings, type, data, copies[0])}<div class="cut">✂ CUT HERE</div>${receiptHtml(settings, type, data, copies[1])}</div>`;
  const results = [];
  for (const printer of targets) results.push(await printToPrinter(printer, content, { propertyId, jobType: type, copyType:'duplicate', title:type === 'UNSETTLED' ? 'Unsettled Bill' : 'Final Receipt' }));
  return { ok: results.every((r) => r.ok), results };
}
