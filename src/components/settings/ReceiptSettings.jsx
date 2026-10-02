import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Save, Building2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { DEFAULT_RECEIPT_SETTINGS, getPropertySettings, savePropertySettings, uploadPropertyLogo } from '@/services/settingsService';
import ReceiptPreview from '@/components/settings/ReceiptPreview';

const REQUIRED = ['logo_url','property_name','address_line1','address_line2','phone','email','website','kra_pin','footer_line1','footer_line2'];

export default function ReceiptSettings() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [form,setForm]=useState({...DEFAULT_RECEIPT_SETTINGS});
  const [busy,setBusy]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState(''); const [ok,setOk]=useState('');
  useEffect(()=>{ if(!propertyId)return; setBusy(true); getPropertySettings(propertyId).then(row=>setForm({...DEFAULT_RECEIPT_SETTINGS,...row})).catch(e=>setError(e.message)).finally(()=>setBusy(false)); },[propertyId]);
  const valid=useMemo(()=>REQUIRED.every(k=>String(form[k]||'').trim()),[form]);
  const update=(k,v)=>setForm(f=>({...f,[k]:v}));
  const onLogo=async(e)=>{const file=e.target.files?.[0];if(!file)return;setError('');try{const url=await uploadPropertyLogo(propertyId,file);update('logo_url',url);}catch(err){setError(err.message||'Logo upload failed.');}};
  const save=async()=>{if(!valid){setError('Complete all required company and footer fields.');return}setSaving(true);setError('');setOk('');try{await savePropertySettings(propertyId,form);setOk('Receipt settings saved.')}catch(e){setError(e.message||'Could not save receipt settings.')}finally{setSaving(false)}};
  if(busy)return <div className="p-8 text-sm text-slate-500">Loading receipt settings…</div>;
  return <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-amber-100 p-3"><Building2 size={20}/></div><div><h2 className="font-black text-slate-900">Receipt Header & Footer</h2><p className="text-xs text-slate-500">Company details are used on bills and final receipts.</p></div></div>
      {error&&<div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}{ok&&<div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{ok}</div>}
      <div className="grid gap-4 md:grid-cols-2">{[['property_name','Property name'],['address_line1','Address line 1'],['address_line2','Address line 2'],['phone','Phone'],['email','Email'],['website','Website'],['kra_pin','KRA PIN'],['extra_header_line','Extra header line']].map(([k,l])=><label key={k} className="text-sm font-bold text-slate-700">{l}{k!=='extra_header_line'&&' *'}<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-normal outline-none focus:border-amber-400"/></label>)}</div>
      <div className="mt-4"><label className="text-sm font-bold text-slate-700">Logo <span className="text-red-500">*</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} className="mt-2 block w-full rounded-xl border border-dashed border-slate-300 p-3 text-xs"/></label>{form.logo_url&&<img src={form.logo_url} alt="Company logo" className="mt-3 max-h-20 max-w-48 object-contain"/>}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{[['footer_line1','Footer line 1'],['footer_line2','Footer line 2']].map(([k,l])=><label key={k} className="text-sm font-bold text-slate-700">{l} *<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-normal outline-none focus:border-amber-400"/></label>)}</div>
      <button disabled={!valid||saving} onClick={save} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-amber-300 disabled:opacity-50"><Save size={16}/>{saving?'Saving…':'Save Receipt Settings'}</button>
    </section>
    <aside><div className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Live preview</div><ReceiptPreview settings={form} data={{table:'T4',covers:2,waiter:'John Mwangi',orderNumber:'ORD-004',total:3450,currency:'KES',items:[{name:'Beef Burger',qty:1,price:1800,category:'food'},{name:'Tusker Lager',qty:2,price:450,category:'drinks'}]}} type="RECEIPT"/></aside>
  </div>;
}
