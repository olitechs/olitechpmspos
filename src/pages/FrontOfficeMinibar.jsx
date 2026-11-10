import { useCallback,useEffect,useMemo,useState } from 'react';
import { Wine,RefreshCw,Search,ClipboardList,AlertTriangle,CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';

const input='h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]';
const money=(value,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'KES'}).format(Number(value||0));
export default function FrontOfficeMinibar(){
 const {user}=useAuth(),propertyId=user?.property?.id,currency=user?.property?.currency||'KES';
 const [reservations,setReservations]=useState([]),[products,setProducts]=useState([]),[charges,setCharges]=useState([]);
 const [reservationId,setReservationId]=useState(''),[productId,setProductId]=useState(''),[quantity,setQuantity]=useState('1'),[notes,setNotes]=useState('');
 const [productSearch,setProductSearch]=useState(''),[historySearch,setHistorySearch]=useState(''),[category,setCategory]=useState('all');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{
  if(!propertyId){setLoading(false);return;}setLoading(true);
  try{
   const [r,p,c]=await Promise.all([
    supabase.from('reservations').select('id,guest_name,room_id,arrival,departure,confirmation_code,rooms:rooms(number,name)').eq('property_id',propertyId).eq('status','checked-in').order('arrival'),
    supabase.from('products').select('id,name,sku,category,unit,current_stock,selling_price,location').eq('property_id',propertyId).gt('current_stock',0).gt('selling_price',0).order('category').order('name').limit(1000),
    supabase.from('folio_charges').select('id,reservation_id,description,amount,created_at,reservation:reservations(guest_name,confirmation_code,rooms:rooms(number,name))').eq('property_id',propertyId).eq('source','other').ilike('description','Minibar · %').order('created_at',{ascending:false}).limit(150)
   ]);
   for(const result of [r,p,c])if(result.error)throw result.error;
   setReservations(r.data||[]);setProducts(p.data||[]);setCharges(c.data||[]);
   if(!reservationId&&r.data?.length)setReservationId(r.data[0].id);
   if(!productId&&p.data?.length)setProductId(p.data[0].id);
   if(productId&&!(p.data||[]).some(x=>x.id===productId))setProductId(p.data?.[0]?.id||'');
  }catch(e){toast.error(e.message||'Unable to load minibar data.');}
  finally{setLoading(false);}
 },[propertyId,reservationId,productId]);
 useEffect(()=>{load();},[load]);
 const selectedProduct=products.find(p=>p.id===productId);
 const selectedReservation=reservations.find(r=>r.id===reservationId);
 const qty=Number(quantity),total=selectedProduct&&Number.isFinite(qty)&&qty>0?qty*Number(selectedProduct.selling_price):0;
 const categories=useMemo(()=>[...new Set(products.map(p=>p.category).filter(Boolean))].sort(),[products]);
 const visibleProducts=products.filter(p=>(category==='all'||p.category===category)&&[p.name,p.sku,p.category,p.location].some(v=>String(v||'').toLowerCase().includes(productSearch.toLowerCase())));
 const visibleCharges=charges.filter(c=>[c.description,c.reservation?.guest_name,c.reservation?.confirmation_code,c.reservation?.rooms?.number].some(v=>String(v||'').toLowerCase().includes(historySearch.toLowerCase())));
 const guestLabel=r=>(r.guest_name||'Guest')+' · Room '+(r.rooms?.number||r.rooms?.name||'—')+' · '+(r.confirmation_code||r.id.slice(0,8));
 const submit=async e=>{
  e.preventDefault();
  if(!propertyId||!reservationId||!productId||!Number.isFinite(qty)||qty<=0){toast.error('Choose an in-house guest and a valid product quantity.');return;}
  if(qty>Number(selectedProduct?.current_stock||0)){toast.error('Quantity exceeds available stock.');return;}
  setBusy(true);
  try{
   const {data,error}=await supabase.rpc('fn_post_minibar_consumption',{p_property_id:propertyId,p_reservation_id:reservationId,p_product_id:productId,p_quantity:qty,p_notes:notes.trim()||null});
   if(error)throw error;
   toast.success('Minibar consumption posted to the guest folio · '+money(data?.amount,currency));
   setQuantity('1');setNotes('');await load();
  }catch(e){toast.error(e.message||'Could not post minibar consumption.');}
  finally{setBusy(false);}
 };
 const lowStock=products.filter(p=>Number(p.current_stock)<=1).length;
 return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office · Suite Services</div><h1 className="mt-1 text-2xl font-bold">Minibar and Extras</h1><p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">Record in-room consumption, deduct stock and post the charge to the checked-in guest’s existing folio in one transaction.</p></div><button onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><RefreshCw size={15}/> Refresh</button></header>
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3"><div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-xs text-[var(--text-muted)]">In-house guests</div><div className="mt-1 text-2xl font-bold">{reservations.length}</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-xs text-[var(--text-muted)]">Available stock items</div><div className="mt-1 text-2xl font-bold">{products.length}</div></div><div className="col-span-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 lg:col-span-1"><div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><AlertTriangle size={14}/> Items with one unit or less</div><div className="mt-1 text-2xl font-bold">{lowStock}</div></div></div>
  <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
   <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="mb-4 flex items-center gap-2"><Wine size={18}/><h2 className="font-semibold">Post minibar consumption</h2></div>
    {loading?<div className="space-y-3"><div className="h-10 animate-pulse rounded-lg bg-[var(--canvas)]"/><div className="h-10 animate-pulse rounded-lg bg-[var(--canvas)]"/><div className="h-24 animate-pulse rounded-lg bg-[var(--canvas)]"/></div>:<form onSubmit={submit} className="space-y-3">
     <label className="block text-xs font-semibold">In-house guest and room<select value={reservationId} onChange={e=>setReservationId(e.target.value)} className={input+' mt-1'} required><option value="">Select checked-in guest</option>{reservations.map(r=><option key={r.id} value={r.id}>{guestLabel(r)}</option>)}</select></label>
     <div><label className="block text-xs font-semibold">Choose a stock item</label><div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]"><div className="relative"><Search size={14} className="absolute left-3 top-3 text-[var(--text-muted)]"/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Search name, SKU or category" className={input+' pl-9'}/></div><select aria-label="Filter product category" value={category} onChange={e=>setCategory(e.target.value)} className={input+' sm:w-40'}><option value="all">All categories</option>{categories.map(value=><option key={value} value={value}>{value}</option>)}</select></div><div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-1">{visibleProducts.map(p=><button type="button" key={p.id} onClick={()=>setProductId(p.id)} aria-pressed={productId===p.id} className={'flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-xs '+(productId===p.id?'bg-[var(--brand-primary)] text-white':'hover:bg-[var(--canvas)]')}><span className="min-w-0"><span className="block truncate font-semibold">{p.name}</span><span className={'block truncate '+(productId===p.id?'text-white/80':'text-[var(--text-muted)]')}>{p.category} · {p.sku||'No SKU'}</span></span><span className="shrink-0 text-right"><span className="block font-semibold">{money(p.selling_price,currency)}</span><span className={'block '+(productId===p.id?'text-white/80':'text-[var(--text-muted)]')}>Stock {p.current_stock} {p.unit||''}</span></span></button>)}{!visibleProducts.length&&<p className="p-3 text-center text-xs text-[var(--text-muted)]">No stock items match this filter.</p>}</div></div>
     {selectedProduct&&<div className="rounded-lg bg-[var(--canvas)] p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{selectedProduct.name}</span><span>{selectedProduct.category}</span></div><div className="mt-1 flex justify-between text-[var(--text-muted)]"><span>Available: {selectedProduct.current_stock} {selectedProduct.unit||'units'}</span><span>Unit price: {money(selectedProduct.selling_price,currency)}</span></div></div>}
     <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Quantity<input type="number" min="0.01" step="0.01" max={selectedProduct?.current_stock||undefined} value={quantity} onChange={e=>setQuantity(e.target.value)} className={input+' mt-1'} required/></label><div className="rounded-lg border border-[var(--border)] p-3"><div className="text-xs text-[var(--text-muted)]">Charge total</div><div className="mt-1 text-lg font-bold">{money(total,currency)}</div></div></div>
     <label className="block text-xs font-semibold">Notes (optional)<textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} maxLength={240} placeholder="Room check, guest confirmation or other details" className={input+' mt-1 h-auto py-2'}/></label>
     <button disabled={busy||!reservationId||!productId||!selectedProduct||!Number.isFinite(qty)||qty<=0||qty>Number(selectedProduct?.current_stock||0)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 size={16}/>{busy?'Posting…':'Post to guest folio'}</button>
     <p className="text-[11px] leading-5 text-[var(--text-muted)]">Posting deducts the selected product from property stock and creates a folio charge atomically. Only checked-in reservations can be charged. The charge appears in the guest’s existing Folio and final invoice.</p>
    </form>}
    {!loading&&!reservations.length&&<p className="mt-3 rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">There are no checked-in guests available for minibar posting.</p>}
    {!loading&&!products.length&&<p className="mt-3 rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">No products currently have both available stock and a selling price. Configure stock and selling prices in Stores before posting minibar consumption.</p>}
   </section>
   <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ClipboardList size={17}/><h2 className="font-semibold">Recent minibar charges</h2></div><span className="text-xs text-[var(--text-muted)]">{visibleCharges.length} records</span></div><div className="relative mt-3"><Search size={14} className="absolute left-3 top-3 text-[var(--text-muted)]"/><input value={historySearch} onChange={e=>setHistorySearch(e.target.value)} placeholder="Search guest, room or item" className={input+' pl-9'}/></div></div>
    {loading?<div className="space-y-3 p-4">{[1,2,3].map(i=><div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--canvas)]"/> )}</div>:<div className="divide-y divide-[var(--border)]">{visibleCharges.map(c=><article key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><div className="font-semibold text-sm">{c.description}</div><div className="mt-1 truncate text-xs text-[var(--text-muted)]">{c.reservation?.guest_name||'Guest'} · Room {c.reservation?.rooms?.number||c.reservation?.rooms?.name||'—'} · {new Date(c.created_at).toLocaleString()}</div><div className="mt-1 text-[10px] text-[var(--text-muted)]">Booking {c.reservation?.confirmation_code||c.reservation_id.slice(0,8)}</div></div><div className="text-sm font-bold tabular-nums">{money(c.amount,currency)}</div></article>)}{!visibleCharges.length&&<p className="p-8 text-center text-sm text-[var(--text-muted)]">No minibar charges match this search.</p>}</div>}
   </section>
  </div>
  <p className="text-xs text-[var(--text-muted)]">Minibar activity uses the existing inventory movement ledger and guest folio ledger. It does not create a separate minibar stock balance or duplicate invoice.</p>
 </div></div>;
}
