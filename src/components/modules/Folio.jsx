import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const money = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";
const btn = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50";

export default function Folio() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [reservations, setReservations] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [folio, setFolio] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chargeOpen, setChargeOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const loadReservations = async () => {
    if (!propertyId) return;
    setLoading(true); setError('');
    try {
      const rows = await pmsService.listReservations(propertyId);
      setReservations((rows || []).filter((r) => !['cancelled', 'checked-out', 'checked_out'].includes(r.status)));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadFolio = async (reservation) => {
    setSelected(reservation); setError('');
    try {
      const [f, p] = await Promise.all([pmsService.getFolio(reservation.id), pmsService.listPayments(reservation.id)]);
      setFolio(f); setPayments(p);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { loadReservations(); }, [propertyId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reservations.filter((r) => !q || [r.guest_name, r.phone, r.room_id].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [reservations, query]);

  const refresh = async () => {
    await loadReservations();
    if (selected) await loadFolio(selected);
  };

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await loadFolio(selected); }
    catch (e) { setError(e.message || 'Operation failed.'); }
    finally { setBusy(false); }
  };

  const total = Number(folio?.totals?.subtotal || 0);
  const paid = Number(folio?.totals?.paid || 0);
  const balance = Number(folio?.totals?.balance || 0);

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f8f7] p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="text-xl font-bold text-slate-950">Guest Folio & Cashier</h1><p className="mt-1 text-sm text-slate-500">Review live charges, record payments and settle guest balances.</p></div>
          <button className={btn + " border border-slate-200 bg-white text-slate-800"} onClick={refresh} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-3"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-slate-400"/><input className={input+" pl-9"} placeholder="Search guest or phone" value={query} onChange={(e)=>setQuery(e.target.value)}/></div></div>
            <div className="max-h-[650px] overflow-y-auto">
              {loading ? <div className="p-6 text-center text-sm text-slate-500">Loading stays…</div> :
              filtered.map((r) => <button key={r.id} onClick={()=>loadFolio(r)} className={`w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${selected?.id===r.id?'bg-slate-50':''}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{r.guest_name}</span><span className="font-mono text-xs text-slate-500">{r.status}</span></div>
                <div className="mt-1 text-xs text-slate-500">Room · {r.room_id?.slice(0,8)} · {r.arrival} → {r.departure}</div>
              </button>)}
              {!loading && !filtered.length && <div className="p-6 text-center text-sm text-slate-500">No active stays.</div>}
            </div>
          </section>

          <section className="min-h-[500px] rounded-xl border border-slate-200 bg-white">
            {!selected ? <div className="flex h-full min-h-[500px] items-center justify-center text-sm text-slate-500">Select a stay to open its folio.</div> :
            <div>
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="text-lg font-bold text-slate-950">{selected.guest_name}</div><div className="text-xs text-slate-500">Stay {selected.arrival} → {selected.departure}</div></div>
                <div className="flex gap-2"><button className={btn+" border border-slate-200 bg-white"} onClick={()=>setChargeOpen(true)}><Plus size={15}/> Add charge</button><button className={btn+" bg-[#FFD300] text-slate-950"} onClick={()=>setPaymentOpen(true)}><Banknote size={15}/> Take payment</button></div>
              </div>
              <div className="grid grid-cols-3 gap-3 border-b border-slate-200 p-4">
                <Metric label="Charges" value={money(total)}/><Metric label="Paid" value={money(paid)}/><Metric label="Balance" value={money(balance)} alert={balance>0}/>
              </div>
              <div className="p-4">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Folio charges</h2>
                <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">{['Date','Source','Description','Amount'].map(h=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>
                  {(folio?.charges||[]).map(c=><tr key={c.id} className="border-b border-slate-100"><td className="px-3 py-3 text-xs text-slate-500">{new Date(c.created_at).toLocaleString('en-KE')}</td><td className="px-3 py-3 capitalize">{c.source}</td><td className="px-3 py-3 font-medium">{c.description}</td><td className="px-3 py-3 text-right font-mono font-semibold">{money(c.amount)}</td></tr>)}
                  {!folio?.charges?.length&&<tr><td colSpan="4" className="px-3 py-8 text-center text-sm text-slate-500">No folio charges.</td></tr>}
                </tbody></table></div>
                <h2 className="mb-3 mt-6 text-xs font-bold uppercase tracking-wide text-slate-500">Payments</h2>
                <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">{['Date','Method','Amount'].map(h=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>
                  {payments.map(p=><tr key={p.id} className="border-b border-slate-100"><td className="px-3 py-3 text-xs text-slate-500">{new Date(p.created_at).toLocaleString('en-KE')}</td><td className="px-3 py-3 capitalize">{p.method}</td><td className="px-3 py-3 text-right font-mono font-semibold">{money(p.amount)}</td></tr>)}
                  {!payments.length&&<tr><td colSpan="3" className="px-3 py-8 text-center text-sm text-slate-500">No payments recorded.</td></tr>}
                </tbody></table></div>
              </div>
            </div>}
          </section>
        </div>
      </div>
      {chargeOpen && <ChargeModal busy={busy} onClose={()=>setChargeOpen(false)} onSubmit={(data)=>run(async()=>{await pmsService.addFolioCharge({propertyId,reservationId:selected.id,...data});setChargeOpen(false);})}/>}
      {paymentOpen && <PaymentModal balance={balance} busy={busy} onClose={()=>setPaymentOpen(false)} onSubmit={(data)=>run(async()=>{await pmsService.recordPayment({propertyId,reservationId:selected.id,...data});setPaymentOpen(false);})}/>}
    </div>
  );
}
function Metric({label,value,alert}){return <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-lg font-bold ${alert?'text-amber-700':'text-slate-950'}`}>{value}</div></div>}
function Modal({title,children,onClose}){return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-md rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">{title}</h2><button onClick={onClose}><X size={18}/></button></div><div className="p-5">{children}</div></div></div>}
function ChargeModal({onClose,onSubmit,busy}){const [description,setDescription]=useState('');const [amount,setAmount]=useState('');const [source,setSource]=useState('other');return <Modal title="Add folio charge" onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(description&&Number(amount)>0)onSubmit({description,amount:Number(amount),source})}} className="space-y-4"><label className="block text-xs font-semibold text-slate-600">Description<input className={input+" mt-1"} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Laundry, transfer, activity…" /></label><label className="block text-xs font-semibold text-slate-600">Source<select className={input+" mt-1"} value={source} onChange={e=>setSource(e.target.value)}><option value="other">Other</option><option value="room">Room</option><option value="pos">POS</option></select></label><label className="block text-xs font-semibold text-slate-600">Amount<input type="number" min="0.01" step="0.01" className={input+" mt-1"} value={amount} onChange={e=>setAmount(e.target.value)}/></label><button disabled={busy} className={btn+" w-full bg-slate-950 text-white"}><Plus size={15}/> Post charge</button></form></Modal>}
function PaymentModal({balance,onClose,onSubmit,busy}){const [amount,setAmount]=useState(String(balance>0?balance:''));const [method,setMethod]=useState('cash');return <Modal title="Take payment" onClose={onClose}><form onSubmit={e=>{e.preventDefault();const n=Number(amount);if(n>0&&n<=balance)onSubmit({amount:n,method})}} className="space-y-4"><div className="rounded-lg bg-slate-50 p-3 text-sm">Outstanding balance: <strong>{money(balance)}</strong></div><label className="block text-xs font-semibold text-slate-600">Amount<input type="number" min="0.01" max={balance} step="0.01" className={input+" mt-1"} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="block text-xs font-semibold text-slate-600">Payment method<select className={input+" mt-1"} value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="mpesa">M-Pesa</option><option value="bank_transfer">Bank transfer</option></select></label><button disabled={busy||balance<=0} className={btn+" w-full bg-[#FFD300] text-slate-950"}><CreditCard size={15}/> Record payment</button></form></Modal>}
