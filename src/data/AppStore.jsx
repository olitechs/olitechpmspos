import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { INITIAL_ZONES, INITIAL_STAFF, TABLE_CARD } from './mockData';
import { useAuth } from '@/lib/AuthContext';
import { posService } from '@/services/posService';
import {
  PrinterStatus, PrintJobStatus, testConnection as psTestConnection,
  pairUsbDevice, pairBluetoothDevice, pairSerialDevice, forgetDevice,
  sendPrintJob, buildTestPageText,
} from '@/services/printerService';

const StoreContext = createContext(null);

// Demo table sessions — replace with API when backend is ready.
// Active POS sessions are loaded from Supabase; there are no seeded production sessions.
// Printers carry a `purposes` list (order / bill / receipt) and, when used as
// an order printer, a `center` (Kitchen / Bar / Dessert / All) for routing.
// `status` reflects a REAL connectivity result (see services/printerService)
// — it is never set to CONNECTED just because a config was saved.
function seedPrinters() {
  return [
    { id: 'p1', name: 'Front Desk Printer', connectionType: 'network', host: '192.168.1.50', port: '9100', agentUrl: '', status: PrinterStatus.NOT_CONFIGURED, lastChecked: null, lastError: null, purposes: ['bill', 'receipt'], center: '' },
    { id: 'p2', name: 'Bar Printer', connectionType: 'bluetooth', host: '', port: '', agentUrl: '', status: PrinterStatus.NOT_CONFIGURED, lastChecked: null, lastError: null, purposes: ['order'], center: 'Bar' },
    { id: 'p3', name: 'Kitchen Printer', connectionType: 'usb', host: '', port: '', agentUrl: '', status: PrinterStatus.NOT_CONFIGURED, lastChecked: null, lastError: null, purposes: ['order'], center: 'Kitchen' },
  ];
}

let counter = 0;
const newId = (prefix) => `${prefix}-${Date.now()}-${counter++}`;

export function StoreProvider({ children }) {
  const [zones, setZones] = useState(INITIAL_ZONES);
  const [staff, setStaff] = useState(INITIAL_STAFF);
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [sessions, setSessions] = useState({});

  useEffect(() => {
    let active = true;
    if (!propertyId) { setSessions({}); return undefined; }

    const hydrateSession = (row) => ({
      status: row.status,
      guests: Number(row.guests || 1),
      waiter: row.waiter || '',
      openedAt: row.opened_at ? new Date(row.opened_at).getTime() : Date.now(),
      kotSentAt: row.kot_sent_at ? new Date(row.kot_sent_at).getTime() : null,
      total: 0,
      orderCount: Array.isArray(row.order_lines) ? row.order_lines.length : 0,
      tableNumber: row.table_number,
      zoneId: row.zone_id || null,
      orderNumber: row.order_number || null,
      orderLines: Array.isArray(row.order_lines) ? row.order_lines : [],
    });

    posService.listActiveSessions(propertyId).then((rows) => {
      if (!active) return;
      const next = {};
      for (const row of rows || []) {
        next[row.table_key] = hydrateSession(row);
      }
      setSessions(next);
    }).catch((error) => console.error('[POS] failed to load persisted sessions', error));

    const channel = posService.subscribeToTableSessions?.(propertyId, {
      onChange: ({ eventType, row }) => {
        if (!active || !row?.table_key) return;
        setSessions((prev) => {
          const next = { ...prev };
          if (eventType === 'DELETE' || row.status === 'closed') {
            delete next[row.table_key];
          } else {
            next[row.table_key] = hydrateSession(row);
          }
          return next;
        });
      },
    });

    return () => {
      active = false;
      if (channel) channel.unsubscribe?.();
    };
  }, [propertyId]);
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const kitchenOrdersRef = useRef(kitchenOrders);
  kitchenOrdersRef.current = kitchenOrders;

  useEffect(() => {
    let active = true;
    if (!propertyId) { setKitchenOrders([]); return undefined; }

    const hydrateKitchenOrders = async () => {
      try {
        const rows = await posService.listActiveKitchenOrders(propertyId);
        if (!active) return;
        setKitchenOrders((rows || []).map((row) => ({
          id: row.id,
          tableId: row.table_key || row.table_number,
          tableNumber: row.table_number,
          orderNumber: row.order_number,
          waiter: row.waiter || '',
          orderLines: Array.isArray(row.order_lines) ? row.order_lines : [],
          firedAt: row.fired_at ? new Date(row.fired_at).getTime() : Date.now(),
          status: row.status || 'new',
          printJobs: row.print_jobs || {},
        })));
      } catch (error) {
        // The app remains usable during migration rollout; the KDS simply
        // has no persisted orders until 0036 is applied.
        console.error('[KDS] failed to load persisted kitchen orders', error);
        if (active) setKitchenOrders([]);
      }
    };

    hydrateKitchenOrders();
    const timer = window.setInterval(hydrateKitchenOrders, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [propertyId]);

  const [printers, setPrinters] = useState([]);

  useEffect(() => {
    let active = true;
    if (!propertyId) { setPrinters([]); return undefined; }
    posService.listPrinters(propertyId).then((rows) => {
      if (!active) return;
      setPrinters((rows || []).map((row) => ({
        id: row.client_key,
        propertyId,
        name: row.name,
        connectionType: row.connection_type,
        host: row.host || '',
        port: row.port || '',
        agentUrl: row.agent_url || '',
        baudRate: Number(row.baud_rate) || 9600,
        status: PrinterStatus.NOT_CONFIGURED,
        lastChecked: null,
        lastError: null,
        purposes: Array.isArray(row.purposes) ? row.purposes : ['receipt'],
        center: row.center || '',
      })));
    }).catch((error) => {
      console.error('[POS] failed to load persisted printer configuration', error);
      if (active) setPrinters([]);
    });
    return () => { active = false; };
  }, [propertyId]);
  // Async connectivity/print calls span multiple ticks, so callbacks read
  // through refs (kept in sync below) instead of capturing stale state.
  const printersRef = useRef(printers);
  printersRef.current = printers;

  const getSession = useCallback((id) => sessions[id] || null, [sessions]);

  const persistSession = useCallback((id, session) => {
    if (!propertyId || !session) return;
    posService.saveSession({
      propertyId,
      tableKey: id,
      tableNumber: session.tableNumber || id,
      zoneId: session.zoneId || null,
      status: session.status || 'occupied',
      guests: session.guests || 1,
      waiter: session.waiter || null,
      orderNumber: session.orderNumber || null,
      orderLines: session.orderLines || [],
    }).catch((error) => console.error('[POS] failed to persist table session', error));
  }, [propertyId]);

  const openTable = useCallback((id, { guests, waiter, tableNumber, zoneId, orderNumber = null }) => {
    const next = { status: 'occupied', guests: Number(guests) || 1, waiter: waiter || '', openedAt: Date.now(), total: 0, orderCount: 0, tableNumber: String(tableNumber ?? ''), zoneId: zoneId || null, orderNumber, orderLines: [] };
    setSessions((prev) => ({ ...prev, [id]: next }));
    persistSession(id, next);
  }, [persistSession]);

  const updateSessionTotals = useCallback((id, { total = 0, orderCount = 0 } = {}) => {
    setSessions((prev) => {
      const next = prev[id] ? { ...prev, [id]: { ...prev[id], total: Number(total) || 0, orderCount: Number(orderCount) || 0 } } : prev;
      if (next[id]) persistSession(id, next[id]);
      return next;
    });
  }, [persistSession]);

  const setSessionOrderLines = useCallback((id, orderLines, orderNumber = null) => {
    setSessions((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev, [id]: { ...prev[id], orderLines: Array.isArray(orderLines) ? orderLines : [], orderCount: Array.isArray(orderLines) ? orderLines.length : 0, orderNumber: orderNumber || prev[id].orderNumber || null } };
      persistSession(id, next[id]);
      return next;
    });
  }, [persistSession]);

  const setUnsettled = useCallback((id) => {
    setSessions((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev, [id]: { ...prev[id], status: 'unsettled' } };
      persistSession(id, next[id]);
      return next;
    });
  }, [persistSession]);

  const closeTable = useCallback((id) => {
    setSessions((prev) => {
      const session = prev[id];
      if (session && propertyId) {
        posService.closeSession({ propertyId, tableKey: id, orderLines: session.orderLines || [] })
          .catch((error) => console.error('[POS] failed to close table session', error));
      }
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, [propertyId]);

  // Zone ops (Floor Setup)
  const addZone = useCallback((name) => {
    setZones((prev) => [...prev, { id: newId('z'), name: name || 'New Zone', tables: [] }]);
  }, []);
  const renameZone = useCallback((zoneId, name) => {
    setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, name } : z)));
  }, []);
  const removeZone = useCallback((zoneId) => {
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
  }, []);
  const addTable = useCallback((zoneId) => {
    setZones((prev) => prev.map((z) => {
      if (z.id !== zoneId) return z;
      const nextNo = z.tables.reduce((m, t) => Math.max(m, t.number), 0) + 1;
      const col = z.tables.length % 5;
      const row = Math.floor(z.tables.length / 5);
      const t = {
        id: newId(zoneId),
        number: nextNo,
        seats: 4,
        x: TABLE_CARD.pad + col * TABLE_CARD.stepX,
        y: TABLE_CARD.pad + row * TABLE_CARD.stepY,
        w: TABLE_CARD.w,
        h: TABLE_CARD.h,
      };
      return { ...z, tables: [...z.tables, t] };
    }));
  }, []);
  const removeTable = useCallback((zoneId, tableId) => {
    setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, tables: z.tables.filter((t) => t.id !== tableId) } : z)));
    setSessions((prev) => {
      if (!prev[tableId]) return prev;
      const copy = { ...prev };
      delete copy[tableId];
      return copy;
    });
  }, []);
  const updateTable = useCallback((zoneId, tableId, patch) => {
    setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, tables: z.tables.map((t) => (t.id === tableId ? { ...t, ...patch } : t)) } : z)));
  }, []);
  const moveTable = useCallback((zoneId, tableId, x, y) => {
    setZones((prev) => prev.map((z) => (z.id === zoneId ? { ...z, tables: z.tables.map((t) => (t.id === tableId ? { ...t, x: Math.round(x), y: Math.round(y) } : t)) } : z)));
  }, []);

  // Staff ops (Staff admin)
  const addStaff = useCallback((name) => {
    if (!name) return;
    setStaff((prev) => [...prev, { id: newId('s'), name }]);
  }, []);
  const updateStaff = useCallback((id, name) => {
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);
  const removeStaff = useCallback((id) => {
    setStaff((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Printer ops (Settings > Printers) — see services/printerService for the
  // actual connectivity/printing logic. This layer only owns state.
  const persistPrinter = useCallback((printer) => {
    if (!propertyId || !printer) return;
    posService.savePrinter({
      propertyId,
      clientKey: printer.id,
      name: printer.name,
      connectionType: printer.connectionType,
      host: printer.host,
      port: printer.port,
      agentUrl: printer.agentUrl,
      purposes: printer.purposes,
      center: printer.center,
      baudRate: Number(printer.baudRate) || 9600,
    }).catch((error) => console.error('[POS] failed to persist printer configuration', error));
  }, [propertyId]);

  const addPrinter = useCallback((partial) => {
    const id = newId('p');
    const printer = {
      id,
      name: partial.name || 'New Printer',
      connectionType: partial.connectionType || 'network',
      host: partial.host || '',
      port: partial.port || '',
      agentUrl: partial.agentUrl || '',
      baudRate: Number(partial.baudRate) || 9600,
      status: PrinterStatus.NOT_CONFIGURED,
      lastChecked: null,
      lastError: null,
      purposes: partial.purposes || ['receipt'],
      center: partial.center || '',
    };
    setPrinters((prev) => [...prev, printer]);
    persistPrinter(printer);
    return id;
  }, [persistPrinter]);

  const updatePrinter = useCallback((id, patch) => {
    setPrinters((prev) => {
      const next = prev.map((p) => (p.id === id ? {
        ...p, ...patch,
        // Editing connection settings invalidates any prior verified status —
        // saving a config must never be conflated with "connected".
        status: ('host' in patch || 'port' in patch || 'connectionType' in patch || 'agentUrl' in patch || 'baudRate' in patch) ? PrinterStatus.NOT_CONFIGURED : p.status,
      } : p));
      const changed = next.find((p) => p.id === id);
      if (changed) persistPrinter(changed);
      return next;
    });
  }, [persistPrinter]);

  const removePrinter = useCallback((id) => {
    forgetDevice(id);
    if (propertyId) posService.deletePrinter({ propertyId, clientKey: id }).catch((error) => console.error('[POS] failed to delete printer configuration', error));
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  }, [propertyId]);

  const togglePurpose = useCallback((id, purpose) => {
    setPrinters((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        const has = p.purposes.includes(purpose);
        const purposes = has ? p.purposes.filter((x) => x !== purpose) : [...p.purposes, purpose];
        return { ...p, purposes, center: purpose === 'order' && !has ? (p.center || 'All') : p.center };
      });
      const changed = next.find((p) => p.id === id);
      if (changed) persistPrinter(changed);
      return next;
    });
  }, [persistPrinter]);

  // Real connectivity test — sets CONNECTING immediately, then the genuine
  // result (see printerService: network needs a print agent, USB/Bluetooth
  // use real browser device APIs, system is always available).
  const testPrinterConnection = useCallback(async (id) => {
    setPrinters((prev) => prev.map((p) => (p.id === id ? { ...p, status: PrinterStatus.CONNECTING, lastError: null } : p)));
    const printer = printersRef.current.find((p) => p.id === id);
    if (!printer) return null;
    const result = await psTestConnection(printer);
    setPrinters((prev) => prev.map((p) => (p.id === id ? {
      ...p, status: result.status, lastChecked: result.checkedAt, lastError: result.friendlyError || null,
    } : p)));
    return result;
  }, []);

  // Pairing is a real, user-gesture-triggered permission prompt (WebUSB /
  // Web Bluetooth). It does not by itself guarantee CONNECTED — we
  // immediately follow up with a real test.
  const connectPrinter = useCallback(async (id) => {
    const printer = printersRef.current.find((p) => p.id === id);
    if (!printer) return null;
    setPrinters((prev) => prev.map((p) => (p.id === id ? { ...p, status: PrinterStatus.CONNECTING, lastError: null } : p)));
    const pair = printer.connectionType === 'usb'
      ? pairUsbDevice
      : printer.connectionType === 'bluetooth'
        ? pairBluetoothDevice
        : printer.connectionType === 'serial'
          ? pairSerialDevice
          : null;
    if (pair) {
      const result = await pair(printer);
      if (!result.ok) {
        setPrinters((prev) => prev.map((p) => (p.id === id ? { ...p, status: PrinterStatus.FAILED, lastError: result.friendlyError } : p)));
        return result;
      }
    }
    return testPrinterConnection(id);
  }, [testPrinterConnection]);

  const disconnectPrinter = useCallback((id) => {
    forgetDevice(id);
    setPrinters((prev) => prev.map((p) => (p.id === id ? { ...p, status: PrinterStatus.DISCONNECTED, lastError: null } : p)));
  }, []);

  const testPrint = useCallback(async (id) => {
    const printer = printersRef.current.find((p) => p.id === id);
    if (!printer) return { ok: false, friendlyError: 'Printer not found.' };
    return sendPrintJob(printer, buildTestPageText(printer), { title: `Test — ${printer.name}` });
  }, []);

  // Routing helpers — "connected" now means a REAL verified status, not a toggle.
  const isPrinterReady = (p) => p.status === PrinterStatus.CONNECTED;
  const receiptPrinter = useCallback(() => printers.find((p) => p.purposes.includes('receipt') && isPrinterReady(p)) || null, [printers]);
  const receiptPrinterName = useCallback(() => (receiptPrinter() || {}).name || null, [receiptPrinter]);
  const billPrinter = useCallback(() => printers.find((p) => p.purposes.includes('bill') && isPrinterReady(p)) || null, [printers]);
  const billPrinterName = useCallback(() => (billPrinter() || {}).name || null, [billPrinter]);
  const printBill = useCallback(async ({ text, tableNumber } = {}) => {
    const printer = billPrinter();
    if (!printer) return { ok: false, friendlyError: 'No bill printer is connected.' };
    return sendPrintJob(printer, text || '', { title: `Bill — Table ${tableNumber ?? ''}` });
  }, [billPrinter]);
  const orderPrinters = useCallback(() => printers.filter((p) => p.purposes.includes('order') && isPrinterReady(p)), [printers]);
  const orderPrinterForCenter = useCallback(
    (center) => printers.find((p) => p.purposes.includes('order') && isPrinterReady(p) && (!p.center || p.center === 'All' || p.center === center)) || null,
    [printers]
  );

  // --- Sale receipts: payment success is recorded independently of print
  // outcome, so a printer failure can NEVER duplicate/cancel/lose a sale. ---
  const [saleReceipts, setSaleReceipts] = useState([]);
  const saleReceiptsRef = useRef(saleReceipts);
  saleReceiptsRef.current = saleReceipts;

  const completeSale = useCallback(async ({ table, orderLines, total, method, receiptText, skipPrint = false }) => {
    const id = newId('sale');
    const printer = receiptPrinter();
    const record = {
      id, tableId: table.id, tableNumber: table.number, total, method,
      orderLines, createdAt: Date.now(),
      printerId: printer?.id || null, printerName: printer?.name || null,
      printStatus: printer ? PrintJobStatus.PRINTING : PrintJobStatus.FAILED,
      printError: printer ? null : 'No receipt printer is connected.',
    };
    setSaleReceipts((prev) => [record, ...prev]);
    if (skipPrint) {
      setSaleReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, printStatus: 'skipped', printError: null } : r)));
      return { id, printStatus: 'skipped', printError: null };
    }
    if (printer) {
      try {
        const result = await sendPrintJob(printer, receiptText, { title: `Receipt — Table ${table.number}` });
        setSaleReceipts((prev) => prev.map((r) => (r.id === id ? {
          ...r, printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError,
        } : r)));
        return { id, printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError };
      } catch (error) {
        // Printing is a secondary side effect. The PMS sale has already been
        // recorded by BillPayment before completeSale is called, so a printer
        // adapter exception must be reported as a print failure rather than
        // bubbling up and making the UI treat the paid sale as unsuccessful.
        const printError = error?.friendlyError || error?.message || 'Receipt printer failed.';
        setSaleReceipts((prev) => prev.map((r) => (r.id === id ? {
          ...r, printStatus: PrintJobStatus.FAILED, printError,
        } : r)));
        return { id, printStatus: PrintJobStatus.FAILED, printError };
      }
    }
    return { id, printStatus: record.printStatus, printError: record.printError };
  }, [receiptPrinter]);

  // Retries ONLY the print job — the sale itself was already recorded and is
  // never resubmitted, so retrying can't duplicate a charge.
  const retryReceiptPrint = useCallback(async (saleId, receiptText) => {
    const sale = saleReceiptsRef.current.find((s) => s.id === saleId);
    if (!sale) return { ok: false, friendlyError: 'Receipt not found.' };
    setSaleReceipts((prev) => prev.map((r) => (r.id === saleId ? { ...r, printStatus: PrintJobStatus.RETRYING } : r)));
    const printer = receiptPrinter();
    if (!printer) {
      setSaleReceipts((prev) => prev.map((r) => (r.id === saleId ? { ...r, printStatus: PrintJobStatus.FAILED, printError: 'No receipt printer is connected.' } : r)));
      return { ok: false, friendlyError: 'No receipt printer is connected.' };
    }
    const result = await sendPrintJob(printer, receiptText, { title: `Receipt — Table ${sale.tableNumber}` });
    setSaleReceipts((prev) => prev.map((r) => (r.id === saleId ? {
      ...r, printerId: printer.id, printerName: printer.name,
      printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError,
    } : r)));
    return result;
  }, [receiptPrinter]);

  // --- Kitchen orders: firing is persisted before printer work so a KDS
  // terminal can recover the order even when a printer is offline. ---
  const persistKitchenOrder = useCallback((order) => {
    if (!propertyId || !order?.id || String(order.id).startsWith('korder-')) return;
    posService.updateKitchenOrder({
      propertyId,
      orderId: order.id,
      status: order.status || 'new',
      printJobs: order.printJobs || {},
    }).catch((error) => console.error('[KDS] failed to persist kitchen order update', error));
  }, [propertyId]);

  const fireKitchenOrder = useCallback(async ({ table, orderLines, orderNumber, buildTicketText, printTickets = true }) => {
    const centers = [...new Set(orderLines.map((l) => l.center).filter(Boolean))];
    const printJobs = {};
    for (const center of centers) printJobs[center] = { status: PrintJobStatus.PENDING, printerId: null, printerName: null, error: null };

    const draft = {
      id: newId('korder'),
      tableId: table.id,
      tableNumber: table.number,
      orderNumber,
      waiter: storeStaffName(table),
      orderLines,
      firedAt: Date.now(),
      status: 'new',
      printJobs,
    };

    let record = draft;
    if (propertyId) {
      try {
        const saved = await posService.createKitchenOrder({
          propertyId,
          tableKey: table.id,
          tableNumber: table.number,
          orderNumber,
          waiter: draft.waiter,
          orderLines,
          printJobs,
        });
        if (saved?.id) record = { ...draft, id: saved.id, firedAt: saved.fired_at ? new Date(saved.fired_at).getTime() : draft.firedAt };
      } catch (error) {
        // Keep the POS usable if the new KDS migration has not reached the
        // connected Supabase project yet. Once 0036 is applied, the server row
        // becomes the source of truth and is shared across terminals.
        console.error('[KDS] failed to persist fired order', error);
      }
    }

    setKitchenOrders((prev) => [record, ...prev]);

    const updateLocal = (patch) => {
      setKitchenOrders((prev) => {
        const next = prev.map((o) => (o.id === record.id ? { ...o, ...patch } : o));
        const changed = next.find((o) => o.id === record.id);
        if (changed) persistKitchenOrder(changed);
        return next;
      });
    };

    if (!printTickets) return { id: record.id, failedCenters: [] };

    for (const center of centers) {
      const printer = orderPrinterForCenter(center);
      if (!printer) {
        updateLocal({ printJobs: { ...record.printJobs, [center]: { status: PrintJobStatus.FAILED, printerId: null, printerName: null, error: `No order printer configured for ${center}.` } } });
        record = { ...record, printJobs: { ...record.printJobs, [center]: { status: PrintJobStatus.FAILED, printerId: null, printerName: null, error: `No order printer configured for ${center}.` } } };
        continue;
      }
      const printingJobs = { ...record.printJobs, [center]: { ...record.printJobs[center], status: PrintJobStatus.PRINTING, printerId: printer.id, printerName: printer.name } };
      record = { ...record, printJobs: printingJobs };
      updateLocal({ printJobs: printingJobs });
      const text = buildTicketText(center, orderLines.filter((l) => l.center === center));
      const result = await sendPrintJob(printer, text, { title: `Kitchen Ticket — ${center}`, thermal: true });
      const finalJobs = { ...record.printJobs, [center]: { status: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printerId: printer.id, printerName: printer.name, error: result.ok ? null : result.friendlyError } };
      record = { ...record, printJobs: finalJobs };
      updateLocal({ printJobs: finalJobs });
    }

    const finalOrder = kitchenOrdersRef.current.find((o) => o.id === record.id) || record;
    const failedCenters = Object.entries(finalOrder.printJobs || {}).filter(([, j]) => j.status === PrintJobStatus.FAILED).map(([c]) => c);
    return { id: record.id, failedCenters };
  }, [orderPrinterForCenter, persistKitchenOrder, propertyId]);

  const storeStaffName = (table) => {
    const session = sessions[table.id];
    return session?.waiter || '';
  };

  const updateKitchenOrderStatus = useCallback((orderId, status) => {
    setKitchenOrders((prev) => {
      const next = prev.map((o) => (o.id === orderId ? { ...o, status } : o));
      const changed = next.find((o) => o.id === orderId);
      if (changed) persistKitchenOrder(changed);
      return next;
    });
  }, [persistKitchenOrder]);

  // Retries ONLY the kitchen ticket for one center — never re-fires the order.
  const retryKitchenPrint = useCallback(async (orderId, center, buildTicketText) => {
    const order = kitchenOrdersRef.current.find((o) => o.id === orderId);
    if (!order) return { ok: false, friendlyError: 'Order not found.' };
    const retryJobs = { ...order.printJobs, [center]: { ...order.printJobs[center], status: PrintJobStatus.RETRYING } };
    setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, printJobs: retryJobs } : o)));
    const printer = orderPrinterForCenter(center);
    if (!printer) {
      const error = `No order printer configured for ${center}.`;
      const failedJobs = { ...retryJobs, [center]: { status: PrintJobStatus.FAILED, printerId: null, printerName: null, error } };
      const nextOrder = { ...order, printJobs: failedJobs };
      setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? nextOrder : o)));
      persistKitchenOrder(nextOrder);
      return { ok: false, friendlyError: error };
    }
    const text = buildTicketText(center, order.orderLines.filter((l) => l.center === center));
    const result = await sendPrintJob(printer, text, { title: `Kitchen Ticket — ${center}`, thermal: true });
    const finalJobs = { ...order.printJobs, [center]: { status: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printerId: printer.id, printerName: printer.name, error: result.ok ? null : result.friendlyError } };
    const nextOrder = { ...order, printJobs: finalJobs };
    setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? nextOrder : o)));
    persistKitchenOrder(nextOrder);
    return result;
  }, [orderPrinterForCenter, persistKitchenOrder]);

  const value = {
    zones, staff, sessions, printers, saleReceipts, kitchenOrders,
    getSession, openTable, updateSessionTotals, setSessionOrderLines, setUnsettled, closeTable,
    addZone, renameZone, removeZone, addTable, removeTable, updateTable, moveTable,
    addStaff, updateStaff, removeStaff,
    addPrinter, updatePrinter, removePrinter, togglePurpose,
    testPrinterConnection, connectPrinter, disconnectPrinter, testPrint,
    orderPrinters, orderPrinterForCenter, billPrinter, billPrinterName, printBill, receiptPrinter, receiptPrinterName,
    completeSale, retryReceiptPrint, fireKitchenOrder, retryKitchenPrint, updateKitchenOrderStatus,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// Null-safe hook: degrades to an inert fallback if ever called without a provider.
const FALLBACK = {
  zones: [], staff: [], sessions: {}, printers: [], saleReceipts: [], kitchenOrders: [],
  getSession: () => null, openTable: () => {}, updateSessionTotals: () => {}, setSessionOrderLines: () => {}, setUnsettled: () => {}, closeTable: () => {},
  addZone: () => {}, renameZone: () => {}, removeZone: () => {}, addTable: () => {}, removeTable: () => {}, updateTable: () => {}, moveTable: () => {},
  addStaff: () => {}, updateStaff: () => {}, removeStaff: () => {},
  addPrinter: () => {}, updatePrinter: () => {}, removePrinter: () => {}, togglePurpose: () => {},
  testPrinterConnection: async () => null, connectPrinter: async () => null, disconnectPrinter: () => {}, testPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
  orderPrinters: () => [], orderPrinterForCenter: () => null, billPrinter: () => null, billPrinterName: () => null, printBill: async () => ({ ok: false, friendlyError: 'No provider' }), receiptPrinter: () => null, receiptPrinterName: () => null,
  completeSale: async () => ({ id: null, printStatus: 'failed', printError: 'No provider' }),
  retryReceiptPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
  fireKitchenOrder: async () => ({ id: null, failedCenters: [] }),
  retryKitchenPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
  updateKitchenOrderStatus: () => {},
};

export const useStore = () => useContext(StoreContext) || FALLBACK;