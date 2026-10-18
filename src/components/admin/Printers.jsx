import React, { useState } from 'react';
import { Plus, Trash2, Bluetooth, Wifi, Usb, Cable, Monitor, Printer as PrinterIcon, Check, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from '@/data/AppStore';
import { CENTERS } from '@/data/mockData';
import { PrinterStatus, validatePrinterConfig } from '@/services/printerService';
import { NAVY, TEAL, TEAL_DARK, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE, ERR } from '@/data/themePalette';

const CONNECTION_TYPES = [
  { id: 'network', label: 'LAN / Printer API', icon: Wifi, hint: 'Network thermal printer through a local Print API / agent (ESC/POS).' },
  { id: 'usb', label: 'USB Cable', icon: Usb, hint: 'Printer wired directly to this device (WebUSB).' },
  { id: 'bluetooth', label: 'Bluetooth BLE', icon: Bluetooth, hint: 'Pair a BLE thermal printer from this device (Web Bluetooth).' },
  { id: 'serial', label: 'Serial / BT SPP', icon: Cable, hint: 'USB-serial or Bluetooth Classic SPP printer exposed as a serial port (Web Serial).' },
  { id: 'system', label: 'Browser / System', icon: Monitor, hint: 'Printing handled by the OS print dialog.' },
];

const PURPOSES = [
  { id: 'order', label: 'Order', desc: 'Kitchen / bar tickets when an order is fired' },
  { id: 'bill', label: 'Bill', desc: 'Preliminary bill/check before payment' },
  { id: 'receipt', label: 'Receipt', desc: 'Final paid receipt once payment is confirmed' },
];

// Centralized status → badge presentation. Keeping this in one place avoids
// scattering ad-hoc strings/colors across the UI.
const STATUS_META = {
  [PrinterStatus.NOT_CONFIGURED]: { label: 'Not Configured', color: MUTED },
  [PrinterStatus.CONNECTING]: { label: 'Connecting…', color: TEAL_DARK, spin: true },
  [PrinterStatus.CONNECTED]: { label: 'Connected', color: TEAL_DARK },
  [PrinterStatus.DISCONNECTED]: { label: 'Disconnected', color: MUTED },
  [PrinterStatus.OFFLINE]: { label: 'Offline', color: ERR },
  [PrinterStatus.FAILED]: { label: 'Connection Failed', color: DESTRUCTIVE },
  [PrinterStatus.ERROR]: { label: 'Printer Error', color: DESTRUCTIVE },
  [PrinterStatus.UNSUPPORTED]: { label: 'Not Supported Here', color: ERR },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META[PrinterStatus.NOT_CONFIGURED];
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {meta.spin ? <Loader2 size={12} className="animate-spin" style={{ color: meta.color }} /> : <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />}
      <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
    </div>
  );
}

function lastCheckedLabel(ts) {
  if (!ts) return null;
  return `Last checked: ${new Date(ts).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`;
}

const CONNECT_LABEL = { network: 'Test Connection', usb: 'Connect', bluetooth: 'Pair', serial: 'Connect', system: 'Test Connection' };

export default function Printers() {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', connectionType: 'network', host: '', port: '9100', agentUrl: 'http://127.0.0.1:8631', baudRate: 9600, purposes: ['receipt'], center: 'All' });
  const [formErrors, setFormErrors] = useState({});
  const [busyId, setBusyId] = useState(null); // prevents firing multiple concurrent tests for the same printer
  const [printMsg, setPrintMsg] = useState({}); // { [id]: { ok, text } } — transient "Test Print" result per printer

  const toggleFormPurpose = (id) => {
    setForm((f) => {
      const has = f.purposes.includes(id);
      return { ...f, purposes: has ? f.purposes.filter((x) => x !== id) : [...f.purposes, id] };
    });
  };

  const save = () => {
    const { valid, errors } = validatePrinterConfig(form);
    setFormErrors(errors);
    if (!valid) return;
    store.addPrinter(form);
    setForm({ name: '', connectionType: 'network', host: '', port: '9100', agentUrl: '', baudRate: 9600, purposes: ['receipt'], center: 'All' });
    setFormErrors({});
    setAdding(false);
  };

  const runConnect = async (printer) => {
    if (busyId) return; // ignore rapid repeat clicks while a test is in flight
    setBusyId(printer.id);
    try {
      if (printer.connectionType === 'usb' || printer.connectionType === 'bluetooth' || printer.connectionType === 'serial') {
        await store.connectPrinter(printer.id);
      } else {
        await store.testPrinterConnection(printer.id);
      }
    } finally {
      setBusyId(null);
    }
  };

  const runTestPrint = async (printer) => {
    setPrintMsg((m) => ({ ...m, [printer.id]: { pending: true } }));
    const result = await store.testPrint(printer.id);
    setPrintMsg((m) => ({ ...m, [printer.id]: { ok: result.ok, text: result.ok ? 'Test page sent.' : (result.friendlyError || 'Test print failed.') } }));
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4 max-w-2xl">
        <div>
          <div className="text-sm font-bold" style={{ color: NAVY }}>Receipt & Kitchen Printers</div>
          <div className="text-xs" style={{ color: MUTED }}>Assign each printer one or more purposes: order, bill, receipt.</div>
        </div>
        <button onClick={() => setAdding((s) => !s)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: TEAL, color: '#090C11' }}>
          <Plus size={14} /> Add Printer
        </button>
      </div>

      {adding && (
        <div className="rounded-2xl p-4 mb-4 max-w-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>New Printer</div>

          <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kitchen Printer"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-1" style={{ background: SURFACE2, border: `1px solid ${formErrors.name ? DESTRUCTIVE : BORDER}`, color: NAVY }} />
          {formErrors.name && <div className="text-xs mb-2" style={{ color: DESTRUCTIVE }}>{formErrors.name}</div>}

          <div className="text-xs font-semibold mb-1 mt-2" style={{ color: NAVY }}>Connection type</div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {CONNECTION_TYPES.map((c) => {
              const active = form.connectionType === c.id;
              const Icon = c.icon;
              return (
                <button key={c.id} onClick={() => setForm({ ...form, connectionType: c.id })} title={c.hint}
                  className="p-3 rounded-xl text-left" style={{ background: active ? `${TEAL}14` : SURFACE2, border: `1.5px solid ${active ? TEAL : BORDER}` }}>
                  <Icon size={16} style={{ color: active ? TEAL_DARK : MUTED }} />
                  <div className="text-xs font-semibold mt-1" style={{ color: NAVY }}>{c.label}</div>
                </button>
              );
            })}
          </div>

          {form.connectionType === 'network' && (
            <>
              <div className="flex gap-2 mb-1">
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>IP address</label>
                  <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.50"
                    className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none" style={{ background: SURFACE2, border: `1px solid ${formErrors.host ? DESTRUCTIVE : BORDER}`, color: NAVY }} />
                  {formErrors.host && <div className="text-xs mt-1" style={{ color: DESTRUCTIVE }}>{formErrors.host}</div>}
                </div>
                <div className="w-24">
                  <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Port</label>
                  <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="9100"
                    className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none" style={{ background: SURFACE2, border: `1px solid ${formErrors.port ? DESTRUCTIVE : BORDER}`, color: NAVY }} />
                  {formErrors.port && <div className="text-xs mt-1" style={{ color: DESTRUCTIVE }}>{formErrors.port}</div>}
                </div>
              </div>
              <label className="block text-xs font-semibold mb-1 mt-2" style={{ color: NAVY }}>Print agent URL (optional)</label>
              <input value={form.agentUrl} onChange={(e) => setForm({ ...form, agentUrl: e.target.value })} placeholder="http://127.0.0.1:8631"
                className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none mb-1" style={{ background: SURFACE2, border: `1px solid ${formErrors.agentUrl ? DESTRUCTIVE : BORDER}`, color: NAVY }} />
              {formErrors.agentUrl && <div className="text-xs mb-2" style={{ color: DESTRUCTIVE }}>{formErrors.agentUrl}</div>}
              <div className="flex items-start gap-1.5 text-xs mb-3" style={{ color: MUTED }}>
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>LAN printers use the OliTechs Local Print Agent on this workstation. Start it on the POS computer, then use Test Connection. A printer is marked Connected only after a real TCP test page is sent successfully.</span>
              </div>
            </>
          )}
          {form.connectionType === 'bluetooth' && (
            <div className="text-xs mb-3" style={{ color: MUTED }}>Use <b>Pair</b> after saving to select a nearby Bluetooth printer via your browser's permission prompt.</div>
          )}
          {form.connectionType === 'serial' && (
            <div className="mb-3">
              <div className="text-xs mb-2" style={{ color: MUTED }}>Use this for USB-serial printers or Bluetooth Classic/SPP thermal printers that appear as a serial port.</div>
              <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Baud rate</label>
              <select value={form.baudRate} onChange={(e) => setForm({ ...form, baudRate: Number(e.target.value) })}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: SURFACE2, border: '1px solid ' + BORDER, color: NAVY }}>
                {[9600, 19200, 38400, 57600, 115200].map((rate) => <option key={rate} value={rate}>{rate} baud</option>)}
              </select>
            </div>
          )}
          {form.connectionType === 'usb' && (
            <div className="text-xs mb-3" style={{ color: MUTED }}>Plug in the printer, then use <b>Connect</b> after saving to grant USB access.</div>
          )}
          {form.connectionType === 'system' && (
            <div className="text-xs mb-3" style={{ color: MUTED }}>Print jobs open the browser/OS print dialog — no specific device is verified ahead of time.</div>
          )}

          <div className="text-xs font-semibold mb-1">Purposes</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {PURPOSES.map((p) => {
              const active = form.purposes.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggleFormPurpose(p.id)} title={p.desc}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                  style={{ background: active ? TEAL : SURFACE2, color: active ? '#fff' : NAVY, border: `1.5px solid ${active ? TEAL : BORDER}` }}>
                  {active && <Check size={12} />}{p.label}
                </button>
              );
            })}
          </div>
          {form.purposes.includes('order') && (
            <div className="mb-3">
              <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Routes to center</label>
              <select value={form.center} onChange={(e) => setForm({ ...form, center: e.target.value })}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}>
                {['All', ...CENTERS].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => { setAdding(false); setFormErrors({}); }} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: NAVY }}>Cancel</button>
            <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1" style={{ background: TEAL, color: '#090C11' }}>
              <Check size={14} /> Save Printer
            </button>
          </div>
          <div className="text-xs mt-2" style={{ color: MUTED }}>Saving stores the configuration only — it does not test connectivity.</div>
        </div>
      )}

      <div className="flex flex-col gap-3 max-w-2xl">
        {store.printers.map((p) => {
          const ct = CONNECTION_TYPES.find((c) => c.id === p.connectionType) || CONNECTION_TYPES[0];
          const Icon = ct.icon;
          const isBusy = busyId === p.id || p.status === PrinterStatus.CONNECTING;
          const isConnected = p.status === PrinterStatus.CONNECTED;
          const isFailure = [PrinterStatus.FAILED, PrinterStatus.ERROR, PrinterStatus.OFFLINE].includes(p.status);
          const pm = printMsg[p.id];
          return (
            <div key={p.id} className="rounded-2xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${TEAL}14` }}>
                    <PrinterIcon size={18} style={{ color: TEAL_DARK }} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm" style={{ color: NAVY }}>{p.name}</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                      <Icon size={12} /> {ct.label}
                      {p.connectionType === 'network' && p.host && <span>· {p.host}:{p.port}</span>}
                      {p.connectionType === 'serial' && <span>· {p.baudRate || 9600} baud</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.purposes.map((pu) => (
                        <span key={pu} className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: `${TEAL}1A`, color: TEAL_DARK }}>
                          {pu === 'order' ? `Order${p.center ? ' · ' + p.center : ''}` : pu.charAt(0).toUpperCase() + pu.slice(1)}
                        </span>
                      ))}
                      {p.purposes.length === 0 && <span className="text-xs" style={{ color: DESTRUCTIVE }}>No purpose assigned</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={p.status} />
                  {p.lastChecked && <span className="text-xs" style={{ color: MUTED }}>{lastCheckedLabel(p.lastChecked)}</span>}
                </div>
              </div>

              {p.lastError && (
                <div className="mt-3 rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: `${DESTRUCTIVE}0F`, color: DESTRUCTIVE }}>
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{p.lastError}</span>
                </div>
              )}

              {/* Purpose assignment */}
              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <div className="text-xs font-semibold mb-2" style={{ color: NAVY }}>Purposes</div>
                <div className="flex flex-wrap gap-2">
                  {PURPOSES.map((p2) => {
                    const active = p.purposes.includes(p2.id);
                    return (
                      <button key={p2.id} onClick={() => store.togglePurpose(p.id, p2.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                        style={{ background: active ? TEAL : SURFACE2, color: active ? '#fff' : NAVY, border: `1.5px solid ${active ? TEAL : BORDER}` }}>
                        {active && <Check size={12} />}{p2.label}
                      </button>
                    );
                  })}
                </div>
                {p.purposes.includes('order') && (
                  <div className="mt-2">
                    <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Routes to center</label>
                    <select value={p.center || 'All'} onChange={(e) => store.updatePrinter(p.id, { center: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}>
                      {['All', ...CENTERS].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Connection actions */}
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                {isConnected ? (
                  <button onClick={() => store.disconnectPrinter(p.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }}>Disconnect</button>
                ) : (
                  <button onClick={() => runConnect(p)} disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                    style={{ background: TEAL, color: '#090C11', opacity: isBusy ? 0.6 : 1, cursor: isBusy ? 'not-allowed' : 'pointer' }}>
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : (isFailure ? <RefreshCw size={12} /> : null)}
                    {isBusy ? 'Testing…' : isFailure ? 'Retry' : CONNECT_LABEL[p.connectionType]}
                  </button>
                )}
                <button onClick={() => runTestPrint(p)} disabled={!isConnected}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: isConnected ? NAVY : MUTED, cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.6 }}>
                  Test Print
                </button>
                <button onClick={() => store.removePrinter(p.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ml-auto" style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: DESTRUCTIVE }}>
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              {pm && (
                <div className="mt-2 text-xs" style={{ color: pm.pending ? MUTED : pm.ok ? TEAL_DARK : DESTRUCTIVE }}>
                  {pm.pending ? 'Printing test page…' : pm.text}
                </div>
              )}
            </div>
          );
        })}
        {store.printers.length === 0 && (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: MUTED }}>
            No printers configured — add one to enable printing.
          </div>
        )}
      </div>
    </div>
  );
}
