import React, { useEffect, useState } from 'react';
import { pmsService } from '@/services/pmsService';
import { shiftService } from '@/services/shiftService';
import { printReceipt } from '@/services/printService';
import { toast } from 'sonner';

const money = (value) => Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = (value) => value ? new Date(value).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function ShiftReceiptHistory({ propertyId, currentShift }) {
  const [closedShifts, setClosedShifts] = useState([]);
  const [shiftId, setShiftId] = useState(currentShift?.id || '');
  const [receipts, setReceipts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [printingId, setPrintingId] = useState(null);

  useEffect(() => {
    if (!propertyId) return undefined;
    let cancelled = false;
    shiftService.listShifts(propertyId, { status: 'closed' })
      .then((rows) => {
        if (cancelled) return;
        setClosedShifts(rows.slice(0, 30));
        setShiftId((existing) => existing || currentShift?.id || rows[0]?.id || '');
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Unable to load closed shifts.'); });
    if (currentShift?.id) setShiftId(currentShift.id);
    return () => { cancelled = true; };
  }, [propertyId, currentShift?.id]);

  useEffect(() => {
    if (!propertyId || !shiftId) {
      setReceipts([]);
      setSelected(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    shiftService.getShiftReceipts(propertyId, shiftId)
      .then((rows) => {
        if (cancelled) return;
        setReceipts(rows);
        setSelected((old) => old ? rows.find((row) => row.id === old.id) || null : null);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Unable to load receipts for this shift.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId, shiftId]);

  const reprint = async (receipt) => {
    setPrintingId(receipt.id);
    try {
      const result = await printReceipt('RECEIPT', {
        propertyId,
        orderNumber: receipt.order_number,
        checkNo: receipt.order_number,
        table: receipt.table_number ? 'Table ' + receipt.table_number : '—',
        waiter: receipt.waiter || 'Unassigned',
        covers: receipt.covers,
        items: Array.isArray(receipt.items) ? receipt.items : [],
        total: receipt.total,
        currency: 'KES',
        paymentMethod: receipt.payment_method,
        createdAt: receipt.created_at,
      });
      if (!result.ok) throw new Error(result.friendlyError || 'Receipt printer did not complete the reprint.');
      toast.success('Receipt ' + (receipt.order_number || '') + ' sent for reprinting.');
    } catch (err) {
      toast.error(err.message || 'Receipt reprint failed.');
    } finally {
      setPrintingId(null);
    }
  };

  const refund = async () => {
    if (!selected || !shiftId) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(selected.refundable_balance || 0)) {
      toast.error('Enter an amount within the remaining refundable balance.');
      return;
    }
    if (!refundReason.trim()) {
      toast.error('A refund reason is required.');
      return;
    }
    if (selected.payment_method === 'split' && !refundMethod) {
      toast.error('Choose the tender to refund for this split receipt.');
      return;
    }
    setRefundBusy(true);
    try {
      const adjustment = await pmsService.recordCashierAdjustment({
        propertyId,
        shiftId,
        adjustmentType: 'refund',
        targetType: 'pos_receipt',
        targetId: selected.id,
        amount,
        reason: refundReason.trim(),
        refundMethod: refundMethod || null,
      });
      toast.success(adjustment?.status === 'pending' ? 'Refund request sent for manager approval.' : 'Refund posted successfully.');
      setRefundAmount('');
      setRefundReason('');
      setRefundMethod('');
      const rows = await shiftService.getShiftReceipts(propertyId, shiftId);
      setReceipts(rows);
      setSelected(rows.find((row) => row.id === selected.id) || null);
    } catch (err) {
      toast.error(err.message || 'Unable to process refund.');
    } finally {
      setRefundBusy(false);
    }
  };

  const selectedShift = currentShift?.id === shiftId
    ? currentShift
    : closedShifts.find((shift) => shift.id === shiftId);

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="font-bold text-[var(--text)]">Shift receipts & transaction history</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Inspect sold items, reprint tab receipts and request refunds, including receipts from closed shifts.</p>
        </div>
        <div className="min-w-[240px]">
          <label htmlFor="shift-receipt-history" className="mb-1 block text-xs font-semibold text-[var(--text-muted)]">Select shift</label>
          <select id="shift-receipt-history" value={shiftId} onChange={(event) => { setShiftId(event.target.value); setSelected(null); }} className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]">
            {currentShift?.id && <option value={currentShift.id}>ACTIVE · {currentShift.shift_no || currentShift.id.slice(0, 8)}</option>}
            {closedShifts.map((shift) => <option key={shift.id} value={shift.id}>CLOSED · {shift.shift_no || shift.id.slice(0, 8)} · {shift.date || dateTime(shift.closed_at || shift.opened_at)}</option>)}
            {!currentShift && !closedShifts.length && <option value="">No shifts available</option>}
          </select>
        </div>
      </div>

      {selectedShift && <div className="border-b border-[var(--border)] bg-[var(--canvas)] px-5 py-2 text-xs text-[var(--text-muted)]">
        {selectedShift.status === 'closed' ? 'Closed' : 'Active'} shift · Opened {dateTime(selectedShift.opened_at)} {selectedShift.closed_at ? '· Closed ' + dateTime(selectedShift.closed_at) : ''}
      </div>}
      {error && <p role="alert" className="m-4 rounded-lg bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
            <th className="px-4 py-3">Receipt / Order</th><th className="px-4 py-3">Time</th><th className="px-4 py-3">Guest / Table</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Refunded</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id} className={'border-b border-[var(--border)] ' + (selected?.id === receipt.id ? 'bg-[var(--primary-soft)]' : '')}>
                <td className="px-4 py-3 font-semibold text-[var(--text)]">{receipt.order_number || receipt.id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{dateTime(receipt.created_at)}</td>
                <td className="px-4 py-3">{receipt.guest_name || (receipt.table_number ? 'Table ' + receipt.table_number : 'Walk-in')}</td>
                <td className="px-4 py-3 capitalize">{receipt.payment_method}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">KES {money(receipt.total)}</td>
                <td className="px-4 py-3 text-right tabular-nums">KES {money(receipt.refunded_total)}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-[var(--canvas)] px-2 py-1 text-xs font-bold">{receipt.status}</span></td>
                <td className="px-4 py-3"><div className="flex items-center gap-3">
                  <button type="button" className="font-semibold text-[var(--primary)] hover:underline" onClick={() => { setSelected(receipt); setRefundAmount(String(receipt.refundable_balance || '')); setRefundMethod(receipt.payment_method === 'split' ? '' : receipt.payment_method); setRefundReason(''); }}>View items</button>
                  <button type="button" className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50" disabled={printingId === receipt.id} onClick={() => reprint(receipt)}>{printingId === receipt.id ? 'Printing…' : 'Reprint'}</button>
                </div></td>
              </tr>
            ))}
            {!loading && receipts.length === 0 && <tr><td colSpan="8" className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">No receipts are recorded against this shift.</td></tr>}
          </tbody>
        </table>
      </div>
      {loading && <p className="px-5 py-3 text-sm text-[var(--text-muted)]">Loading shift receipts…</p>}

      {selected && (
        <div className="border-t border-[var(--border)] bg-[var(--canvas)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-bold text-[var(--text)]">Receipt {selected.order_number || selected.id.slice(0, 8)}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{dateTime(selected.created_at)} · {selected.payment_method} · {selected.status}</p></div>
            <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Close details</button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Sold items</div>
              {(Array.isArray(selected.items) ? selected.items : []).map((item, index) => (
                <div key={item.id || item.product_id || index} className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                  <div><p className="text-sm font-semibold text-[var(--text)]">{Number(item.qty || item.quantity || 0)} × {item.name || item.item_name || 'Item'}</p>{item.modifiers?.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">{item.modifiers.map((modifier) => modifier.name || modifier.label).join(' · ')}</p>}{item.notes && <p className="mt-1 text-xs text-[var(--text-muted)]">{item.notes}</p>}</div>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-[var(--text)]">KES {money(Number(item.price || 0) * Number(item.qty || item.quantity || 0))}</p>
                </div>
              ))}
              <div className="space-y-1 border-t border-[var(--border)] px-4 py-3 text-sm">
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">Subtotal</span><span>KES {money(selected.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">Discount</span><span>- KES {money(selected.discount_amount)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">VAT</span><span>KES {money(selected.vat)}</span></div>
                <div className="flex justify-between border-t border-[var(--border)] pt-2 font-bold"><span>Total</span><span>KES {money(selected.total)}</span></div>
                <div className="flex justify-between text-[var(--text-muted)]"><span>Refunded</span><span>KES {money(selected.refunded_total)}</span></div>
                <div className="flex justify-between font-bold"><span>Remaining refundable</span><span>KES {money(selected.refundable_balance)}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h4 className="font-bold text-[var(--text)]">Refund receipt</h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Refunds stay linked to the original receipt and shift. Existing manager-approval controls are preserved.</p>
              {selected.refunds?.length > 0 && <div className="my-3 rounded-lg bg-[var(--canvas)] p-3"><p className="text-xs font-bold text-[var(--text-muted)]">Previous refunds</p>{selected.refunds.map((refundRow) => <div key={refundRow.id} className="mt-1 flex justify-between gap-2 text-xs"><span>{refundRow.settlement_method || refundRow.method} · {dateTime(refundRow.created_at)}</span><b>KES {money(refundRow.amount)}</b></div>)}</div>}
              {selected.status === 'posted' && Number(selected.refundable_balance) > 0 ? (
                <div className="mt-3 space-y-3">
                  {selected.payment_method === 'split' && <label className="block text-xs font-semibold text-[var(--text-muted)]">Refund tender<select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="">Select payment method</option><option value="cash">Cash</option><option value="card">Card</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="room">Room charge</option></select></label>}
                  <label className="block text-xs font-semibold text-[var(--text-muted)]">Refund amount<input type="number" min="0.01" max={selected.refundable_balance} step="0.01" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"/></label>
                  <label className="block text-xs font-semibold text-[var(--text-muted)]">Reason<textarea rows="3" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm" placeholder="Reason for refund"/></label>
                  <button type="button" onClick={refund} disabled={refundBusy} className="min-h-10 w-full rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{refundBusy ? 'Submitting…' : 'Submit refund'}</button>
                </div>
              ) : <p className="mt-3 rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">This receipt has no remaining refundable balance.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
