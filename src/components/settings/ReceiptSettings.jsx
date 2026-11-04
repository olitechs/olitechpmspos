import React, { useEffect, useMemo, useState } from 'react';
import { Save, Building2, ShieldAlert } from 'lucide-react';
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
  if(busy)return <div className="p-8 text-sm text-muted-foreground">Loading receipt settings…</div>;
  return <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-warning-soft p-3"><Building2 size={20}/></div><div><h2 className="font-black text-foreground">Receipt Header & Footer</h2><p className="text-xs text-muted-foreground">Company identity, logo and centered footer are used on POS bills, final receipts and kitchen/bar tickets.</p></div></div>
      {error&&<div className="mb-4 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</div>}{ok&&<div className="mb-4 rounded-xl bg-[var(--success-soft)] p-3 text-sm font-semibold text-[var(--success-text)]">{ok}</div>}
      <div className="grid gap-4 md:grid-cols-2">{[['property_name','Property name'],['address_line1','Address line 1'],['address_line2','Address line 2'],['phone','Phone'],['email','Email'],['website','Website'],['kra_pin','KRA PIN'],['extra_header_line','Extra header line']].map(([k,l])=><label key={k} className="text-sm font-bold text-foreground">{l}{k!=='extra_header_line'&&' *'}<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 font-normal outline-none focus:border-[var(--primary)]"/></label>)}</div>
      <div className="mt-4"><label className="text-sm font-bold text-foreground">Logo <span className="text-[var(--danger-text)]">*</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} className="mt-2 block w-full rounded-xl border border-dashed border-border p-3 text-xs"/></label>{form.logo_url&&<img src={form.logo_url} alt="Company logo" className="mt-3 max-h-20 max-w-48 object-contain"/>}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{[['footer_line1','Footer line 1'],['footer_line2','Footer line 2']].map(([k,l])=><label key={k} className="text-sm font-bold text-foreground">{l} *<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 font-normal outline-none focus:border-[var(--primary)]"/></label>)}</div>
      <div className="mt-6 rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={form.print_void_slips !== false} onChange={e=>update('print_void_slips',e.target.checked)} className="mt-1 h-4 w-4 accent-red-600"/>
          <span className="flex-1"><span className="flex items-center gap-2 text-sm font-black text-foreground"><ShieldAlert size={16} className="text-[var(--danger-text)]"/>Print void slips to kitchen/bar on deletion</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">When an item has already been sent to production or an unsettled bill exists, deleting it creates a control slip for the assigned Kitchen or Bar printer.</span></span>
        </label>
      </div>
      <button disabled={!valid||saving} onClick={save} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-primary-foreground disabled:opacity-50"><Save size={16}/>{saving?'Saving…':'Save Receipt Settings'}</button>
    </section>
    <aside><div className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">Live preview</div><ReceiptPreview settings={form} data={{table:'T4',covers:2,waiter:'John Mwangi',orderNumber:'ORD-004',total:3450,currency:'KES',items:[{name:'Beef Burger',qty:1,price:1800,category:'food'},{name:'Tusker Lager',qty:2,price:450,category:'drinks'}]}} type="RECEIPT"/></aside>
  </div>;
}
