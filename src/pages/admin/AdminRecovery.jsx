import { useCallback, useEffect, useState } from 'react';
import { Search, Printer, KeyRound, Building2, ShieldAlert, Copy, X } from 'lucide-react';
import { platformService } from '@/services/platformService';
import { printReceipt } from '@/services/printService';
import { toast } from 'sonner';

const dt = (v) => v ? new Date(v).toLocaleString() : '—';
const money = (v,c='KES') => new Intl.NumberFormat('en-KE',{style:'currency',currency:c || 'KES'}).format(Number(v || 0));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function printFolio(f) {
  const currency=f.property_currency || 'KES';
  const entries=[...(f.charges||[]).map(x=>({date:x.created_at,label:x.description,ref:x.reference||x.source,type:'Charge',amount:Number(x.amount||0)})),...(f.payments||[]).map(x=>({date:x.created_at,label:x.method,ref:x.reference||x.id,type:'Payment',amount:-Number(x.amount||0)})),...(f.refunds||[]).map(x=>({date:x.created_at,label:'Refund',ref:x.id,type:'Refund',amount:Number(x.amount||0)}))].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const body=entries.map(x=>'<tr><td>'+esc(dt(x.date))+'</td><td>'+esc(x.label)+'</td><td>'+esc(x.ref)+'</td><td>'+esc(x.type)+'</td><td>'+money(x.amount,currency)+'</td></tr>').join('');
  const html='<!doctype html><html><head><title>Historical Guest Folio</title><style>body{font:14px Arial;margin:28px;color:#17233a}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #ddd}td:last-child,th:last-child{text-align:right}.meta{padding:12px;background:#f4f7fb;margin:16px 0}.total{text-align:right;font-weight:bold;margin-top:18px}@media print{body{margin:12mm}}</style></head><body><h2>Historical Guest Folio</h2><p>Recovery copy · Original entries preserved</p><div class="meta">Guest: '+esc(f.guest_name)+' · Room: '+esc(f.room_number)+' · Confirmation: '+esc(f.confirmation_code||f.id)+'<br>Stay: '+esc(f.arrival)+' – '+esc(f.departure)+' · Status: '+esc(f.status)+'</div><table><thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Type</th><th>Amount</th></tr></thead><tbody>'+body+'</tbody></table><div class="total">Charges: '+money(f.totals?.subtotal,currency)+' · Paid: '+money(f.totals?.paid,currency)+' · Balance: '+money(f.totals?.balance,currency)+'</div><p>Historical administrative recovery copy. No financial entry has been posted or modified.</p><script>window.onload=function(){window.print()}</script></body></html>';
  const w=window.open('', '_blank');
  if(!w){toast.error('Allow pop-ups to print the folio.');return;}
  w.document.write(html);w.document.close();
}

export default function AdminRecovery() {
  const [properties,setProperties]=useState([]);\n  const [users,setUsers]=useState([]);
  const [propertyId,setPropertyId]=useState('');
  const [kind,setKind]=useState('receipts');
  const [query,setQuery]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [rows,setRows]=useState([]);
  const [selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false);
  const [userId,setUserId]=useState('');
  const [recovery,setRecovery]=useState(null);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{Promise.all([platformService.listProperties(),platformService.getUserDirectory()]).then(([p,u])=>{setProperties(p);setUsers(u);if(p[0])setPropertyId(p[0].id)}).catch(e=>toast.error(e.message));},[]);
  const property=properties.find(x=>x.id===propertyId);\n  const propertyUsers=users.filter(u=>(u.property_memberships||[]).some(m=>m.property_id===propertyId));
  const search=useCallback(async()=>{
    if(!propertyId || (!query.trim()&&!from&&!to)){toast.error('Select a property and enter a search term or date range.');return;}
    setLoading(true);setSelected(null);
    try {const data=kind==='receipts'?await platformService.searchHistoricalReceipts({propertyId,query,from,to}):await platformService.searchGuestFolios({propertyId,query,from,to});setRows(data);if(!data.length)toast.info('No matching historical records found.');}
    catch(e){toast.error(e.message||'Historical search failed.');}
    finally{setLoading(false);}
  },[propertyId,kind,query,from,to]);

  const reprint=async(r)=>{
    const result=await printReceipt('RECEIPT',{propertyId:r.property_id,orderNumber:r.order_number,checkNo:r.order_number,table:r.table_number?'Table '+r.table_number:'—',waiter:r.waiter||'Unassigned',covers:r.covers,items:r.items||[],total:r.total,subtotal:r.subtotal,discountAmount:r.discount_amount,discountName:r.discount_name,vat:r.vat,currency:r.property_currency||property?.currency||'KES',paymentMethod:r.payment_method,createdAt:r.created_at,recoveryCopy:true});
    if(result?.ok)toast.success('Historical receipt sent to the configured printer.');else toast.error(result?.friendlyError||'Could not print receipt.');
  };
  const makeLink=async()=>{
    setBusy(true);setRecovery(null);
    try{setRecovery(await platformService.generateAccountRecoveryLink({propertyId,userId}));toast.success('Single-use recovery link generated.');}
    catch(e){toast.error(e.message||'Could not generate recovery link.');}
    finally{setBusy(false);}
  };

  return <div className="space-y-6">
    <header><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary"/><h1 className="text-2xl font-bold">Historical recovery centre</h1></div><p className="mt-1 text-sm text-muted-foreground">Search old receipts and guest folios, print recovery copies, and assist property users with account access.</p></header>
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-primary"/>Property-scoped records</div>
      <select value={propertyId} onChange={e=>{setPropertyId(e.target.value);setRows([]);setSelected(null);setRecovery(null)}} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">{properties.map(p=><option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}</select>
      <div className="flex gap-2"><button onClick={()=>{setKind('receipts');setRows([]);setSelected(null)}} className={'rounded-lg px-3 py-2 text-sm '+(kind==='receipts'?'bg-primary text-primary-foreground':'border border-border')}>Historical receipts</button><button onClick={()=>{setKind('folios');setRows([]);setSelected(null)}} className={'rounded-lg px-3 py-2 text-sm '+(kind==='folios'?'bg-primary text-primary-foreground':'border border-border')}>Guest folios</button></div>
      <label className="block text-xs text-muted-foreground">{kind==='receipts'?'Receipt number, guest, room or table':'Guest name, phone, confirmation or room'}</label>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search historical records…" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"/>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-muted-foreground">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"/></label><label className="text-xs text-muted-foreground">To<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm"/></label><button onClick={search} disabled={loading||!propertyId} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Search className="h-4 w-4"/>{loading?'Searching…':'Search history'}</button></div>
      <p className="text-xs text-muted-foreground">Up to 100 results per search. Receipt dates use creation time; folio dates use reservation arrival.</p>
    </section>
    {rows.length>0&&<section className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border p-4 text-sm font-semibold">{rows.length} matching records</div><div className="divide-y divide-border">{rows.map((r,i)=><button key={r.id||i} onClick={()=>setSelected(r)} className="flex w-full flex-col gap-1 p-4 text-left hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"><span><b className="block text-sm">{kind==='receipts'?(r.order_number||'Receipt'):(r.guest_name||'Guest folio')}</b><span className="text-xs text-muted-foreground">{kind==='receipts'?(r.guest_name||r.room_number||'No guest'):(r.confirmation_code||r.id)} · {dt(r.created_at)}</span></span><b className="text-sm">{money(kind==='receipts'?r.total:r.totals?.subtotal,r.property_currency||property?.currency)}</b></button>)}</div></section>}
    {selected&&<section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex justify-between"><div><h2 className="font-semibold">{kind==='receipts'?'Receipt details':'Guest folio details'}</h2><p className="text-xs text-muted-foreground">Original record · {dt(selected.created_at)}</p></div><button onClick={()=>setSelected(null)} aria-label="Close details"><X className="h-4 w-4"/></button></div>
      {kind==='receipts'?<><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div>Receipt<b className="block">{selected.order_number||selected.id}</b></div><div>Guest<b className="block">{selected.guest_name||'—'}</b></div><div>Room / table<b className="block">{selected.room_number||selected.table_number||'—'}</b></div><div>Payment<b className="block capitalize">{selected.payment_method||'—'}</b></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left"><th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th></tr></thead><tbody>{(selected.items||[]).map((x,i)=><tr key={i} className="border-b border-border/60"><td className="py-2">{x.name}</td><td className="py-2 text-right">{x.qty}</td><td className="py-2 text-right">{money(Number(x.price||0)*Number(x.qty||0),selected.property_currency)}</td></tr>)}</tbody></table></div><div className="text-right text-sm font-bold">Total: {money(selected.total,selected.property_currency)}</div><p className="text-xs text-muted-foreground">A duplicate paper copy is printed from the original record; no new sale or payment is created.</p><button onClick={()=>reprint(selected)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4"/>Reprint original receipt</button>{(selected.refunds||[]).length>0&&<div className="text-xs text-muted-foreground">Refund records: {selected.refunds.length}</div>}</>
      :<><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div>Guest<b className="block">{selected.guest_name}</b></div><div>Room<b className="block">{selected.room_number||'—'}</b></div><div>Arrival<b className="block">{selected.arrival}</b></div><div>Departure<b className="block">{selected.departure}</b></div></div><h3 className="text-sm font-semibold">Charges</h3>{(selected.charges||[]).map(x=><div key={x.id} className="flex justify-between gap-2 border-b border-border py-2 text-sm"><span>{x.description}<small className="block text-xs text-muted-foreground">{dt(x.created_at)} · {x.reference||x.source}</small></span><b>{money(x.amount,selected.property_currency)}</b></div>)}<h3 className="pt-2 text-sm font-semibold">Payments</h3>{(selected.payments||[]).map(x=><div key={x.id} className="flex justify-between gap-2 border-b border-border py-2 text-sm"><span>{x.method}<small className="block text-xs text-muted-foreground">{dt(x.created_at)} · {x.reference||x.id}</small></span><b>{money(x.amount,selected.property_currency)}</b></div>)}<div className="text-right text-sm font-bold">Balance: {money(selected.totals?.balance,selected.property_currency)}</div><p className="text-xs text-muted-foreground">Read-only recovery view. This does not reopen the stay or modify its financial ledger.</p><button onClick={()=>printFolio(selected)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Printer className="h-4 w-4"/>Print historical folio statement</button>{(selected.receipts||[]).length>0&&<div className="pt-2"><h3 className="text-sm font-semibold">Related receipts</h3>{selected.receipts.map(r=><button key={r.id} onClick={()=>{setKind('receipts');setSelected(r)}} className="mr-3 mt-2 text-sm text-primary underline">{r.order_number||r.id}</button>)}</div>}</>}
    </section>}
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-primary"/>Property account recovery</div><p className="text-sm text-muted-foreground">Generate a one-time password recovery link for an account belonging to this property. The link is not emailed or stored; verify the account holder's identity and share it privately.</p><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><select value={userId} onChange={e=>{setUserId(e.target.value);setRecovery(null)}} className="h-11 rounded-lg border border-border bg-background px-3 text-sm"><option value="">Select a property user…</option>{propertyUsers.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name||u.email} · {u.email}</option>)}</select><button onClick={makeLink} disabled={!userId||!propertyId||busy} className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy?'Generating…':'Generate recovery link'}</button></div>{recovery&&<div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><b className="text-sm">Temporary link for {recovery.email}</b><p className="break-all text-xs text-muted-foreground">{recovery.actionLink}</p><button onClick={()=>navigator.clipboard.writeText(recovery.actionLink).then(()=>toast.success('Copied. Share privately with the account holder.'))} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5"/>Copy recovery link</button></div>}</section>
  </div>;
}