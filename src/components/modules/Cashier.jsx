import React from 'react';
import { Banknote, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none';

export default function Cashier() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [shift, setShift] = React.useState(null);
  const [summary, setSummary] = React.useState({});
  const [openingFloat, setOpeningFloat] = React.useState('');
  const [closingCash, setClosingCash] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    if (!propertyId) return;
    setError('');
    try {
      const s = await pmsService.getOpenCashierShift(propertyId);
      setShift(s);
      if (s) setSummary(await pmsService.getCashierShiftSummary(s.id));
      else setSummary({});
    } catch (e) { setError(e.message || 'Unable to load cashier shift.'); }
  }, [propertyId]);

  React.useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message || 'Operation failed.'); }
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

  return <div className="flex-1 overflow-y-auto bg-[#f8f8f7] p-4 lg:p-6">
    <div className="mx-auto max-w-[1200px] space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold">Cashier Control</h1><p className="mt-1 text-sm text-slate-500">Open and reconcile the active cashier shift.</p></div>
        <button className={btn+' border border-slate-200 bg-white'} onClick={load} disabled={busy}><RefreshCw size={15}/> Refresh</button>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!shift ? <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3"><Banknote size={20}/><div><h2 className="font-bold">Open cashier shift</h2><p className="text-sm text-slate-500">Enter the physical opening float.</p></div></div>
        <label className="mt-4 block text-xs font-semibold">Opening float<input className={input+' mt-1'} type="number" min="0" step="0.01" value={openingFloat} onChange={e=>setOpeningFloat(e.target.value)}/></label>
        <button className={btn+' mt-4 w-full bg-[#FFD300]'} disabled={busy} onClick={open}>Open shift</button>
      </section> : <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Opening float" value={money(summary.opening_float)}/>
          <Metric label="Cash sales" value={money(summary.cash_sales)}/>
          <Metric label="Card sales" value={money(summary.card_sales)}/>
          <Metric label="Expected cash" value={money(summary.expected_cash)}/>
        </div>
        <section className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold">Close and reconcile</h2>
          <p className="mt-1 text-sm text-slate-500">Count the physical cash and record any variance notes.</p>
          <label className="mt-4 block text-xs font-semibold">Closing cash count<input className={input+' mt-1'} type="number" min="0" step="0.01" value={closingCash} onChange={e=>setClosingCash(e.target.value)}/></label>
          <label className="mt-3 block text-xs font-semibold">Notes<textarea className={input+' mt-1'} rows="3" value={notes} onChange={e=>setNotes(e.target.value)}/></label>
          <button className={btn+' mt-4 bg-slate-950 text-white'} disabled={busy || closingCash===''} onClick={close}>Close shift</button>
        </section>
      </div>}
    </div>
  </div>;
}
function Metric({label,value}){return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-bold">{value}</div></div>}
