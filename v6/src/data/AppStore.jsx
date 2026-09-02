import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { INITIAL_ZONES, INITIAL_STAFF, TABLE_CARD } from './mockData';
import {
  PrinterStatus, PrintJobStatus, testConnection as psTestConnection,
  pairUsbDevice, pairBluetoothDevice, forgetDevice,
  sendPrintJob, buildTestPageText,
} from '@/services/printerService';

const StoreContext = createContext(null);

// Demo table sessions — replace with API when backend is ready.
function seedSessions() {
  const now = Date.now();
  return {
    'bar-3':   { status: 'occupied',  guests: 4, waiter: 'David Lumumba', openedAt: now - 14 * 60000 },
    'pool-25': { status: 'occupied',  guests: 2, waiter: 'Amina Kariuki', openedAt: now - 30 * 60000 },
    'pool-30': { status: 'unsettled', guests: 6, waiter: 'Peter Obieno Otieno', openedAt: now - 122 * 60000 },
    'room-5':  { status: 'occupied',  guests: 3, waiter: 'Grace Wanjiru Kamau', openedAt: now - 22 * 60000 },
    'room-12': { status: 'unsettled', guests: 2, waiter: 'John Mwangi', openedAt: now - 55 * 60000 },
  };
}

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
  const [sessions, setSessions] = useState(seedSessions);
  const [printers, setPrinters] = useState(seedPrinters);
  // Async connectivity/print calls span multiple ticks, so callbacks read
  // through refs (kept in sync below) instead of capturing stale state.
  const printersRef = useRef(printers);
  printersRef.current = printers;

  const getSession = useCallback((id) => sessions[id] || null, [sessions]);

  const openTable = useCallback((id, { guests, waiter }) => {
    setSessions((prev) => ({
      ...prev,
      [id]: { status: 'occupied', guests: Number(guests), waiter, openedAt: Date.now(), total: 0, orderCount: 0 },
    }));
  }, []);
  const updateSessionTotals = useCallback((id, { total = 0, orderCount = 0 } = {}) => {
    setSessions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], total: Number(total) || 0, orderCount: Number(orderCount) || 0 } } : prev));
  }, []);
  const setUnsettled = useCallback((id) => {
    setSessions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], status: 'unsettled' } } : prev));
  }, []);
  const closeTable = useCallback((id) => {
    setSessions((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);

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
  const addPrinter = useCallback((partial) => {
    const id = newId('p');
    setPrinters((prev) => [...prev, {
      id,
      name: partial.name || 'New Printer',
      connectionType: partial.connectionType || 'network',
      host: partial.host || '',
      port: partial.port || '',
      agentUrl: partial.agentUrl || '',
      status: PrinterStatus.NOT_CONFIGURED,
      lastChecked: null,
      lastError: null,
      purposes: partial.purposes || ['receipt'],
      center: partial.center || '',
    }]);
    return id;
  }, []);

  const updatePrinter = useCallback((id, patch) => {
    setPrinters((prev) => prev.map((p) => (p.id === id ? {
      ...p, ...patch,
      // Editing connection settings invalidates any prior verified status —
      // saving a config must never be conflated with "connected".
      status: ('host' in patch || 'port' in patch || 'connectionType' in patch || 'agentUrl' in patch) ? PrinterStatus.NOT_CONFIGURED : p.status,
    } : p)));
  }, []);

  const removePrinter = useCallback((id) => {
    forgetDevice(id);
    setPrinters((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const togglePurpose = useCallback((id, purpose) => {
    setPrinters((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const has = p.purposes.includes(purpose);
      const purposes = has ? p.purposes.filter((x) => x !== purpose) : [...p.purposes, purpose];
      return { ...p, purposes, center: purpose === 'order' && !has ? (p.center || 'All') : p.center };
    }));
  }, []);

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
    const pair = printer.connectionType === 'usb' ? pairUsbDevice : printer.connectionType === 'bluetooth' ? pairBluetoothDevice : null;
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

  const completeSale = useCallback(async ({ table, orderLines, total, method, receiptText }) => {
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
    if (printer) {
      const result = await sendPrintJob(printer, receiptText, { title: `Receipt — Table ${table.number}` });
      setSaleReceipts((prev) => prev.map((r) => (r.id === id ? {
        ...r, printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError,
      } : r)));
      return { id, printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError };
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

  // --- Kitchen orders: firing an order is recorded independently of
  // whether the kitchen/bar ticket actually printed. ---
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const kitchenOrdersRef = useRef(kitchenOrders);
  kitchenOrdersRef.current = kitchenOrders;

  const fireKitchenOrder = useCallback(async ({ table, orderLines, orderNumber, buildTicketText }) => {
    const id = newId('korder');
    const centers = [...new Set(orderLines.map((l) => l.center).filter(Boolean))];
    const printJobs = {};
    for (const center of centers) printJobs[center] = { status: PrintJobStatus.PENDING, printerId: null, printerName: null, error: null };
    const record = { id, tableId: table.id, tableNumber: table.number, orderNumber, orderLines, firedAt: Date.now(), printJobs };
    setKitchenOrders((prev) => [record, ...prev]);

    for (const center of centers) {
      const printer = orderPrinterForCenter(center);
      if (!printer) {
        setKitchenOrders((prev) => prev.map((o) => (o.id === id ? { ...o, printJobs: { ...o.printJobs, [center]: { status: PrintJobStatus.FAILED, printerId: null, printerName: null, error: `No order printer configured for ${center}.` } } } : o)));
        continue;
      }
      setKitchenOrders((prev) => prev.map((o) => (o.id === id ? { ...o, printJobs: { ...o.printJobs, [center]: { ...o.printJobs[center], status: PrintJobStatus.PRINTING, printerId: printer.id, printerName: printer.name } } } : o)));
      const text = buildTicketText(center, orderLines.filter((l) => l.center === center));
      const result = await sendPrintJob(printer, text, { title: `Kitchen Ticket — ${center}` });
      setKitchenOrders((prev) => prev.map((o) => (o.id === id ? { ...o, printJobs: { ...o.printJobs, [center]: { status: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printerId: printer.id, printerName: printer.name, error: result.ok ? null : result.friendlyError } } } : o)));
    }

    const finalOrder = kitchenOrdersRef.current.find((o) => o.id === id) || record;
    const failedCenters = Object.entries(finalOrder.printJobs || printJobs).filter(([, j]) => j.status === PrintJobStatus.FAILED).map(([c]) => c);
    return { id, failedCenters };
  }, [orderPrinterForCenter]);

  // Retries ONLY the kitchen ticket for one center — never re-fires the order.
  const retryKitchenPrint = useCallback(async (orderId, center, buildTicketText) => {
    const order = kitchenOrdersRef.current.find((o) => o.id === orderId);
    if (!order) return { ok: false, friendlyError: 'Order not found.' };
    setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, printJobs: { ...o.printJobs, [center]: { ...o.printJobs[center], status: PrintJobStatus.RETRYING } } } : o)));
    const printer = orderPrinterForCenter(center);
    if (!printer) {
      const error = `No order printer configured for ${center}.`;
      setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, printJobs: { ...o.printJobs, [center]: { status: PrintJobStatus.FAILED, printerId: null, printerName: null, error } } } : o)));
      return { ok: false, friendlyError: error };
    }
    const text = buildTicketText(center, order.orderLines.filter((l) => l.center === center));
    const result = await sendPrintJob(printer, text, { title: `Kitchen Ticket — ${center}` });
    setKitchenOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, printJobs: { ...o.printJobs, [center]: { status: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printerId: printer.id, printerName: printer.name, error: result.ok ? null : result.friendlyError } } } : o)));
    return result;
  }, [orderPrinterForCenter]);

  const value = {
    zones, staff, sessions, printers, saleReceipts, kitchenOrders,
    getSession, openTable, updateSessionTotals, setUnsettled, closeTable,
    addZone, renameZone, removeZone, addTable, removeTable, updateTable, moveTable,
    addStaff, updateStaff, removeStaff,
    addPrinter, updatePrinter, removePrinter, togglePurpose,
    testPrinterConnection, connectPrinter, disconnectPrinter, testPrint,
    orderPrinters, orderPrinterForCenter, billPrinter, billPrinterName, receiptPrinter, receiptPrinterName,
    completeSale, retryReceiptPrint, fireKitchenOrder, retryKitchenPrint,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// Null-safe hook: degrades to an inert fallback if ever called without a provider.
const FALLBACK = {
  zones: [], staff: [], sessions: {}, printers: [], saleReceipts: [], kitchenOrders: [],
  getSession: () => null, openTable: () => {}, updateSessionTotals: () => {}, setUnsettled: () => {}, closeTable: () => {},
  addZone: () => {}, renameZone: () => {}, removeZone: () => {}, addTable: () => {}, removeTable: () => {}, updateTable: () => {}, moveTable: () => {},
  addStaff: () => {}, updateStaff: () => {}, removeStaff: () => {},
  addPrinter: () => {}, updatePrinter: () => {}, removePrinter: () => {}, togglePurpose: () => {},
  testPrinterConnection: async () => null, connectPrinter: async () => null, disconnectPrinter: () => {}, testPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
  orderPrinters: () => [], orderPrinterForCenter: () => null, billPrinter: () => null, billPrinterName: () => null, receiptPrinter: () => null, receiptPrinterName: () => null,
  completeSale: async () => ({ id: null, printStatus: 'failed', printError: 'No provider' }),
  retryReceiptPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
  fireKitchenOrder: async () => ({ id: null, failedCenters: [] }),
  retryKitchenPrint: async () => ({ ok: false, friendlyError: 'No provider' }),
};

export const useStore = () => useContext(StoreContext) || FALLBACK;