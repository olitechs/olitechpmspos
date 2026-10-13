import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Activity, Monitor, Plus, RefreshCw, Search, Smartphone, Tablet, ToggleLeft, ToggleRight, Trash2, X} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/lib/AuthContext';
import {supabase} from '@/lib/supabaseClient';

const input='mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10';
const emptyForm={name:'',terminal_code:'',device_type:'desktop',store_id:'',notes:''};
const deviceTypes=[['desktop','Desktop POS'],['tablet','Tablet'],['mobile','Mobile device'],['kiosk','Self-service kiosk']];

export default function POSDevicesPage(){
 const {user}=useAuth();
 const propertyId=user?.property?.id;
 const [stores,setStores]=useState([]);
 const [devices,setDevices]=useState([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [modal,setModal]=useState(false);
 const [editing,setEditing]=useState(null);
 const [form,setForm]=useState(emptyForm);
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('all');

 const load=useCallback(async()=>{
  if(!propertyId){setStores([]);setDevices([]);setLoading(false);return}
  setLoading(true);
  try{
   const [storeResult,deviceResult]=await Promise.all([
    supabase.from('stores').select('id,name,workspace_id,property_id,is_default').eq('property_id',propertyId).order('is_default',{ascending:false}).order('name'),
    supabase.from('pos_devices').select('id,name,terminal_code,device_type,status,notes,store_id,property_id,workspace_id,created_at,updated_at,last_seen_at').eq('property_id',propertyId).order('created_at',{ascending:false})
   ]);
   if(storeResult.error)throw storeResult.error;
   if(deviceResult.error)throw deviceResult.error;
   setStores(storeResult.data||[]);setDevices(deviceResult.data||[]);
  }catch(e){toast.error(e.message||'Unable to load POS terminals.')}
  finally{setLoading(false)}
 },[propertyId]);
 useEffect(()=>{load()},[load]);

 const storeName=id=>stores.find(s=>s.id===id)?.name||'Unknown store';
 const visible=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return devices.filter(d=>(filter==='all'||d.status===filter)&&(!q||[d.name,d.terminal_code,d.device_type,storeName(d.store_id)].some(v=>String(v||'').toLowerCase().includes(q))));
 },[devices,filter,query,stores]);
 const openNew=()=>{setEditing(null);setForm({...emptyForm,store_id:stores.find(s=>s.is_default)?.id||stores[0]?.id||''});setModal(true)};
 const openEdit=d=>{setEditing(d);setForm({name:d.name||'',terminal_code:d.terminal_code||'',device_type:d.device_type||'desktop',store_id:d.store_id||'',notes:d.notes||''});setModal(true)};
 const save=async()=>{
  if(!propertyId)return toast.error('No active property is selected.');
  if(!form.name.trim()||!form.terminal_code.trim()||!form.store_id)return toast.error('Enter a terminal name, terminal code and store.');
  const store=stores.find(s=>s.id===form.store_id);
  if(!store)return toast.error('Select a valid store.');
  const payload={name:form.name.trim(),terminal_code:form.terminal_code.trim().toUpperCase(),device_type:form.device_type,store_id:store.id,workspace_id:store.workspace_id,property_id:propertyId,notes:form.notes.trim()||null};
  setSaving(true);
  try{
   const result=editing
    ?await supabase.from('pos_devices').update({name:payload.name,terminal_code:payload.terminal_code,device_type:payload.device_type,notes:payload.notes,store_id:payload.store_id,workspace_id:payload.workspace_id}).eq('id',editing.id).eq('property_id',propertyId).select().single()
    :await supabase.from('pos_devices').insert({...payload,status:'active'}).select().single();
   if(result.error)throw result.error;
   toast.success(editing?'Terminal details updated.':'POS terminal registered.');
   setModal(false);await load();
  }catch(e){toast.error(e.message||'Unable to save terminal.')}
  finally{setSaving(false)}
 };
 const toggleStatus=async d=>{
  const next=d.status==='active'?'disabled':'active';
  try{const {error}=await supabase.from('pos_devices').update({status:next}).eq('id',d.id).eq('property_id',propertyId);if(error)throw error;setDevices(rows=>rows.map(x=>x.id===d.id?{...x,status:next}:x));toast.success(next==='active'?'Terminal enabled.':'Terminal disabled.')}
  catch(e){toast.error(e.message||'Unable to change terminal status.')}
 };
 const remove=async d=>{
  if(!window.confirm('Delete terminal '+d.terminal_code+'? This removes its registration record.'))return;
  try{const {error}=await supabase.from('pos_devices').delete().eq('id',d.id).eq('property_id',propertyId);if(error)throw error;setDevices(rows=>rows.filter(x=>x.id!==d.id));toast.success('Terminal registration deleted.')}
  catch(e){toast.error(e.message||'Unable to delete terminal.')}
 };
 const active=devices.filter(d=>d.status==='active').length;
 return <div className="min-h-full bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-7xl space-y-5">
  <header className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-slate-500">Stores / Device management</div><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">POS Devices</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Register cashier terminals, assign each terminal to a store, and control whether it is enabled for use.</p></div><div className="flex gap-2"><button type="button" onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><RefreshCw size={15} className={loading?'animate-spin':''}/> Refresh</button><button type="button" onClick={openNew} disabled={!stores.length} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0E7482] px-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"><Plus size={16}/> Register device</button></div></header>
  <div className="grid gap-3 sm:grid-cols-3"><Metric label="Registered terminals" value={devices.length} icon={<Monitor size={18}/>} /><Metric label="Enabled" value={active} icon={<Activity size={18}/>} /><Metric label="Disabled" value={devices.length-active} icon={<ToggleLeft size={18}/>} /></div>
  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center"><div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search terminal, code or store…" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-teal-600"/></div><div className="flex gap-1 rounded-xl bg-slate-100 p-1">{[['all','All'],['active','Enabled'],['disabled','Disabled']].map(([v,l])=><button key={v} type="button" onClick={()=>setFilter(v)} className={'rounded-lg px-3 py-2 text-xs font-bold '+(filter===v?'bg-white text-slate-900 shadow-sm':'text-slate-500')}>{l}</button>)}</div></div>
   {loading?<div className="p-12 text-center text-sm text-slate-500">Loading registered devices…</div>:!stores.length?<div className="p-12 text-center"><Monitor size={30} className="mx-auto text-slate-300"/><h2 className="mt-3 font-bold text-slate-800">No stores are linked to this property</h2><p className="mt-1 text-sm text-slate-500">Create or link a store before registering a POS terminal.</p></div>:!visible.length?<div className="p-12 text-center"><Monitor size={30} className="mx-auto text-slate-300"/><h2 className="mt-3 font-bold text-slate-800">{devices.length?'No matching terminals':'No POS devices registered'}</h2><p className="mt-1 text-sm text-slate-500">{devices.length?'Try another search or status filter.':'Register a terminal to begin organizing POS workstations by store.'}</p>{!devices.length&&<button onClick={openNew} className="mt-4 rounded-xl bg-[#0E7482] px-4 py-2.5 text-sm font-bold text-white">Register first device</button>}</div>:<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Terminal</th><th className="px-5 py-3">Store</th><th className="px-5 py-3">Device type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Registered</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody>{visible.map(d=><tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-100 p-2 text-slate-600">{d.device_type==='tablet'?<Tablet size={18}/>:d.device_type==='mobile'?<Smartphone size={18}/>:<Monitor size={18}/>}</div><div><div className="font-bold text-slate-900">{d.name}</div><div className="mt-0.5 font-mono text-xs text-slate-500">{d.terminal_code}</div></div></div></td><td className="px-5 py-4 text-slate-700">{storeName(d.store_id)}</td><td className="px-5 py-4 text-slate-600">{deviceTypes.find(([v])=>v===d.device_type)?.[1]||d.device_type}</td><td className="px-5 py-4"><span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold '+(d.status==='active'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600')}><span className={'h-1.5 w-1.5 rounded-full '+(d.status==='active'?'bg-emerald-500':'bg-slate-400')}/>{d.status==='active'?'Enabled':'Disabled'}</span></td><td className="px-5 py-4 text-xs text-slate-500">{d.created_at?new Date(d.created_at).toLocaleDateString('en-KE'):'—'}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button title="Edit terminal" onClick={()=>openEdit(d)} className="rounded-lg px-3 py-2 text-xs font-bold text-teal-700 hover:bg-teal-50">Edit</button><button title={d.status==='active'?'Disable terminal':'Enable terminal'} onClick={()=>toggleStatus(d)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">{d.status==='active'?<ToggleRight size={19}/>:<ToggleLeft size={19}/>}</button><button title="Delete registration" onClick={()=>remove(d)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>}
  </section>
  <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-900"><Activity size={17} className="mt-0.5 shrink-0"/><p><b>Registration vs. live connectivity:</b> this page stores terminal identity and store assignment. Enabled means the terminal is permitted by this registry; it does not prove the device is online or authenticate a live POS session. Live heartbeat and terminal enforcement must be wired into the POS runtime separately.</p></div>
 </div>
 {modal&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false)}}><section role="dialog" aria-modal="true" aria-labelledby="pos-device-dialog-title" className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 id="pos-device-dialog-title" className="text-lg font-black text-slate-950">{editing?'Edit POS terminal':'Register POS terminal'}</h2><p className="mt-1 text-xs text-slate-500">Terminal codes must be unique within this property.</p></div><button onClick={()=>setModal(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">Terminal name<input autoFocus value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className={input} placeholder="Main bar POS"/></label><label className="text-xs font-bold text-slate-700">Terminal code<input value={form.terminal_code} onChange={e=>setForm(f=>({...f,terminal_code:e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'')}))} className={input} placeholder="BAR-01" maxLength={32}/></label><label className="text-xs font-bold text-slate-700">Store<select value={form.store_id} onChange={e=>setForm(f=>({...f,store_id:e.target.value}))} className={input}><option value="">Select store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="text-xs font-bold text-slate-700">Device type<select value={form.device_type} onChange={e=>setForm(f=>({...f,device_type:e.target.value}))} className={input}>{deviceTypes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="sm:col-span-2 text-xs font-bold text-slate-700">Notes (optional)<textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className={input} rows={3} maxLength={500} placeholder="Location or identifying details"/></label></div><div className="flex justify-end gap-2 border-t border-slate-100 p-5"><button onClick={()=>setModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</button><button disabled={saving} onClick={save} className="rounded-xl bg-[#0E7482] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving?'Saving…':editing?'Save changes':'Register device'}</button></div></section></div>}
 </div>;
}

function Metric({label,value,icon}){return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between text-slate-500"><span className="text-xs font-bold uppercase tracking-wider">{label}</span>{icon}</div><div className="mt-3 text-3xl font-black tabular-nums text-slate-950">{value}</div></div>}
