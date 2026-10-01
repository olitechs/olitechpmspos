import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Loader2 } from 'lucide-react';
import { VAT_RATE, tableLabel } from '@/data/mockData';
import { useStore } from '@/data/AppStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { getSessionStaff } from '@/services/authService';
import { inventoryService } from '@/services/inventoryService';
import { PrintJobStatus } from '@/services/printerService';
import PrintWarn from '@/components/pos/PrintWarn';
import { NAVY, TEAL, TEAL_DARK, TEAL_LIGHT, SAND, SURFACE, SURFACE2, BORDER, BORDER_DARK, MUTED, MUTED_DARK, DESTRUCTIVE } from '@/data/themePalette';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'room', label: 'Room Charge' },
];

function fmtKes(n) {
  return `KES ${Math.max(0, n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

function buildReceiptText({ orderNumber, table, orderLines, subtotal, discountAmt, discountPct, vat, total, methodLabel }) {
  const lines = [
    'VISIWA BEACH RESORT',
    'Malindi Road, Kenya · VAT PIN: P051234567Z',
    `${orderNumber} · Table ${tableLabel(table)}`,
    new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }),
    '--------------------------------',
    ...orderLines.map((l) => `${l.qty}x ${l.name}  ${(l.price * l.qty).toLocaleString()}`),
    '--------------------------------',
    `Subtotal: ${subtotal.toLocaleString()}`,
  ];
  if (discountAmt > 0) lines.push(`Discount (${discountPct}%): -${discountAmt.toLocaleString()}`);
  lines.push(`VAT 16%: ${vat.toLocaleString()}`, `TOTAL: KES ${total.toLocaleString()}`, `Paid via: ${methodLabel}`, '', 'Thank you!');
  return lines.join('\n');
}

// Sale completion (payment) and receipt printing are handled as two
// separate, independently-tracked outcomes. A failed print never cancels,
// duplicates, or re-triggers the payment — retrying only resends the print
// job for the same already-recorded sale.
export default function BillPayment({ table, tableSessionId, orderLines, onConfirmPayment, onBackToOrder }) {
  const store = useStore();
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const sessionStaff = getSessionStaff();
  const effectiveRole = String(sessionStaff?.role || user?.staff?.role || user?.propertyRole || '').toLowerCase().replace(/\s+/g,'_');
  const canRoomCharge = user?.isPlatformOwner || ['hotel_admin','super_admin','cashier','front_office_manager','owner','admin','manager'].includes(effectiveRole);
  const hasBillPrinter = !!store.billPrinterName();
  const [paymentMethod, setPaymentMethod] = useState('cash');
  useEffect(() => { if (!canRoomCharge && paymentMethod === 'room') setPaymentMethod('cash'); }, [canRoomCharge, paymentMethod]);
  const [discountPct, setDiscountPct] = useState('');
  const [splitBill, setSplitBill] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState({ cash: 0, card: 0, mpesa: 0, room: 0 });
  const [sale, setSale] = useState(null); // { id, printStatus, printError, orderNumber, total, methodLabel }
  const [retrying, setRetrying] = useState(false);
  const [activeStays, setActiveStays] = useState([]);
  const [chargeReservationId, setChargeReservationId] = useState('');
  const [chargeError, setChargeError] = useState('');

  // Room Charge (spec section 30: POS → PMS folio integration). Pull the
  // list of currently checked-in stays so the cashier picks a real guest
  // to bill, rather than typing a free-text room number.
  useEffect(() => {
    if (paymentMethod !== 'room' || !propertyId) return;
    pmsService
      .listActiveStays(propertyId)
      .then(setActiveStays)
      .catch((err) => setChargeError(err.message));
  }, [paymentMethod, propertyId]);

  const subtotal = orderLines.reduce((s, l) => s + l.price * l.qty, 0);
  const discountAmt = discountPct ? Math.round(subtotal * (parseFloat(discountPct) / 100)) : 0;
  const discountedSub = subtotal - discountAmt;
  const vat = Math.round(discountedSub * VAT_RATE);
  const total = discountedSub + vat;
  const setSinglePaymentMethod = (method) => {
    setPaymentMethod(method);
    setSplitBill(false);
    setPaymentAmounts({ cash: 0, card: 0, mpesa: 0, room: 0 });
    setChargeError('');
  };

  const setSplitAmount = (method, value) => {
    const numeric = Math.max(0, Number(value || 0));
    setPaymentAmounts((prev) => ({ ...prev, [method]: numeric }));
    if (method === 'room') setChargeError('');
  };

  const allocationTotal = splitBill
    ? Object.values(paymentAmounts).reduce((sum, value) => sum + Number(value || 0), 0)
    : total;

  const allocations = splitBill
    ? Object.entries(paymentAmounts)
        .filter(([, amount]) => Number(amount || 0) > 0)
        .map(([method, amount]) => ({
          method,
          amount: Math.round(Number(amount) * 100) / 100,
          ...(method === 'room' ? { reservationId: chargeReservationId || null } : {}),
        }))
    : [{
        method: paymentMethod,
        amount: Math.round(total * 100) / 100,
        ...(paymentMethod === 'room' ? { reservationId: chargeReservationId || null } : {}),
      }];

  const allocationBalanced = Math.abs(allocationTotal - total) < 0.01;

  const orderNumber = `RCP-${String(table.number).padStart(3, '0')}-${new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }).replace(':', '')}`;
  const methodLabel = splitBill ? 'Split Payment' : PAYMENT_METHODS.find((m) => m.id === paymentMethod)?.label;

  const receiptText = () => buildReceiptText({ orderNumber, table, orderLines, subtotal, discountAmt, discountPct, vat, total, methodLabel });

  const printUnsettledProforma = () => {
    const rows = orderLines.map((l) => `<tr><td>${String(l.name || '').replace(/[<>]/g, '')}</td><td>${l.qty}</td><td style=\"text-align:right\">KES ${(Number(l.price || 0) * Number(l.qty || 0)).toLocaleString('en-KE')}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=420,height=760');
    if (!w) { toast.error('Allow pop-ups to print the proforma receipt.'); return; }
    w.document.write(`<!doctype html><html><head><title>Unsettled Receipt</title><style>@page{size:80mm auto;margin:4mm}body{width:72mm;font-family:Arial,sans-serif;color:#090C11;font-size:11px;margin:0}.watermark{font-size:14px;font-weight:900;text-align:center;border:2px dashed #F97316;padding:8px;margin-bottom:10px}h2{text-align:center;font-size:15px;margin:0 0 4px}p{margin:2px 0;text-align:center;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:4px 0;border-bottom:1px dashed #ccc}th{text-align:left}.totals{margin-top:8px}.row{display:flex;justify-content:space-between;padding:2px 0}.total{font-size:14px;font-weight:900;border-top:2px solid #090C11;margin-top:4px;padding-top:5px}</style></head><body><div class=\"watermark\">UNSETTLED RECEIPT - NOT PAID</div><h2>VISIWA BEACH RESORT</h2><p>Table ${tableLabel(table)} · ${orderNumber}</p><p>${new Date().toLocaleString('en-KE')}</p><table><thead><tr><th>Item</th><th>Qty</th><th style=\"text-align:right\">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class=\"totals\"><div class=\"row\"><span>Subtotal</span><b>KES ${subtotal.toLocaleString('en-KE')}</b></div>${discountAmt > 0 ? `<div class=\"row\"><span>Discount</span><b>- KES ${discountAmt.toLocaleString('en-KE')}</b></div>` : ''}<div class=\"row\"><span>VAT 16%</span><b>KES ${vat.toLocaleString('en-KE')}</b></div><div class=\"row total\"><span>TOTAL</span><b>KES ${total.toLocaleString('en-KE')}</b></div></div><p style=\"margin-top:12px\">This is a proforma only. No payment received.</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`);
    w.document.close();
  };

  const handleConfirm = async () => {
    if (!tableSessionId) {
      setChargeError('This table does not have a persistent open-check session yet. Reopen the table and try again.');
      return;
    }
    if (!allocationBalanced) {
      setChargeError('Payment allocations must equal ' + fmtKes(total) + '. Current allocation: ' + fmtKes(allocationTotal) + '.');
      return;
    }
    const roomAllocation = allocations.find((allocation) => allocation.method === 'room');
    if (roomAllocation && !chargeReservationId) {
      setChargeError('Select which checked-in guest/room receives the room-folio charge.');
      return;
    }
    if (!propertyId) {
      setChargeError('This POS session is not attached to a property.');
      return;
    }
    try {
      await pmsService.settlePosTable({
        propertyId, tableSessionId, tableNumber: tableLabel(table), orderNumber,
        items: orderLines.map((line) => ({ name: line.name, qty: line.qty, price: line.price })),
        subtotal, discountAmount: discountAmt, vat, total, allocations,
      });
    } catch (err) {
      setChargeError('Payment was not recorded: ' + err.message);
      toast.error('Payment was not recorded. No receipt was issued.');
      return;
    }
    const result = await store.completeSale({ table, orderLines, total, method: methodLabel, receiptText: receiptText() });
    setSale({ id: result.id, printStatus: result.printStatus, printError: result.printError, orderNumber, total, methodLabel });
    if (propertyId) {
      try {
        const inventoryResult = await inventoryService.deductStockForOrder({
          propertyId,
          orderItems: orderLines.map((line) => ({ productId: line.productId || line.id, qty: line.qty, name: line.name })),
          reference: 'POS Sale - Table ' + tableLabel(table),
        });
        if (inventoryResult.skipped.length) console.warn('[inventory] POS deduction skipped', inventoryResult.skipped);
        const lowProducts = inventoryResult.deducted.filter(({ product, result: stockResult }) => Number(stockResult?.current_stock) <= Number(product.min_stock));
        if (lowProducts.length) toast.warning('Stock alert: ' + lowProducts.map(({ product }) => product.name).join(', ') + ' is low or out of stock.');
      } catch (err) {
        console.warn('[inventory] POS deduction failed after sale', err);
      }
    }
    if (result.printStatus === PrintJobStatus.PRINTED) setTimeout(() => onConfirmPayment(), 1500);
  };
  const handleRetryPrint = async () => {
    if (!sale) return;
    setRetrying(true);
    const result = await store.retryReceiptPrint(sale.id, receiptText());
    setSale((s) => ({ ...s, printStatus: result.ok ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED, printError: result.ok ? null : result.friendlyError }));
    setRetrying(false);
  };

  if (sale) {
    const printed = sale.printStatus === PrintJobStatus.PRINTED;
    const failed = sale.printStatus === PrintJobStatus.FAILED;
    return (
      <div className="flex items-center justify-center h-full" style={{ background: SAND }}>
        <div className="text-center max-w-sm px-4">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl" style={{ background: SURFACE, border: `3px solid ${TEAL_DARK}`, color: TEAL_DARK }}>✓</div>
          <div className="text-2xl font-bold" style={{ color: NAVY }}>Sale Completed</div>
          <div className="text-sm mt-2" style={{ color: MUTED }}>{fmtKes(total)} via {methodLabel}</div>

          {printed && <div className="text-xs mt-3 font-semibold" style={{ color: TEAL_DARK }}>Receipt printed successfully.</div>}

          {chargeError && (
            <div className="mt-4 rounded-xl p-3 text-left" style={{ background: `${DESTRUCTIVE}0F`, border: `1px solid ${DESTRUCTIVE}33` }}>
              <div className="text-xs font-bold mb-1" style={{ color: DESTRUCTIVE }}>Room folio not updated</div>
              <div className="text-xs" style={{ color: DESTRUCTIVE }}>{chargeError}</div>
            </div>
          )}

          {failed && (
            <div className="mt-4 rounded-xl p-3 text-left" style={{ background: `${DESTRUCTIVE}0F`, border: `1px solid ${DESTRUCTIVE}33` }}>
              <div className="text-xs font-bold mb-1" style={{ color: DESTRUCTIVE }}>Receipt printing failed</div>
              <div className="text-xs mb-3" style={{ color: DESTRUCTIVE }}>{sale.printError}</div>
              <button onClick={handleRetryPrint} disabled={retrying}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold" style={{ background: TEAL, color: '#090C11', opacity: retrying ? 0.6 : 1 }}>
                {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {retrying ? 'Retrying…' : 'Retry Print'}
              </button>
            </div>
          )}

          <button onClick={onConfirmPayment} className="text-xs mt-4 font-semibold underline" style={{ color: MUTED }}>
            {printed ? 'Returning to Floor Plan…' : 'Continue to Floor Plan'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: SAND }}>
      {/* Receipt panel */}
      <div className="flex-1 overflow-y-auto flex flex-col" style={{ borderRight: `1px solid ${BORDER}` }}>
        <div className="m-4 rounded-2xl overflow-hidden" style={{ background: NAVY, fontFamily: '"Courier New", Courier, monospace', maxWidth: '460px' }}>
          <div className="text-center py-5 px-6" style={{ borderBottom: `1px dashed ${BORDER_DARK}` }}>
            <div className="text-sm font-bold uppercase tracking-widest" style={{ color: TEAL_LIGHT }}>Visiwa Beach Resort</div>
            <div className="text-xs mt-0.5" style={{ color: MUTED_DARK }}>Malindi Road, Kenya · VAT PIN: P051234567Z</div>
            <div className="text-xs mt-3" style={{ color: MUTED_DARK }}>{orderNumber} · Table {tableLabel(table)}</div>
            <div className="text-xs" style={{ color: MUTED_DARK }}>{new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          </div>

          <div className="px-5 py-3">
            <div className="flex text-xs mb-2" style={{ color: MUTED_DARK }}>
              <span className="flex-1">Description</span>
              <span className="w-8 text-center">Qty</span>
              <span className="w-20 text-right">Amount</span>
            </div>
            {orderLines.length === 0 ? (
              <div className="text-xs text-center py-4" style={{ color: MUTED_DARK }}>No items on this order</div>
            ) : (
              orderLines.map((line) => (
                <div key={line.id} className="flex items-start py-1.5 gap-1" style={{ borderBottom: `1px solid ${BORDER_DARK}` }}>
                  <div className="flex-1 text-xs leading-tight" style={{ color: '#D8E2EC' }}>{line.name}</div>
                  <div className="w-8 text-center text-xs font-mono" style={{ color: MUTED_DARK }}>{line.qty}</div>
                  <div className="w-20 text-right text-xs font-mono" style={{ color: TEAL_LIGHT }}>{(line.price * line.qty).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>

          <div className="px-5 pb-4" style={{ borderTop: `1px dashed ${BORDER_DARK}` }}>
            <div className="pt-3 space-y-1">
              <TotalRow label="Subtotal" value={fmtKes(subtotal)} />
              {discountAmt > 0 && <TotalRow label={`Discount (${discountPct}%)`} value={`- ${fmtKes(discountAmt)}`} />}
              <TotalRow label="VAT 16%" value={fmtKes(vat)} />
              <div className="flex justify-between pt-2 mt-1" style={{ borderTop: `1px solid ${BORDER_DARK}` }}>
                <span className="text-sm font-bold text-white">TOTAL DUE</span>
                <span className="text-sm font-bold font-mono text-white">{fmtKes(total)}</span>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Payment panel */}
      <div className="shrink-0 flex flex-col gap-4 p-4 overflow-y-auto" style={{ width: '280px' }}>
        <button
          onClick={onBackToOrder}
          className="w-full rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: SURFACE, color: NAVY, border: `1.5px solid ${BORDER}` }}
        >
          ← Add More Items
        </button>
        {!hasBillPrinter && <PrintWarn message="No bill printer set — configure in Settings" />}
        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Payment Method</div>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.filter((m) => m.id !== 'room' || canRoomCharge).map((m) => (
              <button
                key={m.id} onClick={() => setSinglePaymentMethod(m.id)}
                className="py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
                style={{
                  background: paymentMethod === m.id ? TEAL : SURFACE,
                  border: `2px solid ${paymentMethod === m.id ? TEAL : BORDER}`,
                  color: paymentMethod === m.id ? '#fff' : NAVY,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {paymentMethod === 'room' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold mb-1" style={{ color: NAVY }}>Charge to guest / room *</label>
              <select
                value={chargeReservationId}
                onChange={(e) => { setChargeReservationId(e.target.value); setChargeError(''); }}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
              >
                <option value="">Select a checked-in guest…</option>
                {activeStays.map((s) => (
                  <option key={s.id} value={s.id}>Room {s.room?.number} — {s.guest_name}</option>
                ))}
              </select>
              {activeStays.length === 0 && (
                <div className="text-xs mt-1" style={{ color: MUTED }}>No guests currently checked in.</div>
              )}
            </div>
          )}
          {chargeError && <div className="text-xs mt-2" style={{ color: DESTRUCTIVE }}>{chargeError}</div>}
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: MUTED }}>Discount</div>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="100" placeholder="0" value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              className="w-20 px-3 py-2.5 rounded-lg text-center font-mono font-bold text-sm outline-none"
              style={{ background: SURFACE2, border: `1.5px solid ${BORDER}`, color: NAVY }}
            />
            <span className="text-sm font-bold" style={{ color: MUTED }}>%</span>
            {discountAmt > 0 && <span className="text-xs font-mono" style={{ color: TEAL_DARK }}>− {fmtKes(discountAmt)}</span>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: MUTED }}>Payment Allocation</div>
            <button
              onClick={() => {
                const next = !splitBill;
                setSplitBill(next);
                setPaymentAmounts(next ? { cash: total, card: 0, mpesa: 0, room: 0 } : { cash: 0, card: 0, mpesa: 0, room: 0 });
                setChargeError('');
              }}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold"
              style={{ background: splitBill ? TEAL : SURFACE, color: splitBill ? '#fff' : NAVY, border: `1px solid ${splitBill ? TEAL : BORDER}` }}
            >
              {splitBill ? 'Split ON' : 'Split payment'}
            </button>
          </div>
          {splitBill && (
            <div className="space-y-2">
              {PAYMENT_METHODS.map((method) => (
                <div key={method.id} className="flex items-center gap-2">
                  <span className="w-24 text-xs font-semibold" style={{ color: NAVY }}>{method.label}</span>
                  <input type="number" min="0" step="0.01" value={paymentAmounts[method.id] || ''} onChange={(e) => setSplitAmount(method.id, e.target.value)}
                    className="flex-1 px-2.5 py-2 rounded-lg text-sm font-mono outline-none"
                    style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />
                </div>
              ))}
              <div className="flex justify-between text-xs font-bold pt-1">
                <span style={{ color: MUTED }}>Allocated</span>
                <span style={{ color: allocationBalanced ? TEAL_DARK : DESTRUCTIVE }}>{fmtKes(allocationTotal)} / {fmtKes(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl p-3" style={{ background: NAVY }}>
          <div className="flex justify-between text-xs mb-1" style={{ color: MUTED_DARK }}>
            <span>Total Due</span><span className="font-mono">{fmtKes(total)}</span>
          </div>
          <div className="flex justify-between text-xs" style={{ color: MUTED_DARK }}>
            <span>Via</span><span className="font-semibold" style={{ color: TEAL_LIGHT }}>{methodLabel}</span>
          </div>
        </div>

        <button
          onClick={printUnsettledProforma}
          disabled={orderLines.length === 0}
          className="w-full py-3 rounded-xl text-sm font-bold"
          style={{ background: '#FFFFFF', color: '#090C11', border: '2px solid #E5E7EB', cursor: orderLines.length ? 'pointer' : 'not-allowed', opacity: orderLines.length ? 1 : .5 }}
        >
          Print Unsettled / Proforma
        </button>

        <button
          onClick={handleConfirm} disabled={orderLines.length === 0 || !tableSessionId || !allocationBalanced || (!!allocations.find((a) => a.method === 'room') && !chargeReservationId)}
          className="w-full py-4 rounded-xl text-base font-bold transition-all active:scale-95"
          style={{ background: (orderLines.length > 0 && !(paymentMethod === 'room' && !chargeReservationId)) ? TEAL : '#C2CCD3', color: '#fff', cursor: (orderLines.length > 0 && !(paymentMethod === 'room' && !chargeReservationId)) ? 'pointer' : 'not-allowed' }}
        >
          Confirm Payment
        </button>
      </div>
    </div>
  );
}

function TotalRow({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs" style={{ color: MUTED_DARK }}>{label}</span>
      <span className="text-xs font-mono" style={{ color: TEAL_LIGHT }}>{value}</span>
    </div>
  );
}