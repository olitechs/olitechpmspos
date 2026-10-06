import { testConnection as testBrowserPrinterConnection, pairUsbDevice, pairBluetoothDevice, pairSerialDevice, sendPrintJob as sendBrowserPrintJob, buildTestPageText, PrinterStatus } from '@/services/printerService';
import { supabase } from '@/lib/supabaseClient';

const normalizeNetworkEndpoint = (value, fallbackPort = 9100) => {
  let host = String(value || '').trim();
  let port = Number(fallbackPort || 9100);
  try {
    if (/^https?:\/\//i.test(host)) {
      const parsed = new URL(host);
      host = parsed.hostname;
      if (parsed.port) port = Number(parsed.port);
    } else if (/^[0-9.]+:\d+$/.test(host)) {
      const parts = host.split(':');
      host = parts[0];
      port = Number(parts[1]);
    }
  } catch (_) {}
  return { host, port };
};

const normalizeAgentUrl = (value = 'http://127.0.0.1:8631') => {
  let base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) base = 'http://127.0.0.1:8631';
  base = base.replace(/\/(?:api|print-agent)$/i, '');
  return base.replace(/\/+$/, '');
};

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

function htmlToThermalText(contentHtml) {
  if (typeof DOMParser === 'undefined') {
    return String(contentHtml || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const doc = new DOMParser().parseFromString(String(contentHtml || ''), 'text/html');
  return String(doc?.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function updatePrinterTransportStatus(printer, propertyId, status, errorMessage = null) {
  if (!printer?.id || !propertyId) return;
  try {
    const patch = {
      is_online: status === 'connected',
      last_status: status,
      last_error: errorMessage,
      last_tested_at: new Date().toISOString(),
    };
    if (status === 'connected') patch.last_connected_at = new Date().toISOString();
    await supabase.from('property_printers').update(patch).eq('id', printer.id).eq('property_id', propertyId);
  } catch (error) {
    console.warn('[printService] failed to update printer transport status', error);
  }
}

async function localAgentRequest(printer, propertyId, path, text = '') {
  const base = normalizeAgentUrl(printer.agent_url || printer.agentUrl);
  const endpoint = normalizeNetworkEndpoint(printer.ip_address || printer.host, printer.port || 9100);
  const payload = {
    ...endpoint,
    printerId: printer.id || null,
    propertyId: propertyId || null,
    windowsPrinterName: printer.windows_printer_name || null,
    text,
  };

  const paths = [path, '/api' + path, '/print-agent' + path];
  let last = null;

  for (const candidate of paths) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(base + candidate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) return { ok: true, data };

      last = {
        ok: false,
        code: data?.code || `HTTP_${response.status}`,
        message: data?.message || 'The local print agent could not print to the configured printer.',
      };

      if (![404, 405].includes(response.status) && data?.code !== 'NOT_FOUND') break;
    } catch (error) {
      last = {
        ok: false,
        code: error?.name === 'AbortError' ? 'LOCAL_AGENT_TIMEOUT' : 'LOCAL_AGENT_UNAVAILABLE',
        message: error?.name === 'AbortError'
          ? 'The local print agent timed out while connecting to the printer.'
          : 'The local print agent could not be reached. Start the OliTechs Print Agent on this workstation.',
      };
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  return last || {
    ok: false,
    code: 'LOCAL_AGENT_UNAVAILABLE',
    message: 'The local print agent could not be reached. Start the OliTechs Print Agent on this workstation.',
  };
}

async function directAgentPrint(printer, propertyId, text, path) {
  const result = await localAgentRequest(printer, propertyId, path, text);
  if (!result.ok) {
    const code = result.code || 'LOCAL_AGENT_ERROR';
    const friendly = `[${code}] ${result.message}`;
    await updatePrinterTransportStatus(printer, propertyId, 'offline', friendly);
    return { ok:false, friendlyError:friendly, code, transport:'local_agent' };
  }
  await updatePrinterTransportStatus(printer, propertyId, 'connected', null);
  return { ok:true, status:'connected', direct:true, transport:'local_agent' };
}

async function directTcpPrint(printer, propertyId, text, action = 'print') {
  const endpoint = normalizeNetworkEndpoint(printer?.ip_address || printer?.host, printer?.port || 9100);
  const host = endpoint.host;
  if (!host) return { ok:false, friendlyError:'Printer IP address is not configured.' };
  const port = endpoint.port;
  if (!Number.isInteger(port) || ![9100,9101,9102].includes(port)) {
    return { ok:false, friendlyError:'Unsupported thermal printer port. Use TCP 9100, 9101 or 9102.' };
  }
  return directAgentPrint(printer, propertyId, text, action === 'test' ? '/test' : '/print');
}

async function directWindowsPrint(printer, propertyId, text, action = 'print') {
  if (!printer.windows_printer_name) {
    return { ok:false, friendlyError:'Select a Windows-installed printer first.' };
  }
  return directAgentPrint(printer, propertyId, text, action === 'test' ? '/windows-test' : '/windows-print');
}

function browserPrinterShape(printer) {
  return {
    ...printer,
    connectionType:
      printer.connection_type === 'usb' ? 'usb' :
      printer.connection_type === 'bluetooth' ? 'bluetooth' :
      printer.connection_type === 'serial' ? 'serial' :
      'network',
    host: printer.ip_address || '',
    agentUrl: printer.agent_url || 'http://127.0.0.1:8631',
    baudRate: Number(printer.baud_rate || 9600),
    status: PrinterStatus.CONNECTED,
  };
}

export async function testPrinterConnection(printer, propertyId) {
  if (!printer) return { ok: false, friendlyError: 'Printer not configured.' };
  try {
    let result;
    if (printer.connection_type === 'network_ip') {
      result = await directTcpPrint(printer, propertyId, '', 'test');
    } else if (printer.connection_type === 'windows_printer') {
      result = await directWindowsPrint(printer, propertyId, '', 'test');
    } else if (['usb','bluetooth','serial'].includes(printer.connection_type)) {
      const browser = browserPrinterShape(printer);
      const connection = await testBrowserPrinterConnection(browser);
      if (connection.status === PrinterStatus.CONNECTED) {
        const printed = await sendBrowserPrintJob(browser, buildTestPageText(browser), { thermal:true, title:'OliTechs Printer Test' });
        result = {
          ok: !!printed?.ok,
          status: printed?.ok ? PrinterStatus.CONNECTED : PrinterStatus.FAILED,
          friendlyError: printed?.friendlyError,
          transport: printer.connection_type,
        };
      } else {
        result = {
          ok:false,
          status:connection.status,
          friendlyError:connection.friendlyError,
          transport: printer.connection_type,
        };
      }
      await updatePrinterTransportStatus(printer, propertyId, result.ok ? 'connected' : 'offline', result.friendlyError || null);
    } else {
      result = { ok:false, friendlyError:'Unsupported printer connection type.' };
    }
    if (result.ok) {
      await logPrint(propertyId, printer.id, 'test', 'connection', 'printed', null);
    } else {
      await logPrint(propertyId, printer.id, 'test', 'connection', 'failed', result.friendlyError || null);
    }
    return result;
  } catch (error) {
    // A logging/database/transport exception must never strand the printer UI
    // in its "Testing…" state.
    const friendlyError = error?.message || 'Printer verification failed unexpectedly.';
    try {
      await updatePrinterTransportStatus(printer, propertyId, 'offline', friendlyError);
      await logPrint(propertyId, printer.id, 'test', 'connection', 'failed', friendlyError);
    } catch (_) {
      // Keep the original failure; status persistence is best effort.
    }
    return {
      ok: false,
      friendlyError,
      code: 'PRINTER_TEST_FAILED',
    };
  }
}

export async function printToPrinter(printer, contentHtml, { propertyId, jobType = 'document', copyType = null, title = 'OliTechs Print' } = {}) {
  if (!printer) return { ok: false, friendlyError: 'Printer not configured.' };
  const text = htmlToThermalText(contentHtml);
  let result;
  if (printer.connection_type === 'network_ip') {
    result = await directTcpPrint(printer, propertyId, text, 'print');
  } else if (printer.connection_type === 'windows_printer') {
    result = await directWindowsPrint(printer, propertyId, text, 'print');
  } else if (['usb','bluetooth','serial'].includes(printer.connection_type)) {
    const transport = browserPrinterShape(printer);
    const verified = await testBrowserPrinterConnection(transport);
    if (verified.status !== PrinterStatus.CONNECTED) {
      result = { ok:false, friendlyError:verified.friendlyError || 'The physical printer is no longer connected to this browser session.' };
      await updatePrinterTransportStatus(printer, propertyId, 'offline', result.friendlyError);
    } else {
      result = await sendBrowserPrintJob(transport, text, { thermal:true, title });
      await updatePrinterTransportStatus(printer, propertyId, result.ok ? 'connected' : 'offline', result.friendlyError || null);
    }
  } else {
    result = { ok:false, friendlyError:'Unsupported printer connection type.' };
  }
  await logPrint(propertyId, printer.id, jobType, copyType, result.ok ? 'printed' : 'failed', result.friendlyError || null);
  return result;
}

export async function connectPrinter(printer, propertyId) {
  if (!printer) return { ok:false, friendlyError:'Printer not configured.' };
  try {
    let result;
    if (printer.connection_type === 'usb') result = await pairUsbDevice(browserPrinterShape(printer));
    else if (printer.connection_type === 'bluetooth') result = await pairBluetoothDevice(browserPrinterShape(printer));
    else if (printer.connection_type === 'serial') result = await pairSerialDevice(browserPrinterShape(printer));
    else if (printer.connection_type === 'windows_printer') {
      const base = normalizeAgentUrl(printer.agent_url);
      const response = await fetch(`${base}/windows-printers`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Unable to read Windows installed printers.');
      const exists = (data.printers || []).some(p => p.Name === printer.windows_printer_name);
      result = exists ? {ok:true} : {ok:false, friendlyError:'The selected Windows printer is not installed on this POS computer.'};
    } else {
      return testPrinterConnection(printer, propertyId);
    }
    if (result?.ok) await updatePrinterTransportStatus(printer, propertyId, 'connected', null);
    else await updatePrinterTransportStatus(printer, propertyId, 'offline', result?.friendlyError || null);
    return result;
  } catch (error) {
    const friendlyError = error?.message || 'Unable to connect to the printer.';
    await updatePrinterTransportStatus(printer, propertyId, 'offline', friendlyError);
    return {ok:false, friendlyError};
  }
}

export async function testPrint(printer, propertyId) {
  return testPrinterConnection(printer, propertyId);
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
  const groups = [{ type: 'food_orders', kind: 'food', items: food }, { type: 'drinks_orders', kind: 'drinks', items: drinks }];
  const results = [];
  for (const group of groups) {
    if (!group.items.length) continue;
    const targets = assignments.filter((a) => a.assignment_type === group.type).map((a) => printers.find((p) => p.id === a.printer_id)).filter(Boolean);
    if (!targets.length) { results.push({ ok:false, assignmentType:group.type, friendlyError:`No printer assigned to ${group.type}.` }); continue; }
    for (const printer of targets) results.push(await printToPrinter(printer, orderTicketHtml(order, group.kind, group.items), { propertyId, jobType: group.kind === 'food' ? 'KOT' : 'BOT', title: group.kind === 'food' ? 'Kitchen Order' : 'Bar Order' }));
  }
  return { ok: results.every((r) => r.ok), results };
}


function voidTicketHtml(data) {
  const area = String(data.category || '').toLowerCase() === 'drinks' ? 'BAR' : 'KITCHEN';
  const stamp = data.timestamp ? new Date(data.timestamp).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  return `<div class="receipt">
    <div style="background:#DC2626;color:#fff;padding:10px 4px;text-align:center;font-size:18px;font-weight:900;line-height:1.15">!!! VOID / CANCELLATION !!!<br><span style="font-size:13px">${esc(area)}</span></div>
    <div class="divider"></div>
    <div class="bold">Table: ${esc(data.tableNo || '—')} &nbsp;&nbsp; Waiter: ${esc(data.waiterName || '—')}</div>
    <div>Date: ${esc(stamp)}</div>
    <div>Check No: ${esc(data.checkNo || '—')}</div>
    <div class="divider"></div>
    <div class="bold" style="font-size:14px">VOID ITEM:</div>
    <div style="margin-top:6px;font-size:13px;font-weight:800">- ${esc(data.item || 'Item')} x ${esc(data.removedQty)}</div>
    <div style="margin-top:3px">Qty Removed: <b>${esc(data.removedQty)}</b></div>
    <div>Reason: <b>${esc(data.reason || 'Not specified')}</b></div>
    <div>Removed by: <b>${esc(data.removedBy || '—')}</b></div>
    <div>Original: <b>${esc(data.originalQty)}</b> -&gt; Removed: <b>${esc(data.removedQty)}</b> -&gt; Remaining: <b>${esc(data.newQty)}</b></div>
    <div class="divider"></div>
    <div class="center bold" style="font-size:10px">CUSTOMER COPY? NO - ${esc(area)} CONTROL ONLY</div>
    <div class="center bold" style="font-size:10px;margin-top:4px">Cashier Copy - Keep for Audit</div>
    <div class="divider"></div>
    <div class="footer bold">Requires Manager Signature __________________</div>
  </div>`;
}

export async function printVoidTicket(printer, data = {}) {
  if (!printer) return { ok:false, friendlyError:'Void printer not configured.' };
  const propertyId = data.propertyId;
  const result = await printToPrinter(
    printer,
    voidTicketHtml(data),
    { propertyId, jobType:'void', copyType:'control', title:`VOID / CANCELLATION - ${String(data.category || 'food').toUpperCase()}` }
  );

  if (data.voidId && propertyId) {
    const patch = {
      status: result.ok ? 'printed' : 'failed',
      printer_id: printer.id || null,
    };
    await supabase.from('pos_void_items').update(patch).eq('id', data.voidId).eq('property_id', propertyId);
    if (result.ok) {
      const { data: audits } = await supabase.from('pos_order_audit').select('id,details').eq('property_id', propertyId).contains('details', { void_id: data.voidId }).order('created_at', { ascending:false }).limit(1);
      const audit = audits?.[0];
      if (audit) {
        await supabase.from('pos_order_audit').update({
          details: { ...(audit.details || {}), printer_id: printer.id || null, void_printed: true }
        }).eq('id', audit.id);
      }
    }
  }
  return result;
}

function receiptHtml(settings, type, data, copyType) {
  const items = data.items || [];
  const food = items.filter((i) => !itemIsDrink(i));
  const drinks = items.filter(itemIsDrink);
  const rows = (list) => list.map((i) => { const modifiers = Array.isArray(i.modifiers) ? i.modifiers : []; const modifierText = modifiers.length ? `<div style="font-size:9px;margin-left:4px">+ ${esc(modifiers.map((m) => m.name).join(' · '))}</div>` : ''; return `<tr><td class="qty">${esc(i.qty)}x</td><td>${esc(i.name)}${modifierText}</td><td class="amount">${esc(data.currency || '')} ${(Number(i.qty || 0) * Number(i.price || 0)).toFixed(2)}</td></tr>`; }).join('');
  const itemMarkup = food.length && drinks.length
    ? `<div class="section">--- FOOD ---</div><table class="items">${rows(food)}</table><div class="section">--- DRINKS ---</div><table class="items">${rows(drinks)}</table>`
    : `<table class="items">${rows(food.length ? food : drinks)}</table>`;
  const logo = settings.logo_url ? `<img class="logo" src="${esc(settings.logo_url)}" alt="">` : '';
  const title = type === 'UNSETTLED' ? (settings.unsettled_receipt_title || 'UNSETTLED RECEIPT') : 'FINAL RECEIPT';
  const payment = type === 'RECEIPT' ? `<div class="divider"></div><div>Payment Method: <b>${esc(data.paymentMethod || '—')}</b></div>` : '';
  const total = Number(data.total || 0).toFixed(2);
  return `<div class="receipt"><div class="copy">${esc(copyType)}</div>${logo}<div class="center bold">${esc(settings.property_name)}</div><div class="center">${esc(settings.address_line1)}<br>${esc(settings.address_line2)}<br>${esc(settings.phone)}<br>${esc(settings.email)}<br>${esc(settings.website)}<br>KRA PIN: ${esc(settings.kra_pin)}${settings.extra_header_line ? `<br>${esc(settings.extra_header_line)}` : ''}</div><div class="divider"></div><div class="center bold">${esc(title)}</div><div>Waiter: ${esc(data.waiter || 'Unassigned')} &nbsp; Table: ${esc(data.table || '')}</div><div>Covers: ${esc(data.covers ?? '—')} &nbsp; Date: ${esc(new Date(data.createdAt || Date.now()).toLocaleString('en-KE'))}</div>${itemMarkup}<div class="total">TOTAL ${esc(data.currency || '')} ${total}</div>${payment}<div class="footer">${esc(settings.footer_line1)}<br>${esc(settings.footer_line2)}</div><div class="right bold">Check No: ${esc(data.checkNo || data.orderNumber || '')}</div>${data.voidedCount ? `<div class="divider"></div><div class="center bold" style="font-size:9px">${esc(data.voidedCount)} item${Number(data.voidedCount)===1?'':'s'} voided - See void slip #${esc(data.voidSlipNumber || '—')}</div>` : ''} </div>`;
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
  const copyCount = type === 'UNSETTLED' ? Math.max(1, Math.min(2, Number(settings.unsettled_receipt_copy_count || 2))) : 2;
  const copies = type === 'UNSETTLED'
    ? (copyCount === 1 ? ['CUSTOMER COPY'] : ['CUSTOMER COPY', settings.unsettled_receipt_front_office_copy === false ? 'SECOND COPY' : 'FRONT OFFICE COPY'])
    : ['CUSTOMER COPY', 'CASHIER COPY'];
  const receiptCopies = copies.map((copy) => receiptHtml(settings, type, data, copy));
  const content = `<div class="receipt">${receiptCopies.join('<div class="cut">✂ CUT HERE</div>')}</div>`;
  const results = [];
  for (const printer of targets) results.push(await printToPrinter(printer, content, { propertyId, jobType: type, copyType:'duplicate', title:type === 'UNSETTLED' ? 'Unsettled Bill' : 'Final Receipt' }));
  return { ok: results.every((r) => r.ok), results };
}

function shiftReportHtml(data, copyLabel) {
  const p = data.payments || {};
  const money = (n) => Number(n || 0).toLocaleString('en-KE',{minimumFractionDigits:2});
  const row = (label, key) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(label)}</span><span>${money(p[key]?.amount)} (${esc(p[key]?.count || 0)} txns)</span></div>`;
  const stamp = data.shift?.closed_at ? new Date(data.shift.closed_at).toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'}) : new Date().toLocaleString('en-KE',{dateStyle:'medium',timeStyle:'short'});
  return `<div class="receipt"><div class="copy">${esc(copyLabel)}</div>${data.settings?.logo_url ? `<img class="logo" src="${esc(data.settings.logo_url)}">` : ''}<div class="center bold">${esc(data.settings?.property_name || data.propertyName || 'OLITECHS PMS & POS')}</div><div class="center">${esc(data.settings?.address_line1 || '')}<br>${esc(data.settings?.address_line2 || '')}<br>${esc(data.settings?.phone || '')}</div><div class="divider"></div><div class="center bold" style="font-size:15px">SHIFT CLOSING REPORT</div><div>Shift No: <b>${esc(data.shift?.shift_no)}</b></div><div>Date: ${esc(new Date(data.shift?.date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}))}</div><div>Opened by: ${esc(data.openedBy || 'Staff')}</div><div>Opened at: ${esc(data.shift?.opened_at ? new Date(data.shift.opened_at).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'}) : '—')}</div><div>Closed by: ${esc(data.closedBy || 'Staff')}</div><div>Closed at: ${esc(stamp)}</div><div class="divider"></div><div class="bold">OPENING CASH (Float): KES ${money(data.shift?.opening_cash)}</div><div class="section">SALES BREAKDOWN</div>${row('Cash','cash')}${row('M-Pesa','mpesa')}${row('Card Payment','card')}${row('Bank Transfer','bank')}${row('Room Charge','room_charge')}${row('Other','other')}<div class="total">TOTAL SALES: KES ${money(data.totalSales)}</div><div>TOTAL TRANSACTIONS: ${esc(data.totalTransactions || 0)}</div><div class="divider"></div><div>Less: Opening Cash: - KES ${money(data.shift?.opening_cash)}</div><div class="bold">NET CASH EXPECTED IN DRAWER: KES ${money(data.expectedCash)}</div><div>Cash Entered: KES ${money(data.countedCash)}</div><div>Variance: KES ${money(data.variance)}</div><div>Room Charges Total: KES ${money(p.room_charge?.amount)}</div><div class="divider"></div><div class="section">PAYMENT SUMMARY</div>${row('Cash','cash')}${row('Card','card')}${row('M-Pesa','mpesa')}${row('Bank','bank')}${row('Room','room_charge')}<div class="divider"></div><div class="footer">Thank you<br>Shift closed at ${esc(stamp)}<br>Generated by Olitech PMS POS</div><div class="right bold" style="font-size:9px">Report ID: ${esc(data.reportId || ('RPT-'+String(data.shift?.id || '').slice(0,8).toUpperCase()))}</div><div class="divider"></div><div style="margin-top:10px">Cashier Signature: __________________</div><div style="margin-top:12px">Manager Signature: __________________</div></div>`;
}

export async function printShiftReport(shiftData, printer) {
  if (!printer) return {ok:false,friendlyError:'Shift report printer not configured.'};
  const propertyId=shiftData.propertyId;
  const first=await printToPrinter(printer,shiftReportHtml(shiftData,'CASHIER COPY'),{propertyId,jobType:'shift_report',copyType:'cashier',title:'Shift Closing Report'});
  const second=await printToPrinter(printer,shiftReportHtml(shiftData,'MANAGER / ACCOUNTANT COPY'),{propertyId,jobType:'shift_report',copyType:'manager',title:'Shift Closing Report'});
  return {ok:first.ok&&second.ok,results:[first,second]};
}