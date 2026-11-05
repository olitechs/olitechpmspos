import { testConnection as testBrowserPrinterConnection, pairUsbDevice, pairBluetoothDevice, pairSerialDevice, sendPrintJob as sendBrowserPrintJob, buildTestPageText, PrinterStatus } from '@/services/printerService';
import { supabase } from '@/lib/supabaseClient';
import { buildOrderTicketText, buildUnsettledReceiptText, buildFinalReceiptText, toEscPosPayload, thermalTextToHtml } from '@/services/printTemplates';

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
  const { data, error } = await supabase.from('printer_assignments').select('*, property_printers!printer_assignments_property_printer_fk(*)').eq('property_id', propertyId).order('created_at');
  if (error) throw error;
  return data || [];
}

async function resolveRetryPrinter(job, propertyId) {
  if (!propertyId) return null;
  const printers = await getPrinters(propertyId);
  const assignments = await getAssignments(propertyId);
  const original = job?.printer_id ? printers.find((printer) => printer.id === job.printer_id) : null;
  const fallbackIds = assignments
    .filter((assignment) => assignment.assignment_type === job?.assignment_type)
    .map((assignment) => assignment.printer_id);
  const assignedPrinters = fallbackIds
    .map((id) => printers.find((printer) => printer.id === id))
    .filter(Boolean);
  // Prefer the original target when it has a verified live connection. If it
  // is offline, fail over to another assigned printer that has been verified
  // connected; only retry the original as a last resort when no fallback is
  // known to be online.
  if (original && original.is_online !== false && original.last_status === 'connected') return original;
  const fallback = assignedPrinters.find((printer) =>
    printer.id !== original?.id && printer.is_online === true && printer.last_status === 'connected'
  );
  return fallback || original || assignedPrinters.find((printer) => printer.is_online !== false) || null;
}

// PostgreSQL text/JSONB cannot store NUL or unpaired UTF-16 surrogates.
// Keep normal Unicode (including emoji) and printable text, but strip control
// bytes before persisting HTML/JSON. Raw ESC/POS bytes stay in thermalText and
// are sent directly to the printer; they are never needed in the job record.
function sanitizeDatabaseValue(value) {
  if (typeof value === 'string') {
    let clean = '';
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint === 0 || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) continue;
      if ((codePoint >= 0x01 && codePoint <= 0x08) || codePoint === 0x0B || codePoint === 0x0C || (codePoint >= 0x0E && codePoint <= 0x1F)) continue;
      clean += character;
    }
    return clean;
  }
  if (Array.isArray(value)) return value.map(sanitizeDatabaseValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [sanitizeDatabaseValue(key), sanitizeDatabaseValue(nested)]));
  }
  return value;
}

async function createFnbPrintJob({propertyId,printerId,assignmentType,jobType,copyType=null,title='',contentHtml='',payload={},retryOf=null}) {
  if (!propertyId) return null;
  const {data,error}=await supabase.from('fnb_print_jobs').insert({
    property_id:propertyId, printer_id:printerId||null, assignment_type:assignmentType||'document',
    job_type:jobType||'document', copy_type:copyType, title:title||'OliTechs Print',
    content_html:sanitizeDatabaseValue(String(contentHtml||'')), payload:sanitizeDatabaseValue(payload||{}), retry_of:retryOf||null,
    created_by:(await supabase.auth.getUser()).data?.user?.id||null, status:'queued'
  }).select().single();
  if(error) throw error;
  return data;
}
async function updateFnbPrintJob(jobId,propertyId,status,errorMessage=null,printerId=null){
  if(!jobId||!propertyId) return null;
  const {data,error}=await supabase.rpc('fn_update_fnb_print_job',{
    p_property_id:propertyId,p_job_id:jobId,p_status:status,p_error_message:errorMessage,p_printer_id:printerId
  });
  if(error) throw error;
  return data;
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

async function localAgentRequest(printer, propertyId, path, text = '', escposBase64 = null) {
  const base = normalizeAgentUrl(printer.agent_url || printer.agentUrl);
  const endpoint = normalizeNetworkEndpoint(printer.ip_address || printer.host, printer.port || 9100);
  const payload = {
    ...endpoint,
    printerId: printer.id || null,
    propertyId: propertyId || null,
    windowsPrinterName: printer.windows_printer_name || null,
    text,
    ...(escposBase64 ? { escposBase64 } : {}),
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

async function directAgentPrint(printer, propertyId, text, path, escposBase64 = null) {
  const result = await localAgentRequest(printer, propertyId, path, text, escposBase64);
  if (!result.ok) {
    const code = result.code || 'LOCAL_AGENT_ERROR';
    const friendly = `[${code}] ${result.message}`;
    await updatePrinterTransportStatus(printer, propertyId, 'offline', friendly);
    return { ok:false, friendlyError:friendly, code, transport:'local_agent' };
  }
  await updatePrinterTransportStatus(printer, propertyId, 'connected', null);
  return { ok:true, status:'connected', direct:true, transport:'local_agent' };
}

/**
 * Send the ESC/POS drawer pulse through the local agent. Only raw network
 * printers are eligible: a drawer command must never be sent to an arbitrary
 * browser device or guessed Windows printer.
 */
export async function openCashDrawer(printer, propertyId) {
  if (!printer || printer.connection_type !== 'network_ip') {
    return { ok:false, friendlyError:'Automatic cash drawer opening requires a configured LAN thermal printer.' };
  }
  const endpoint = normalizeNetworkEndpoint(printer.ip_address || printer.host, printer.port || 9100);
  if (!endpoint.host || !Number.isInteger(endpoint.port) || ![9100,9101,9102].includes(endpoint.port)) {
    return { ok:false, friendlyError:'The cash drawer printer IP address or TCP port is invalid.' };
  }
  const result = await localAgentRequest(printer, propertyId, '/open-drawer');
  if (!result.ok) {
    const message = result.message || 'The cash drawer command could not be sent.';
    await logPrint(propertyId, printer.id, 'cash_drawer', 'after_sale', 'failed', message);
    return { ok:false, code:result.code, friendlyError:message };
  }
  await logPrint(propertyId, printer.id, 'cash_drawer', 'after_sale', 'sent', null);
  return { ok:true, transport:'local_agent', printerId:printer.id || null };
}

async function directTcpPrint(printer, propertyId, text, action = 'print', escposBase64 = null) {
  const endpoint = normalizeNetworkEndpoint(printer?.ip_address || printer?.host, printer?.port || 9100);
  const host = endpoint.host;
  if (!host) return { ok:false, friendlyError:'Printer IP address is not configured.' };
  const port = endpoint.port;
  if (!Number.isInteger(port) || ![9100,9101,9102].includes(port)) {
    return { ok:false, friendlyError:'Unsupported thermal printer port. Use TCP 9100, 9101 or 9102.' };
  }
  return directAgentPrint(printer, propertyId, text, action === 'test' ? '/test' : '/print', escposBase64);
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

export async function printToPrinter(printer, contentHtml, { propertyId, jobType = 'document', copyType = null, title = 'OliTechs Print', assignmentType = 'document', payload = {}, retryOf = null, persistJob = true, thermalText = null, thermalBase64 = null } = {}) {
  if (!printer) return { ok: false, friendlyError: 'Printer not configured.' };
  const text = typeof thermalText === 'string' ? thermalText : htmlToThermalText(contentHtml);
  let job = null;
  if (persistJob && propertyId) { job = await createFnbPrintJob({propertyId,printerId:printer.id,assignmentType,jobType,copyType,title,contentHtml,payload,retryOf}); await updateFnbPrintJob(job.id,propertyId,'printing',null,printer.id); }
  let result;
  if (printer.connection_type === 'network_ip') {
    result = await directTcpPrint(printer, propertyId, text, 'print', thermalBase64);
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
  if (job) { try { await updateFnbPrintJob(job.id,propertyId,result.ok?'printed':'failed',result.friendlyError||null,printer.id); } catch (e) { console.warn('[printService] failed to update durable print job',e); } }
  return {...result,jobId:job?.id||null,printerId:printer.id||null,printerName:printer.name||null,assignmentType};
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

function orderTicketHtml(order, kind, items, printer = {}, settings = {}) {
  const thermalText = buildOrderTicketText(order, {
    printer,
    settings,
    center: kind === 'food' ? 'KITCHEN' : 'BAR',
    items,
  });
  return thermalTextToHtml(thermalText);
}

export async function printOrderByCategory(order) {
  const propertyId = order.propertyId;
  const [printers, assignments, settingsResult] = await Promise.all([
    getPrinters(propertyId),
    getAssignments(propertyId),
    supabase.from('property_settings').select('*').eq('property_id', propertyId).maybeSingle(),
  ]);
  if (settingsResult.error) throw settingsResult.error;
  const settings = settingsResult.data || {};
  const food = (order.items || []).filter((item) => !itemIsDrink(item));
  const drinks = (order.items || []).filter(itemIsDrink);
  const groups = [{ type: 'food_orders', kind: 'food', items: food }, { type: 'drinks_orders', kind: 'drinks', items: drinks }];
  const results = [];
  for (const group of groups) {
    if (!group.items.length) continue;
    const targets = assignments.filter((a) => a.assignment_type === group.type).map((a) => printers.find((p) => p.id === a.printer_id)).filter(Boolean).filter((p,i,a) => a.findIndex((x) => x.id === p.id) === i);
    if (!targets.length) {
      const queued = await createFnbPrintJob({
        propertyId, printerId:null, assignmentType:group.type,
        jobType:group.kind === 'food' ? 'KOT' : 'BOT',
        title:group.kind === 'food' ? 'Kitchen Order' : 'Bar Order',
        contentHtml:orderTicketHtml(order,group.kind,group.items,{},settings),
        payload:{orderNumber:order.orderNumber||order.checkNo||null,table:order.table||order.tableNumber||null}
      });
      await updateFnbPrintJob(queued.id,propertyId,'failed',`No printer assigned to ${group.type}.`,null);
      results.push({ ok:false, assignmentType:group.type, jobId:queued.id, printerId:null, printerName:null, friendlyError:`No printer assigned to ${group.type}.` });
      continue;
    }
    for (const printer of targets) {
      const thermalText = buildOrderTicketText(order, {
        printer,
        settings,
        center: group.kind === 'food' ? 'KITCHEN' : 'BAR',
        items: group.items,
      });
      results.push(await printToPrinter(printer, thermalTextToHtml(thermalText), {
        propertyId,
        jobType: group.kind === 'food' ? 'KOT' : 'BOT',
        assignmentType: group.type,
        payload: { orderNumber: order.orderNumber || order.checkNo || null, table: order.table || order.tableNumber || null },
        title: group.kind === 'food' ? 'Kitchen Order' : 'Bar Order',
        thermalText,
      }));
    }
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

function refundTicketHtml(data = {}) {
  const money = Number(data.amount || 0).toFixed(2);
  return `<div class="receipt"><div class="copy">REFUND CONTROL COPY</div>
  <div class="center bold">REFUND / REVERSAL</div>
  <div>Check No: ${esc(data.checkNo || data.orderNumber || '—')}</div>
  <div>Original Receipt: ${esc(data.receiptId || '—')}</div>
  <div>Payment Method: ${esc(data.method || '—')}</div>
  <div>Guest / Room: ${esc(data.guest || data.room || 'Walk-in')}</div>
  <div>Amount Refunded: <b>KES ${money}</b></div>
  <div>Reason: ${esc(data.reason || '—')}</div>
  <div>Approved By: ${esc(data.approvedBy || 'Manager')}</div>
  <div>Date: ${esc(new Date(data.createdAt || Date.now()).toLocaleString('en-KE'))}</div>
  <div class="divider"></div><div class="center bold">FINANCIAL REVERSAL — RETAIN WITH CASHIER RECORDS</div></div>`;
}

export async function printRefundSlip(printer, data = {}) {
  if (!printer) return { ok:false, friendlyError:'Refund printer not configured.' };
  return printToPrinter(printer, refundTicketHtml(data), {
    propertyId:data.propertyId, jobType:'refund', copyType:'control', assignmentType:'refund_slips', payload:{receiptId:data.receiptId||null,amount:data.amount||0}, title:'Refund / Reversal'
  });
}

export async function printVoidTicket(printer, data = {}) {
  if (!printer) return { ok:false, friendlyError:'Void printer not configured.' };
  const propertyId = data.propertyId;
  const result = await printToPrinter(
    printer,
    voidTicketHtml(data),
    { propertyId, jobType:'void', copyType:'control', assignmentType:data.category === 'drinks' ? 'void_drinks_orders' : 'void_food_orders', payload:{voidId:data.voidId||null,voidNumber:data.voidNumber||null}, title:`VOID / CANCELLATION - ${String(data.category || 'food').toUpperCase()}` }
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
  const logo = settings.logo_url ? `<img class="logo" src="${esc(settings.logo_url)}" alt="" style="display:block;max-width:160px;max-height:70px;margin:0 auto 8px;filter:grayscale(1) contrast(2)">` : '';
  const title = type === 'UNSETTLED' ? (settings.unsettled_receipt_title || 'UNSETTLED RECEIPT') : 'FINAL RECEIPT';
  const payment = type === 'RECEIPT' ? `<div class="divider"></div><div>Payment Method: <b>${esc(data.paymentMethod || '—')}</b></div>` : '';
  const total = Number(data.total || 0).toFixed(2);
  return `<div class="receipt"><div class="copy">${esc(copyType)}</div>${logo}<div class="center bold">${esc(settings.property_name)}</div><div class="center">${esc(settings.address_line1)}<br>${esc(settings.address_line2)}<br>${esc(settings.phone)}<br>${esc(settings.email)}<br>${esc(settings.website)}<br>KRA PIN: ${esc(settings.kra_pin)}${settings.extra_header_line ? `<br>${esc(settings.extra_header_line)}` : ''}</div><div class="divider"></div><div class="center bold">${esc(title)}</div><div>Waiter: ${esc(data.waiter || 'Unassigned')} &nbsp; Table: ${esc(data.table || '')}</div><div>Covers: ${esc(data.covers ?? '—')} &nbsp; Date: ${esc(new Date(data.createdAt || Date.now()).toLocaleString('en-KE'))}</div>${itemMarkup}<div class="total">TOTAL ${esc(data.currency || '')} ${total}</div>${payment}<div class="right bold">Receipt No: ${esc(data.receiptNumber || data.receipt_number || data.receiptId || 'RCT-' + (data.checkNo || data.orderNumber || ''))}</div><div class="right">Order No: ${esc(data.orderNumber || data.checkNo || '')}</div><div class="footer">${esc(settings.footer_line1)}<br>${esc(settings.footer_line2)}</div><div class="right bold">Check No: ${esc(data.checkNo || data.orderNumber || '')}</div>${data.voidedCount ? `<div class="divider"></div><div class="center bold" style="font-size:9px">${esc(data.voidedCount)} item${Number(data.voidedCount)===1?'':'s'} voided - See void slip #${esc(data.voidSlipNumber || '—')}</div>` : ''} </div>`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function buildLogoEscPosBase64(logoUrl, printer = {}, text = '', options = {}) {
  const singleBuffer = options.singleBuffer === true;
  const feedLines = Number(options.feedLines ?? 5);
  const fallbackTextBuffer = () => {
    if (!singleBuffer) return null;
    const bytes = new TextEncoder().encode(toEscPosPayload(text, { feedLines, partialCut: true }));
    return bytesToBase64(bytes);
  };
  if (!logoUrl || typeof Image === 'undefined' || typeof document === 'undefined') return fallbackTextBuffer();
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = logoUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Logo could not be loaded for thermal printing.'));
    });
    const paper = String(printer.paper_width || '80mm').toLowerCase();
    const standardWidth = paper === '58mm' ? 360 : 540;
    const maxWidth = singleBuffer ? Number(options.maxLogoDots || Math.floor(standardWidth * 0.6)) : standardWidth;
    const scale = Math.min(1, maxWidth / image.naturalWidth, 180 / image.naturalHeight);
    const width = Math.max(1, Math.floor(image.naturalWidth * scale));
    const height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallbackTextBuffer();
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const rowBytes = Math.ceil(width / 8);
    const raster = new Uint8Array(11 + rowBytes * height);
    raster.set([0x1b,0x61,0x01,0x1d,0x76,0x30,0x00,rowBytes & 0xff,(rowBytes >> 8) & 0xff,height & 0xff,(height >> 8) & 0xff]);
    if (singleBuffer) {
      // Floyd-Steinberg monochrome dithering is specific to the redesigned
      // unsettled bill. Keep the settled-receipt raster path byte-for-byte.
      const gray = new Float32Array(width * height);
      for (let index = 0; index < gray.length; index++) {
        const pixel = index * 4;
        gray[index] = (pixels[pixel] * 299 + pixels[pixel + 1] * 587 + pixels[pixel + 2] * 114) / 1000;
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const oldValue = gray[index];
          const newValue = oldValue < 128 ? 0 : 255;
          const error = oldValue - newValue;
          if (newValue === 0) raster[11 + y * rowBytes + (x >> 3)] |= (0x80 >> (x & 7));
          if (x + 1 < width) gray[index + 1] += error * 7 / 16;
          if (y + 1 < height) {
            if (x > 0) gray[index + width - 1] += error * 3 / 16;
            gray[index + width] += error * 5 / 16;
            if (x + 1 < width) gray[index + width + 1] += error / 16;
          }
        }
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          const luminance = (pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000;
          if (luminance < 160) raster[11 + y * rowBytes + (x >> 3)] |= (0x80 >> (x & 7));
        }
      }
    }
    const textOptions = singleBuffer
      ? { initialize: false, feedLines, partialCut: true }
      : {};
    const textBytes = new TextEncoder().encode(toEscPosPayload(text, textOptions));
    const init = singleBuffer ? new Uint8Array([0x1b,0x40]) : new Uint8Array(0);
    const combined = new Uint8Array(init.length + raster.length + textBytes.length);
    combined.set(init, 0);
    combined.set(raster, init.length);
    combined.set(textBytes, init.length + raster.length);
    return bytesToBase64(combined);
  } catch (error) {
    console.warn('[printService] thermal logo rendering skipped', error);
    return fallbackTextBuffer();
  }
}

export async function printTestOrder(printer, assignmentTypes = [], propertyId = null) {
  let settings = {};
  if (propertyId) {
    const { data, error } = await supabase.from('property_settings').select('*').eq('property_id', propertyId).maybeSingle();
    if (error) throw error;
    settings = data || {};
  }
  const isBar = printer?.type === 'bar' || assignmentTypes.includes('drinks_orders') || assignmentTypes.includes('void_drinks_orders');
  const center = isBar ? 'BAR' : 'KITCHEN';
  const order = {
    propertyName: 'OLITECHS PMS + POS',
    orderNumber: 'TEST-ORDER-001',
    table: 'TEST-01',
    waiter: 'Print Test',
    diningOption: 'Dine In',
    covers: 2,
    createdAt: new Date().toISOString(),
    items: [{
      qty: 2,
      name: isBar ? 'Thermal Test Drink' : 'Thermal Test Burger',
      modifiers: isBar ? [{ name: 'No Ice' }, { name: 'Lemon' }] : [{ name: 'Extra Cheese' }, { name: 'No Onion' }],
      prepNote: 'TEST ONLY - no kitchen action',
    }],
  };
  const thermalText = buildOrderTicketText(order, { printer, settings, center });
  return printToPrinter(printer, thermalTextToHtml(thermalText), {
    propertyId: null,
    jobType: 'test_order',
    copyType: 'test',
    assignmentType: 'food_orders',
    title: 'Test Print - Order',
    payload: { test: true, template: 'order' },
    persistJob: false,
    thermalText,
  });
}

export async function printTestReceipt(printer, propertyId, { vatMode = 'off', longReceipt = false } = {}) {
  let settings = {};
  if (propertyId) {
    const [{ data, error }, { data: vatSettings, error: vatError }] = await Promise.all([
      supabase.from('property_settings').select('*').eq('property_id', propertyId).maybeSingle(),
      supabase.from('property_unsettled_receipt_settings').select('*').eq('property_id', propertyId).maybeSingle(),
    ]);
    if (error) throw error;
    if (vatError) throw vatError;
    settings = {
      ...(data || {}),
      unsettled_receipt_show_vat: vatMode !== 'off',
      unsettled_receipt_vat_rate: Number(vatSettings?.vat_rate ?? 16),
      unsettled_receipt_vat_mode: vatMode === 'inclusive' ? 'inclusive' : 'exclusive',
      unsettled_receipt_feed_lines: Number(vatSettings?.feed_lines ?? 5),
    };
  } else {
    settings = {
      unsettled_receipt_show_vat: vatMode !== 'off',
      unsettled_receipt_vat_rate: 16,
      unsettled_receipt_vat_mode: vatMode === 'inclusive' ? 'inclusive' : 'exclusive',
      unsettled_receipt_feed_lines: 5,
    };
  }
  const sampleItems = [
    {
      qty: 1,
      name: 'Grilled Ocean Fish with Coconut Sauce and Swahili Spices',
      price: 1250,
      modifiers: [{ name: 'Extra lemon butter' }],
    },
    { qty: 2, name: 'Soda', price: 300 },
  ];
  const items = longReceipt
    ? Array.from({ length: 12 }, (_, index) => ({
        ...sampleItems[index % 2],
        qty: index === 1 ? 2 : 1,
        name: index === 0 ? sampleItems[0].name : (index === 1 ? 'Soda' : 'Sample menu item ' + (index + 1)),
        modifiers: index === 0 ? sampleItems[0].modifiers : [],
      }))
    : sampleItems;
  const data = {
    checkNo: 'ORD-002-USOR1U2',
    table: 'T4',
    waiter: 'Grace Wanjiru',
    diningOption: 'Dine In',
    covers: 5,
    currency: 'KES',
    items,
    createdAt: new Date().toISOString(),
  };
  const now = new Date();
  const thermalText = buildUnsettledReceiptText(settings, data, { printer, copyLabel: 'CUSTOMER COPY', now });
  console.info('[POS] Unsettled receipt plain-text preview\\n' + thermalText);
  const is58mm = String(printer.paper_width || '80mm').toLowerCase() === '58mm';
  const thermalBase64 = await buildLogoEscPosBase64(settings.logo_url, printer, thermalText, {
    singleBuffer: true,
    maxLogoDots: is58mm ? 230 : 345,
    feedLines: settings.unsettled_receipt_feed_lines,
  });
  return printToPrinter(printer, thermalTextToHtml(thermalText), {
    propertyId: null,
    jobType: 'test_receipt',
    copyType: 'test',
    assignmentType: 'unsettled_bills',
    title: 'Test Print - Unsettled Bill',
    payload: { test: true, template: 'unsettled_receipt', vatMode, longReceipt },
    persistJob: false,
    thermalText,
    thermalBase64,
  });
}

export async function printReceipt(type, data) {
  const propertyId = data.propertyId;
  let settings = data.settings || await (async () => { const { data: row, error } = await supabase.from('property_settings').select('*').eq('property_id', propertyId).maybeSingle(); if(error) throw error; return row; })();
  if (!settings) return { ok:false, friendlyError:'Receipt company details are not configured.' };
  if (type === 'UNSETTLED') {
    const { data: vatSettings, error: vatError } = await supabase.from('property_unsettled_receipt_settings').select('*').eq('property_id', propertyId).maybeSingle();
    if (vatError) throw vatError;
    settings = {
      ...settings,
      unsettled_receipt_show_vat: vatSettings?.show_vat === true,
      unsettled_receipt_vat_rate: Number(vatSettings?.vat_rate ?? 16),
      unsettled_receipt_vat_mode: vatSettings?.vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      unsettled_receipt_feed_lines: Number(vatSettings?.feed_lines ?? 5),
      unsettled_receipt_paper_width: vatSettings?.paper_width || '80mm',
    };
  }
  const assignmentType = type === 'UNSETTLED' ? 'unsettled_bills' : 'final_receipts';
  const printers = await getPrinters(propertyId);
  const assignments = await getAssignments(propertyId);
  const targets = assignments.filter((a) => a.assignment_type === assignmentType).map((a) => printers.find((p) => p.id === a.printer_id)).filter(Boolean);
  if (!targets.length) {
    const content = receiptHtml(settings, type, data, 'CUSTOMER COPY');
    const queued = await createFnbPrintJob({
      propertyId, printerId:null, assignmentType, jobType:type, copyType:'duplicate',
      title:type === 'UNSETTLED' ? 'Unsettled Bill' : 'Final Receipt',
      contentHtml:content,
      payload:{orderNumber:data.orderNumber||data.checkNo||null,total:data.total||0}
    });
    const message = `No printer assigned to ${assignmentType}.`;
    await updateFnbPrintJob(queued.id, propertyId, 'failed', message, null);
    return { ok:false, results:[], jobId:queued.id, assignmentType, friendlyError:message };
  }
  const copyCount = type === 'UNSETTLED' ? Math.max(1, Math.min(2, Number(settings.unsettled_receipt_copy_count || 2))) : 2;
  const copies = type === 'UNSETTLED'
    ? (copyCount === 1 ? ['CUSTOMER COPY'] : ['CUSTOMER COPY', settings.unsettled_receipt_front_office_copy === false ? 'SECOND COPY' : 'FRONT OFFICE COPY'])
    : ['CUSTOMER COPY', 'CASHIER COPY'];
  const results = [];
  if (type === 'UNSETTLED') {
    const printedAt = new Date();
    for (const printer of targets) {
      const copyTexts = copies.map(copy => buildUnsettledReceiptText(settings, data, { printer, copyLabel: copy, now: printedAt }));
      // Both configured copies, when requested, are one continuous receipt
      // buffer. There is no intermediate cut or second print job.
      const thermalText = copyTexts.join('\n\n\n\n');
      console.info('[POS] Unsettled receipt plain-text preview\\n' + thermalText);
      const is58mm = String(printer.paper_width || settings.unsettled_receipt_paper_width || '80mm').toLowerCase() === '58mm';
      const thermalBase64 = await buildLogoEscPosBase64(settings.logo_url, printer, thermalText, {
        singleBuffer: true,
        maxLogoDots: is58mm ? 230 : 345,
        feedLines: settings.unsettled_receipt_feed_lines ?? 5,
      });
      results.push(await printToPrinter(printer, thermalTextToHtml(thermalText), {
        propertyId,
        jobType: type,
        copyType: 'duplicate',
        assignmentType,
        payload: { orderNumber: data.orderNumber || data.checkNo || null, total: data.total || 0, receiptTemplate: 'unsettled-v2' },
        title: 'Unsettled Bill',
        thermalText,
        thermalBase64,
      }));
    }
    return { ok: results.every(result => result.ok), results };
  }

  for (const printer of targets) {
    const copyTexts = copies.map(copy => buildFinalReceiptText(settings, data, { printer, copyLabel: copy }));
    const thermalText = copyTexts.join('\n\n\x1D\x56\x01\n\n');
    const thermalBase64 = await buildLogoEscPosBase64(settings.logo_url, printer, thermalText);
    results.push(await printToPrinter(printer, receiptHtml(settings, type, data, copies[0]), {
      propertyId, jobType: type, copyType:'duplicate', assignmentType,
      payload:{orderNumber:data.orderNumber||data.checkNo||null,total:data.total||0},
      title:'Final Receipt', thermalText, thermalBase64,
    }));
  }
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
  const first=await printToPrinter(printer,shiftReportHtml(shiftData,'CASHIER COPY'),{propertyId,jobType:'shift_report',copyType:'cashier',assignmentType:'shift_reports',payload:{shiftId:shiftData.shift?.id||null},title:'Shift Closing Report'});
  const second=await printToPrinter(printer,shiftReportHtml(shiftData,'MANAGER / ACCOUNTANT COPY'),{propertyId,jobType:'shift_report',copyType:'manager',assignmentType:'shift_reports',payload:{shiftId:shiftData.shift?.id||null},title:'Shift Closing Report'});
  return {ok:first.ok&&second.ok,results:[first,second]};
}
export async function listFnbPrintJobs(propertyId,{status=null,limit=50}={}) { if (!propertyId) return []; let q=supabase.from('fnb_print_jobs').select('*').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,limit))); if(status) q=q.eq('status',status); const {data,error}=await q; if(error) throw error; return data||[]; }
export async function retryFnbPrintJob(jobId,propertyId) {
  const {data:job,error}=await supabase.from('fnb_print_jobs').select('*').eq('id',jobId).eq('property_id',propertyId).single();
  if(error) throw error;
  const printer = await resolveRetryPrinter(job, propertyId);
  if(!printer) throw new Error(`No available printer is assigned to ${job.assignment_type || 'this print job'}.`);
  return printToPrinter(printer,job.content_html,{
    propertyId,jobType:job.job_type,copyType:job.copy_type,assignmentType:job.assignment_type,
    payload:job.payload||{},title:job.title||'OliTechs Print',retryOf:job.id
  });
}
