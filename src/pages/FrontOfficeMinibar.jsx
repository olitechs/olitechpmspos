import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
const input='h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]';
const money=(v,c)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c||'KES'}).format(Number(v||0));
export default function FrontOfficeMinibar(){
 const {user}=useAuth(),propertyId=user?.property?.id,currency=user?.property?.currency||'KES';
 const [reservations,setReservations]=useState([]),[products,setProducts]=useState([]),[charges,setCharges]=useState([]);
 const [reservationId,setReservationId]=useState(''),[productId,setProductId]=useState(''),[quantity,setQuantity]=useState('1'),[notes,setNotes]=useState(''),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{if(!propertyId){setLoading(false);return;}setLoading(true);try{
  const [r,p,c]=await Promise.all([
   supabase.from('reservations').select('id,guest_name,room_id,arrival,departure,confirmation_code,rooms:rooms(number,name)').eq('property_id',propertyId).eq('status','checked-in').order('arrival'),
   supabase.from('products').select('id,name,sku,category,unit,current_stock,selling_price,location').eq('property_id',propertyId).gt('selling_price',0).order('name'),
   supabase.from('folio_charges').select('id,reservation_id,description,amount,created_at').eq('property_id',propertyId).ilike('description','Minibar ·%').order('created_at',{ascending:false}).limit(100)
  ]);for(const x of [r,p,c])if(x.error)throw x.error;setReservations(r.data||[]);setProducts(p.data||[]);setCharges(c.data||[]);
  if(!reservationId&&r.data?.length)setReservationId(r.data[0].id);if(!productId&&p.data?.length)setProductId(p.data[0].id);
 }catch(e){toast.error(e.message||'Unable to load minibar records.');}finally{setLoading(false);}},[propertyId,reservationId,productId]);
 useEffect(()=>{load();},[load]);
 const selected=products.find(x=>x.id===productId),filtered=useMemo(()=>products.filter(x=>(x.name+' '+(x.sku||'')+' '+(x.category||'')).toLowerCase().includes(search.toLowerCase())),[products,search]);
 const total=Number(quantity||0)*Number(selected?.selling_price||0);
 const label=r=>r.guest_name+' · Room '+(r.rooms?.number||r.rooms?.name||'—')+' · '+(r.confirmation_code||r.id.slice(0,8));
 const post=async e=>{e.preventDefault();if(!reservationId||!productId||Number(quantity)<=0)return;setBusy(true);try{
  const {data,error}=await supabase.rpc('fn_post_minibar_consumption',{p_property_id:propertyId,p_reservation_id:reservationId,p_product_id:productId,p_quantity:Number(quantity),p_notes:notes.trim()||null});
  if(error)throw error;toast.success(data.product_name+' posted to guest folio · '+money(data.amount,currency));setQuantity('1');setNotes('');await load();
 }catch(e){toast.error(e.message||'Could not post consumption.');}finally{setBusy(false);}};
 return <div className="min-h-full bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office · Suite Services</div><h1 className="mt-1 text-2xl font-bold">Minibar & Extras</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Record guest consumption, deduct Store stock and post the charge to the correct in-house folio.</p></div><button type="button" onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><RefreshCw size={15}/> Refresh</button></header>
  <div className="grid gap-3 sm:grid-cols-3"><Metric label="In-house guests" value={reservations.length} icon={<ShoppingBag size={17}/>}/><Metric label="Priced Store products" value={products.length} icon={<Package size={17}/>}/><Metric label="Recent minibar postings" value={charges.length} icon={<ShoppingBag size={17}/>}/></div>
  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
   <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-semibold">Post guest consumption</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Only checked-in guests are selectable. Stock deduction and folio posting happen together in one database transaction.</p>
    <form onSubmit={post} className="mt-4 space-y-3">
     <label className="block text-xs font-semibold">Guest / room<select required value={reservationId} onChange={e=>setReservationId(e.target.value)} className={input+' mt-1'}><option value="">Select in-house guest</option>{reservations.map(r=><option key={r.id} value={r.id}>{label(r)}</option>)}</select></label>
     <label className="block text-xs font-semibold">Store product<select required value={productId} onChange={e=>setProductId(e.target.value)} className={input+' mt-1'}><option value="">Select product</option>{filtered.map(p=><option key={p.id} value={p.id}>{p.name} · {p.current_stock} {p.unit} available · {money(p.selling_price,currency)}</option>)}</select></label>
     <label className="block text-xs font-semibold">Search products<div className="relative mt-1"><Search size={15} className="absolute left-3 top-3 text-[var(--text-muted)]"/><input value={search} onChange={e=>setSearch(e.target.value)} className={input+' pl-9'} placeholder="Search name, SKU or category"/></div></label>
     <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Quantity<input required type="number" min="0.01" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)} className={input+' mt-1'}/></label><div className="rounded-lg bg-[var(--canvas)] p-3"><div className="text-xs text-[var(--text-muted)]">Charge total</div><div className="mt-1 text-xl font-bold tabular-nums">{money(total,currency)}</div><div className="text-[11px] text-[var(--text-muted)]">{selected?money(selected.selling_price,currency)+' per '+selected.unit:'Select a product'}</div></div></div>
     <label className="block text-xs font-semibold">Notes (optional)<input maxLength={240} value={notes} onChange={e=>setNotes(e.target.value)} className={input+' mt-1'} placeholder="Guest confirmation or consumption notes"/></label>
     <button disabled={busy||loading||!reservationId||!selected||Number(quantity)<=0||Number(quantity)>Number(selected?.current_stock||0)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/>{busy?'Posting consumption…':'Post to guest folio'}</button>
     {selected&&Number(quantity)>Number(selected.current_stock)&&<p className="text-xs text-[var(--danger-text)]">Insufficient stock. Available: {selected.current_stock} {selected.unit}.</p>}
     {!reservations.length&&!loading&&<p className="text-xs text-[var(--warning-text)]">No checked-in guests available.</p>}{!products.length&&!loading&&<p className="text-xs text-[var(--warning-text)]">No priced Store products found. Configure products and selling prices in Stores first.</p>}
    </form>
   </section>
   <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4"><h2 className="font-semibold">Recent minibar charges</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Charges remain in the existing guest folio ledger.</p></div>
    {loading?<div className="space-y-2 p-4"><div className="h-12 animate-pulse rounded bg-[var(--surface-2)]"/><div className="h-12 animate-pulse rounded bg-[var(--surface-2)]"/></div>:<div className="divide-y divide-[var(--border)]">{charges.map(c=>{const guest=reservations.find(r=>r.id===c.reservation_id);return <div key={c.id} className="flex items-start justify-between gap-3 p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{c.description}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{guest?label(guest):'Guest reservation'} · {new Date(c.created_at).toLocaleString()}</div></div><div className="shrink-0 text-sm font-bold tabular-nums">{money(c.amount,currency)}</div></div>;})}{!charges.length&&<p className="p-8 text-center text-sm text-[var(--text-muted)]">No minibar charges recorded yet.</p>}</div>}
   </section>
  </div><p className="text-xs text-[var(--text-muted)]">Uses the existing Products stock ledger and Folio charges table; no parallel inventory or billing system is introduced.</p>
 </div></div>;
}
function Metric({label,value,icon}){return <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="rounded-lg bg-[var(--canvas)] p-2">{icon}</span><div><div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</div><div className="mt-1 text-xl font-bold tabular-nums">{value}</div></div></div>;}
