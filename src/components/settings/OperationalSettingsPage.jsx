import React,{useEffect,useState} from 'react';
import {Plus,Trash2,RefreshCw,Star,ShieldCheck} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/lib/AuthContext';
import {backOfficeService} from '@/services/backOfficeService';
import {featureMatrix,PACKAGE_LABELS} from '@/lib/entitlements';

const input='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm';
const defaultPayments=[['cash','Cash',false],['mpesa','M-Pesa',true],['card','Card',true],['bank','Bank Transfer',true],['room','Room Charge',true]];
const defaultDining=[['dine_in','Dine-in'],['takeaway','Takeaway'],['delivery','Delivery']];

export default function OperationalSettingsPage({module='features'}){
 const {user}=useAuth(); const propertyId=user?.property?.id; const pkg=user?.property?.package||'none';
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[draft,setDraft]=useState({}),[busy,setBusy]=useState(false);
 const load=async()=>{if(!propertyId)return;setLoading(true);try{
  if(module==='payment-types')setRows(await backOfficeService.listPaymentTypes(propertyId));
  else if(module==='taxes')setRows(await backOfficeService.listTaxes(propertyId));
  else if(module==='dining-options')setRows(await backOfficeService.listDiningOptions(propertyId));
  else if(module==='open-tickets')setRows(await backOfficeService.listOpenTickets(propertyId));
  else if(module==='loyalty')setRows(await backOfficeService.listLoyalty(propertyId));
 }catch(e){toast.error(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load()},[propertyId,module]);
 const title={features:'Features & entitlements','payment-types':'Payment Types',taxes:'Taxes',loyalty:'Guest Loyalty','open-tickets':'Open Tickets','dining-options':'Dining Options'}[module]||'Back Office';
 const add=async()=>{try{setBusy(true);
  if(module==='payment-types'){await backOfficeService.savePaymentType(propertyId,{code:draft.code?.trim().toLowerCase().replace(/\s+/g,'_'),name:draft.name,active:true,sort_order:rows.length,requires_reference:!!draft.requires_reference});}
  if(module==='taxes'){await backOfficeService.saveTax(propertyId,{name:draft.name,rate:Number(draft.rate)||0,inclusive:!!draft.inclusive,active:true});}
  if(module==='dining-options'){await backOfficeService.saveDiningOption(propertyId,{code:draft.code?.trim().toLowerCase().replace(/\s+/g,'_'),name:draft.name,active:true});}
  if(module==='loyalty'){await backOfficeService.adjustLoyalty(propertyId,draft.guest_id,Number(draft.points),draft.type||'manual_adjustment',draft.reference);}
  setDraft({});await load();toast.success('Saved.');}catch(e){toast.error(e.message)}finally{setBusy(false)}};
 const seed=async()=>{try{setBusy(true);if(module==='payment-types'){for(const [code,name,ref] of defaultPayments)await backOfficeService.savePaymentType(propertyId,{code,name,active:true,sort_order:defaultPayments.findIndex(x=>x[0]===code),requires_reference:ref});}if(module==='dining-options'){for(const [code,name] of defaultDining)await backOfficeService.saveDiningOption(propertyId,{code,name,active:true});}await load();toast.success('Defaults loaded.')}catch(e){toast.error(e.message)}finally{setBusy(false)}};
 const remove=async(row,type)=>{try{await (type==='payment-types'?backOfficeService.deletePaymentType(row.id,propertyId):type==='taxes'?backOfficeService.deleteTax(row.id,propertyId):backOfficeService.deleteDiningOption(row.id,propertyId));await load();toast.success('Removed.')}catch(e){toast.error(e.message)}};
 return <div className="min-h-full bg-slate-50 p-4 md:p-6"><div className="mx-auto max-w-6xl">
  <div className="mb-5 flex items-center justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Back Office</div><h1 className="mt-1 text-2xl font-black text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-500">Property-scoped operational configuration backed by Supabase.</p></div><button onClick={load} className="rounded-xl border bg-white p-2.5"><RefreshCw size={17}/></button></div>
  {loading&&module!=='features'?<div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">Loading operational data…</div>:null}
  {!loading&&module==='features'&&<Features pkg={pkg}/>}
  {!loading&&module==='payment-types'&&<ConfigList rows={rows} fields={[[`code`,`Code`],[`name`,`Name`]]} draft={draft} setDraft={setDraft} onAdd={add} onSeed={seed} onDelete={r=>remove(r,module)} busy={busy}/>}
  {!loading&&module==='taxes'&&<ConfigList rows={rows} fields={[[`name`,`Tax name`],[`rate`,`Rate %`],[`inclusive`,`Inclusive`]]} draft={draft} setDraft={setDraft} onAdd={add} onDelete={r=>remove(r,module)} busy={busy}/>}
  {!loading&&module==='dining-options'&&<ConfigList rows={rows} fields={[[`code`,`Code`],[`name`,`Name`]]} draft={draft} setDraft={setDraft} onAdd={add} onSeed={seed} onDelete={r=>remove(r,module)} busy={busy}/>}
  {!loading&&module==='open-tickets'&&<OpenTickets rows={rows}/>}
  {!loading&&module==='loyalty'&&<Loyalty rows={rows} draft={draft} setDraft={setDraft} onAdd={add} busy={busy}/>}





 </div></div>;
}

function Features({pkg}){const matrix=featureMatrix();const keys=Object.keys(matrix.professional||{});return <div className="rounded-2xl border bg-white overflow-hidden"><div className="grid grid-cols-4 border-b bg-slate-950 text-white text-xs font-black"><div className="p-3">Feature</div>{['standard','premium','professional'].map(p=><div key={p} className="p-3 text-center">{PACKAGE_LABELS[p]}</div>)}</div>{keys.map(k=><div key={k} className="grid grid-cols-4 border-b last:border-0 text-sm"><div className="p-3 font-semibold">{k.replaceAll('_',' ')}</div>{['standard','premium','professional'].map(p=><div key={p} className={`p-3 text-center font-bold ${matrix[p]?.[k]?'text-emerald-600':'text-slate-300'}`}>{matrix[p]?.[k]?'✓':'—'}</div>)}</div>)}<div className="p-4 bg-slate-50 text-xs text-slate-600 flex items-center gap-2"><ShieldCheck size={15}/> Current property package: <b>{PACKAGE_LABELS[pkg]||pkg}</b>. Server-side entitlements remain authoritative.</div></div>}

function ConfigList({rows,fields,draft,setDraft,onAdd,onSeed,onDelete,busy}){return <div className="space-y-4"><div className="rounded-2xl border bg-white p-4"><div className="grid gap-3 md:grid-cols-4">{fields.map(([key,label])=><label key={key} className="text-xs font-bold">{label}{key==='inclusive'?<select value={draft[key]?'true':'false'} onChange={e=>setDraft({...draft,[key]:e.target.value==='true'})} className={input}><option value="false">Exclusive</option><option value="true">Inclusive</option></select>:<input type={key==='rate'?'number':'text'} value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:e.target.value})} className={input}/>}</label>)}<div className="flex items-end gap-2"><button disabled={busy} onClick={onAdd} className="inline-flex items-center gap-2 rounded-xl bg-[#0E7482] px-4 py-2.5 text-sm font-black text-white"><Plus size={16}/> Add</button>{onSeed&&<button disabled={busy} onClick={onSeed} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Load defaults</button>}</div></div></div><div className="overflow-hidden rounded-2xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-950 text-white"><tr>{fields.map(([,l])=><th key={l} className="px-4 py-3 text-left text-xs uppercase">{l}</th>)}<th/></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b">{fields.map(([key])=><td key={key} className="px-4 py-3">{key==='code'?(r.code||'—'):key==='rate'?Number(r.rate||0)+'%':key==='inclusive'?(r.inclusive?'Inclusive':'Exclusive'):(r.name||'—')}</td>)}<td className="px-4 py-3 text-right"><button onClick={()=>onDelete(r)} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 size={15}/></button></td></tr>)}</tbody></table>{!rows.length&&<div className="p-10 text-center text-sm text-slate-500">No configuration records yet.</div>}</div></div>}

function OpenTickets({rows}){return <div className="overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4 text-sm text-slate-600">These are persistent POS table sessions that remain open/unsettled.</div><table className="w-full text-sm"><thead className="bg-slate-950 text-white"><tr>{['Table','Order','Guests','Waiter','Status','Updated'].map(h=><th key={h} className="p-3 text-left text-xs uppercase">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-black">{r.table_number||'—'}</td><td>{r.order_number||'—'}</td><td>{r.guests||0}</td><td>{r.waiter||'—'}</td><td><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black">{r.status}</span></td><td>{r.updated_at?new Date(r.updated_at).toLocaleString('en-KE'):'—'}</td></tr>)}</tbody></table>{!rows.length&&<div className="p-10 text-center text-sm text-slate-500">No open tickets.</div>}</div>}

function Loyalty({rows,draft,setDraft,onAdd,busy}){return <div className="space-y-4"><div className="rounded-2xl border bg-white p-4"><div className="grid gap-3 md:grid-cols-4"><label className="text-xs font-bold">Guest ID<input value={draft.guest_id||''} onChange={e=>setDraft({...draft,guest_id:e.target.value})} className={input} placeholder="UUID from guest record"/></label><label className="text-xs font-bold">Points<input type="number" value={draft.points||''} onChange={e=>setDraft({...draft,points:e.target.value})} className={input}/></label><label className="text-xs font-bold">Type<input value={draft.type||''} onChange={e=>setDraft({...draft,type:e.target.value})} className={input} placeholder="earn / redeem / adjustment"/></label><label className="text-xs font-bold">Reference<input value={draft.reference||''} onChange={e=>setDraft({...draft,reference:e.target.value})} className={input}/></label></div><button disabled={busy} onClick={onAdd} className="mt-3 rounded-xl bg-[#0E7482] px-4 py-2.5 text-sm font-black text-white"><Star size={15} className="inline mr-1"/> Post points</button></div><div className="overflow-hidden rounded-2xl border bg-white"><table className="w-full text-sm"><thead className="bg-slate-950 text-white"><tr><th className="p-3 text-left">Guest</th><th className="p-3 text-left">Balance</th><th className="p-3 text-left">Tier</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-b"><td className="p-3 font-bold">{r.guest?.name||r.guest_id}</td><td className="p-3 font-mono">{r.points_balance}</td><td className="p-3 capitalize">{r.tier}</td></tr>)}</tbody></table></div></div>}
