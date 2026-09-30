import React from 'react';
import { Banknote, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const dateTime = (v) => new Date(v).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' });
const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200';

export default function Cashier() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [shift, setShift] = React.useState(null);
  const [summary, setSummary] = React.useState({});
  const [receipts, setReceipts] = React.useState([]);
  const [adjustments, setAdjustments] = React.useState([]);
  const [openingFloat, setOpeningFloat] = React.useState('');
  const [closingCash, setClosingCash] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [adjustmentType, setAdjustmentType] = React.useState('void');
  const [adjustmentAmount, setAdjustmentAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [approvalNote, setApprovalNote] = React.useState('');

  const load = React.useCallback(async () => {
    if (!propertyId) return;
    setLoading(true); setError('');
    try {
      const s = await pmsService.getOpenCashierShift(propertyId);
      setShift(s);
      if (s) {
        const [sum, rows, adj] = await Promise.all([
          pmsService.getCashierShiftSummary(s.id),
          pmsService.listCashierReceipts(propertyId, s.id),
          pmsService.listCashierAdjustments(propertyId, s.id),
        ]);
        setSummary(sum || {}); setReceipts(rows || []); setAdjustments(adj || []);
      } else {
        setSummary({}); setReceipts([]); setAdjustments([]);
      }
    } catch (e) { setError(e.message || 'Unable to load cashier controls.'); }
    finally { setLoading(false); }
  }, [propertyId]);

  React.useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e.message || 'Operation failed.'); }
    finally { setBusy(false); }
  };

  const open = () => run(async () => {
    await pmsService.openCashierShift({ propertyId, openingFloat: Number(openingFloat || 0) });
    setOpeningFloat('');
  });

  const close = () => run(async () => {
    await pmsService.closeCashierShift({ shiftId: shift.id, closingCashCount: Number(closingCash || 0), notes });
    setClosingCash(''); setNotes('');
  });

  const selectReceipt = (receipt) => {
    setSelected(receipt);
    setAdjustmentType(receipt.status === 'voided' ? 'refund' : 'void');
    setAdjustmentAmount(String(receipt.total || ''));
    setReason('');
  };

  const postAdjustment = () => run(async () => {
    if (!selected) throw new Error('Select a receipt first.');
    if (selected.status === 'voided' && adjustmentType === 'void') throw new Error('This receipt is already voided.');
    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid adjustment amount.');
    if (amount > Number(selected.total || 0)) throw new Error('Adjustment exceeds the receipt total.');
    if (!reason.trim()) throw new Error('A reason is required.');
    await pmsService.recordCashierAdjustment({
      propertyId, shiftId: shift.id, adjustmentType, targetType: 'pos_receipt',
      targetId: selected.id, amount, reason: reason.trim(),
    });
    setSelected(null); setAdjustmentAmount(''); setReason('');
  });

  const decideAdjustment = (adjustmentId, approve) => run(async () => {
    await pmsService.approveCashierAdjustment({ adjustmentId, approve, reason: approvalNote.trim() || null });
    setApprovalNote('');
  });

  const variance = shift && shift.closing_cash_count != null ? Number(shift.variance || 0) : null;
  const postedReceipts = receipts.filter((r) => r.status === 'posted');

  return <div className="flex-1 overflow-y-auto bg-[#f8f8f7] p-4 lg:p-6">
    <div className="mx-auto max-w-[1500px] space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-950">Cashier Control</h1>
          <p className="mt-1 text-sm text-slate-500">Manage the active till, transaction corrections and end-of-shift reconciliation.</p>
        </div>
        <button className={btn + ' border border-slate-200 bg-white'} onClick={load} disabled={busy || loading}><RefreshCw size={15}/> Refresh</button>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!shift ? <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3"><Banknote size={20}/><div><h2 className="font-bold">Open cashier shift</h2><p className="text-sm text-slate-500">Enter the physical cash float before taking payments.</p></div></div>
        <label className="mt-4 block text-xs font-semibold text-slate-600">Opening float<input className={input + ' mt-1'} type="number" min="0" step="0.01" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} placeholder="0.00"/></label>
        <button className={btn + ' mt-4 w-full bg-[#FFD300] text-slate-950'} disabled={busy || openingFloat === ''} onClick={open}><CheckCircle2 size={15}/> Open shift</button>
      </section> : <>
        <div className="grid gap-3 md:grid-cols-5">
          <Metric label="Opening float" value={money(summary.opening_float)}/>
          <Metric label="Cash sales" value={money(summary.cash_sales)}/>
          <Metric label="Card sales" value={money(summary.card_sales)}/>
          <Metric label="M-Pesa sales" value={money(summary.mpesa_sales)}/>
          <Metric label="Expected cash" value={money(summary.expected_cash)} emphasis/>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div><h2 className="font-bold">Shift transactions</h2><p className="mt-1 text-xs text-slate-500">{postedReceipts.length} posted receipt(s) · {receipts.length} total</p></div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">SHIFT OPEN</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Time</th><th className="px-3 py-3">Order</th><th className="px-3 py-3">Guest / Room</th><th className="px-3 py-3">Method</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th>
                </tr></thead>
                <tbody>
                  {receipts.map((r) => <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 text-xs text-slate-500">{dateTime(r.created_at)}</td>
                    <td className="px-3 py-3 font-medium">{r.order_number || '—'}</td>
                    <td className="px-3 py-3">{r.guest_name || (r.room_number ? `Room ${r.room_number}` : 'Walk-in')}</td>
                    <td className="px-3 py-3 capitalize">{r.payment_method}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold">{money(r.total)}</td>
                    <td className="px-3 py-3"><Status status={r.status}/></td>
                    <td className="px-3 py-3 text-right">{r.status === 'posted' && <button className="font-semibold text-red-700 hover:underline" onClick={() => selectReceipt(r)}>Adjust</button>}</td>
                  </tr>)}
                  {!receipts.length && <tr><td colSpan="7" className="px-3 py-12 text-center text-sm text-slate-500">No POS receipts have been posted in this shift.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">Transaction control</h2>
              <p className="mt-1 text-xs text-slate-500">Every correction requires an amount and reason and is written to the adjustment log.</p>
              {!selected ? <div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-600"><ShieldAlert size={17} className="mb-2"/><p>Select <strong>Adjust</strong> on a posted receipt to begin.</p></div> : <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-slate-50 p-3 text-xs"><div className="font-bold">{selected.order_number || 'POS transaction'}</div><div className="mt-1">{selected.guest_name || 'Walk-in'} · {money(selected.total)} · {selected.payment_method}</div></div>
                <label className="block text-xs font-semibold text-slate-600">Action<select className={input + ' mt-1'} value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}>
                  <option value="void">Void</option><option value="refund">Refund</option><option value="discount">Discount</option>
                </select></label>
                <label className="block text-xs font-semibold text-slate-600">Amount<input className={input + ' mt-1'} type="number" min="0.01" max={selected.total} step="0.01" value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)}/></label>
                <label className="block text-xs font-semibold text-slate-600">Reason<textarea className={input + ' mt-1'} rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the correction"/></label>
                <button className={btn + ' w-full bg-red-600 text-white'} disabled={busy} onClick={postAdjustment}>Post {adjustmentType}</button>
                <button className={btn + ' w-full border border-slate-200 bg-white'} onClick={() => setSelected(null)}><XCircle size={15}/> Cancel</button>
              </div>}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-bold">Close & reconcile</h2>
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between"><span>Expected cash</span><strong>{money(summary.expected_cash)}</strong></div><div className="mt-2 flex justify-between"><span>Refunds</span><strong>{money(summary.refunds)}</strong></div><div className="mt-2 flex justify-between"><span>Voids</span><strong>{money(summary.voids)}</strong></div><div className="mt-2 flex justify-between"><span>Discounts</span><strong>{money(summary.discounts)}</strong></div></div>
              <label className="mt-4 block text-xs font-semibold text-slate-600">Closing cash count<input className={input + ' mt-1'} type="number" min="0" step="0.01" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} placeholder="0.00"/></label>
              <label className="mt-3 block text-xs font-semibold text-slate-600">Closing notes<textarea className={input + ' mt-1'} rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain any variance"/></label>
              <button className={btn + ' mt-3 w-full bg-slate-950 text-white'} disabled={busy || closingCash === ''} onClick={close}><CheckCircle2 size={15}/> Close shift</button>
              {variance !== null && <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm"><div className="flex justify-between"><span>Final variance</span><strong>{money(variance)}</strong></div></div>}
            </section>
          </aside>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between"><div><h2 className="font-bold">Adjustment history</h2><p className="mt-1 text-xs text-slate-500">Controlled changes recorded for this shift.</p></div><span className="text-xs font-semibold text-slate-500">{adjustments.length} record(s)</span></div>
          <div className="mb-3 rounded-lg bg-slate-50 p-3">
            <label className="block text-xs font-semibold text-slate-600">Manager approval note (used when approving or rejecting a pending adjustment)<input className={input + ' mt-1'} value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} placeholder="Optional note"/></label>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Time</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Action</th></tr></thead>
              <tbody>{adjustments.map((a) => <tr key={a.id} className="border-b border-slate-100"><td className="px-3 py-2 text-xs text-slate-500">{dateTime(a.created_at)}</td><td className="px-3 py-2 capitalize">{a.adjustment_type}</td><td className="px-3 py-2 font-mono">{money(a.amount)}</td><td className="px-3 py-2">{a.reason}</td><td className="px-3 py-2 capitalize">{a.status}</td><td className="px-3 py-2">{a.status === 'pending' ? <div className="flex gap-2"><button className="text-xs font-bold text-emerald-700 hover:underline" disabled={busy} onClick={() => decideAdjustment(a.id, true)}>Approve</button><button className="text-xs font-bold text-red-700 hover:underline" disabled={busy} onClick={() => decideAdjustment(a.id, false)}>Reject</button></div> : '—'}</td></tr>)}
              {!adjustments.length && <tr><td colSpan="6" className="px-3 py-8 text-center text-sm text-slate-500">No adjustments recorded for this shift.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
  </div>;
}

function Metric({ label, value, emphasis }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-lg font-bold ${emphasis ? 'text-amber-700' : 'text-slate-950'}`}>{value}</div></div>;
}
function Status({ status }) {
  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{status || 'posted'}</span>;
}
