import { useCallback,useEffect,useMemo,useState } from 'react';
import { Shirt,Plus,RefreshCw,Search,CheckCircle2,Clock3,PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
const input='h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]';
const stages=['received','washing','ready','delivered'];
const labels={received:'Received',washing:'Washing',ready:'Ready for collection',delivered:'Delivered',cancelled:'Cancelled'};
const money=(v,c)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c||'KES'}).format(Number(v||0));
const blank=()=>({name:'',quantity:'1',unitPrice:'0'});
export default function FrontOfficeLaundry(){
 const {user}=useAuth(),propertyId=user?.property?.id,currency=user?.property?.currency||'KES';
 const [reservations,setReservations]=useState([]),[orders,setOrders]=useState([]),[reservationId,setReservationId]=useState('');
 const [items,setItems]=useState([blank()]),[notes,setNotes]=useState(''),[filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{if(!propertyId){setLoading(false);return;}setLoading(true);try{
  const [r,o]=await Promise.all([
   supabase.from('reservations').select('id,guest_name,room_id,arrival,departure,confirmation_code,rooms:rooms(number,name)').eq('property_id',propertyId).eq('status','checked-in').order('arrival'),
   supabase.from('laundry_orders').select('*').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(150)
  ]);if(r.error)throw r.error;if(o.error)throw o.error;setReservations(r.data||[]);setOrders(o.data||[]);
  if(!reservationId&&r.data?.length)setReservationId(r.data[0].id);
 }catch(e){toast.error(e.message||'Unable to load laundry queue.');}finally{setLoading(false);}},[propertyId,reservationId]);
 useEffect(()=>{load();},[load]);
 const guestLabel=r=>r.guest_name+' · Room '+(r.rooms?.number||r.rooms?.name||'—')+' · '+(r.confirmation_code||r.id.slice(0,8));
 const total=useMemo(()=>items.reduce((sum,x)=>sum+Math.max(0,Number(x.quantity)||0)*Math.max(0,Number(x.unitPrice)||0),0),[items]);
 const updateItem=(index,key,value)=>setItems(old=>old.map((x,i)=>i===index?{...x,[key]:value}:x));
 const create=async e=>{e.preventDefault();const reservation=reservations.find(x=>x.id===reservationId);
  const valid=items.filter(x=>x.name.trim()&&Number(x.quantity)>0&&Number(x.unitPrice)>=0);
  if(!reservation){toast.error('Select an in-house guest before creating a charge.');return;}
  if(!valid.length||valid.length!==items.length){toast.error('Complete each laundry item with a valid quantity and price.');return;}
  setBusy(true);try{
   const {data,error}=await supabase.rpc('fn_create_laundry_order_with_folio',{p_property_id:propertyId,p_reservation_id:reservation.id,p_items:valid.map(x=>({name:x.name.trim(),qty:Number(x.quantity),unit_price:Number(x.unitPrice),line_total:Number(x.quantity)*Number(x.unitPrice)})),p_notes:notes.trim()||null});
   if(error)throw error;toast.success('Laundry order '+data.order_id.slice(0,8)+' created · '+money(data.total,currency)+' posted to folio.');
   setItems([blank()]);setNotes('');await load();
  }catch(e){toast.error(e.message||'Could not create laundry order.');}finally{setBusy(false);}
 };
 const advance=async order=>{const next=stages[stages.indexOf(order.status)+1];if(!next)return;setBusy(true);try{const {error}=await supabase.rpc('fn_update_laundry_order',{p_order_id:order.id,p_status:next,p_notes:null});if(error)throw error;toast.success('Order moved to '+labels[next]+'.');await load();}catch(e){toast.error(e.message||'Could not update order.');}finally{setBusy(false);}};
 const filtered=orders.filter(o=>(filter==='all'||o.status===filter)&&((o.guest_name||'').toLowerCase().includes(search.toLowerCase())||(o.notes||'').toLowerCase().includes(search.toLowerCase())||o.id.toLowerCase().includes(search.toLowerCase())));
 const counts=stages.reduce((a,s)=>(a[s]=orders.filter(o=>o.status===s).length,a),{});
 return <div className="min-h-full bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office · Guest Services</div><h1 className="mt-1 text-2xl font-bold">Laundry Management</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Receive guest laundry, price each item, track processing and post charges to the guest folio.</p></div><button onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><RefreshCw size={15}/> Refresh queue</button></header>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stages.map((s,i)=><div key={s} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">{i===0?<Shirt size={15}/>:i===3?<CheckCircle2 size={15}/>:<Clock3 size={15}/>} {labels[s]}</div><div className="mt-1 text-2xl font-bold tabular-nums">{counts[s]||0}</div></div>)}</div>
  <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.4fr)]">
   <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="mb-4 flex items-center gap-2"><Shirt size={18}/><h2 className="font-semibold">New laundry order</h2></div>
    <form onSubmit={create} className="space-y-3">
     <label className="block text-xs font-semibold">In-house guest / room<select required value={reservationId} onChange={e=>setReservationId(e.target.value)} className={input+' mt-1'}><option value="">Select checked-in guest</option>{reservations.map(r=><option key={r.id} value={r.id}>{guestLabel(r)}</option>)}</select></label>
     <div className="flex items-center justify-between"><span className="text-xs font-semibold">Laundry items & pricing</span><button type="button" onClick={()=>setItems(x=>[...x,blank()])} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]"><Plus size={14}/> Add item</button></div>
     {items.map((item,i)=><div key={i} className="rounded-lg border border-[var(--border)] p-3"><div className="grid grid-cols-2 gap-2"><label className="col-span-2 block text-xs">Item / service<input required value={item.name} onChange={e=>updateItem(i,'name',e.target.value)} className={input+' mt-1'} placeholder="e.g. Shirt, trousers, bedsheet"/></label><label className="block text-xs">Quantity<input required type="number" min="0.01" step="0.01" value={item.quantity} onChange={e=>updateItem(i,'quantity',e.target.value)} className={input+' mt-1'}/></label><label className="block text-xs">Unit price<input required type="number" min="0" step="0.01" value={item.unitPrice} onChange={e=>updateItem(i,'unitPrice',e.target.value)} className={input+' mt-1'}/></label></div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-[var(--text-muted)]">Line total</span><span className="font-semibold tabular-nums">{money(Number(item.quantity)*Number(item.unitPrice),currency)}</span>{items.length>1&&<button type="button" onClick={()=>setItems(x=>x.filter((_,j)=>j!==i))} className="text-[var(--danger-text)]">Remove</button>}</div></div>)}
     <label className="block text-xs font-semibold">Instructions / notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={500} rows={2} className={input+' h-auto py-2'} placeholder="Stains, delicate fabric, express service…"/></label>
     <div className="flex items-center justify-between rounded-lg bg-[var(--canvas)] p-3"><span className="text-sm font-semibold">Order total</span><span className="text-xl font-bold tabular-nums">{money(total,currency)}</span></div>
     <button disabled={busy||loading||!reservationId||!items.length||total<0} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--on-primary)] disabled:opacity-50"><Plus size={16}/>{busy?'Saving order…':'Create order & post to folio'}</button>
     {!reservations.length&&!loading&&<p className="text-xs text-[var(--warning-text)]">No checked-in guests are available. Laundry charges require an active guest reservation.</p>}
    </form>
   </section>
   <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Laundry processing queue</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Advance each order through received, washing, ready and delivered.</p></div><PackageCheck size={19}/></div><div className="mt-3 flex flex-wrap gap-2"><div className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-3 text-[var(--text-muted)]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search guest, note or order" className={input+' pl-9'}/></div><select value={filter} onChange={e=>setFilter(e.target.value)} className={input+' w-auto min-w-32'}><option value="all">All statuses</option>{stages.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></div></div>
    {loading?<div className="space-y-3 p-4">{[1,2,3].map(i=><div key={i} className="h-20 animate-pulse rounded-lg bg-[var(--canvas)]"/>)}</div>:<div className="divide-y divide-[var(--border)]">{filtered.map(o=><article key={o.id} className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold">{o.guest_name||'Guest'} <span className="font-normal text-[var(--text-muted)]">· {o.notes||'Laundry order'}</span></div><div className="mt-1 text-xs text-[var(--text-muted)]">#{o.id.slice(0,8)} · {new Date(o.created_at).toLocaleString()}</div></div><div className="text-right"><div className="font-bold tabular-nums">{money(o.total,currency)}</div><span className="text-xs text-[var(--text-muted)]">{labels[o.status]||o.status}</span></div></div><div className="flex flex-wrap gap-2">{(Array.isArray(o.items)?o.items:[]).map((x,i)=><span key={i} className="rounded-md bg-[var(--canvas)] px-2 py-1 text-xs">{x.name} × {x.qty} · {money(x.line_total??(x.qty*x.unit_price),currency)}</span>)}</div>{o.status!=='delivered'&&o.status!=='cancelled'&&<button disabled={busy} onClick={()=>advance(o)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50">Mark {labels[stages[stages.indexOf(o.status)+1]]||'next stage'}</button>}</article>)}{!filtered.length&&<p className="p-8 text-center text-sm text-[var(--text-muted)]">No laundry orders match this view.</p>}</div>}
   </section>
  </div><p className="text-xs text-[var(--text-muted)]">Laundry uses the existing laundry_orders workflow and folio_charges ledger. Laundry service is not deducted from store inventory; stock is only adjusted where physical stock is actually consumed.</p>
 </div></div>;
}
