import React, { useEffect, useMemo, useState } from 'react';
import { Save, Building2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { DEFAULT_RECEIPT_SETTINGS, getPropertySettings, getUnsettledReceiptSettings, savePropertySettings, saveUnsettledReceiptSettings, uploadPropertyLogo } from '@/services/settingsService';
import ReceiptPreview from '@/components/settings/ReceiptPreview';

const REQUIRED = ['logo_url','property_name','address_line1','address_line2','phone','email','website','kra_pin','footer_line1','footer_line2'];

export default function ReceiptSettings() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const role = String(user?.propertyRole || user?.staff?.role || '').toLowerCase();
  const canManageVat = !!user?.isPlatformOwner || ['owner','admin','hotel_admin','super_admin'].includes(role);
  const [previewWidth, setPreviewWidth] = useState('80mm');
  const [previewVatMode, setPreviewVatMode] = useState('off');
  const [form,setForm]=useState({...DEFAULT_RECEIPT_SETTINGS});
  const [busy,setBusy]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState(''); const [ok,setOk]=useState('');
  useEffect(()=>{ if(!propertyId)return; setBusy(true); Promise.all([getPropertySettings(propertyId),getUnsettledReceiptSettings(propertyId)]).then(([row,vat])=>setForm({...DEFAULT_RECEIPT_SETTINGS,...row,...vat})).catch(e=>setError(e.message)).finally(()=>setBusy(false)); },[propertyId]);
  const valid=useMemo(()=>REQUIRED.every(k=>String(form[k]||'').trim()),[form]);
  const update=(k,v)=>setForm(f=>({...f,[k]:v}));
  const onLogo=async(e)=>{
    const input=e.target;
    const file=input.files?.[0];
    if(!file)return;
    setError('');
    setOk('');
    try {
      const url=await uploadPropertyLogo(propertyId,file);
      update('logo_url',url);
      setOk('New logo uploaded and shown in the preview. Save Receipt Settings to apply it to printed receipts.');
    } catch(err) {
      setError(err.message||'Logo upload failed.');
    } finally {
      input.value='';
    }
  };
  const save=async()=>{if(!valid){setError('Complete all required company and footer fields.');return}setSaving(true);setError('');setOk('');try{await savePropertySettings(propertyId,form);if(canManageVat)await saveUnsettledReceiptSettings(propertyId,form);setOk('Receipt settings saved.')}catch(e){setError(e.message||'Could not save receipt settings.')}finally{setSaving(false)}};
  if(busy)return <div className="p-8 text-sm text-muted-foreground">Loading receipt settings…</div>;
  return <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-warning-soft p-3"><Building2 size={20}/></div><div><h2 className="font-black text-foreground">Receipt Header & Footer</h2><p className="text-xs text-muted-foreground">Company identity, logo and centered footer are used on POS bills, final receipts and kitchen/bar tickets.</p></div></div>
      {error&&<div className="mb-4 rounded-xl bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</div>}{ok&&<div className="mb-4 rounded-xl bg-[var(--success-soft)] p-3 text-sm font-semibold text-[var(--success-text)]">{ok}</div>}
      <div className="grid gap-4 md:grid-cols-2">{[['property_name','Property name'],['address_line1','Address line 1'],['address_line2','Address line 2'],['phone','Phone'],['email','Email'],['website','Website'],['kra_pin','KRA PIN'],['extra_header_line','Extra header line']].map(([k,l])=><label key={k} className="text-sm font-bold text-foreground">{l}{k!=='extra_header_line'&&' *'}<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 font-normal outline-none focus:border-[var(--primary)]"/></label>)}</div>
      <div className="mt-4"><label className="text-sm font-bold text-foreground">Logo <span className="text-[var(--danger-text)]">*</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} className="mt-2 block w-full rounded-xl border border-dashed border-border p-3 text-xs"/></label>{form.logo_url&&<img src={form.logo_url} alt="Company logo" className="mt-3 max-h-20 max-w-48 object-contain"/>}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{[['footer_line1','Footer line 1'],['footer_line2','Footer line 2']].map(([k,l])=><label key={k} className="text-sm font-bold text-foreground">{l} *<input value={form[k]||''} onChange={e=>update(k,e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2.5 font-normal outline-none focus:border-[var(--primary)]"/></label>)}</div>
      <div className="mt-6 rounded-2xl border border-border bg-secondary/60 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-black text-foreground">Unsettled bill VAT and print safety</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">These controls affect unsettled bills only. VAT is disabled by default; settled receipts and kitchen/bar tickets are unchanged.</p>
        </div>
        {canManageVat ? <>
          <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
            <input type="checkbox" checked={form.unsettled_receipt_show_vat === true} onChange={e=>update('unsettled_receipt_show_vat',e.target.checked)} className="mt-0.5 h-4 w-4"/>
            <span><span className="block text-sm font-bold text-foreground">Show VAT on unsettled bills</span><span className="mt-1 block text-xs text-muted-foreground">Off by default. When enabled, the VAT amount is always printed explicitly.</span></span>
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-foreground">VAT rate (%)
              <input type="number" min="0" max="100" step="0.01" disabled={!form.unsettled_receipt_show_vat} value={form.unsettled_receipt_vat_rate ?? 16} onChange={e=>update('unsettled_receipt_vat_rate',Number(e.target.value))} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm disabled:opacity-50"/>
            </label>
            <label className="text-xs font-bold text-foreground">Prices are
              <select disabled={!form.unsettled_receipt_show_vat} value={form.unsettled_receipt_vat_mode || 'exclusive'} onChange={e=>update('unsettled_receipt_vat_mode',e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm disabled:opacity-50">
                <option value="exclusive">VAT-exclusive (add VAT on top)</option>
                <option value="inclusive">VAT-inclusive (VAT is already in prices)</option>
              </select>
            </label>
            <label className="text-xs font-bold text-foreground">Unsettled receipt paper width
              <select value={form.unsettled_receipt_paper_width || '80mm'} onChange={e=>update('unsettled_receipt_paper_width',e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"><option value="80mm">80mm - 48 columns (46 safe)</option><option value="58mm">58mm - 32 columns (30 safe)</option></select>
            </label>
            <label className="text-xs font-bold text-foreground">Feed lines before cutter
              <select value={form.unsettled_receipt_feed_lines ?? 5} onChange={e=>update('unsettled_receipt_feed_lines',Number(e.target.value))} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">{[4,5,6].map(n=><option key={n} value={n}>{n} lines</option>)}</select>
            </label>
          </div>
        </> : <p className="rounded-xl border border-border bg-surface p-3 text-xs leading-5 text-muted-foreground">VAT and unsettled receipt print settings are managed by the property owner or administrator. You can still print and preview bills.</p>}
      </div>
      <div className="mt-6 rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={form.print_void_slips !== false} onChange={e=>update('print_void_slips',e.target.checked)} className="mt-1 h-4 w-4 accent-red-600"/>
          <span className="flex-1"><span className="flex items-center gap-2 text-sm font-black text-foreground"><ShieldAlert size={16} className="text-[var(--danger-text)]"/>Print void slips to kitchen/bar on deletion</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">When an item has already been sent to production or an unsettled bill exists, deleting it creates a control slip for the assigned Kitchen or Bar printer.</span></span>
        </label>
      </div>
      <button disabled={!valid||saving} onClick={save} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-primary-foreground disabled:opacity-50"><Save size={16}/>{saving?'Saving…':'Save Receipt Settings'}</button>
    </section>
    <aside className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Paper width<select aria-label="Preview paper width" value={previewWidth} onChange={e=>setPreviewWidth(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-bold text-foreground"><option value="80mm">80mm</option><option value="58mm">58mm</option></select></label>
        <label className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">VAT preview<select aria-label="Preview VAT mode" value={previewVatMode} onChange={e=>setPreviewVatMode(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-bold text-foreground"><option value="off">VAT off</option><option value="exclusive">VAT exclusive</option><option value="inclusive">VAT inclusive</option></select></label>
      </div>
      <ReceiptPreview settings={{...form,unsettled_receipt_show_vat:previewVatMode!=='off',unsettled_receipt_vat_mode:previewVatMode==='inclusive'?'inclusive':'exclusive'}} printer={{paper_width:previewWidth}} data={{table:'T4',covers:5,waiter:'Grace Wanjiru',diningOption:'Dine In',checkNo:'ORD-002-USOR1U2',currency:'KES',items:[{name:'Grilled Ocean Fish with Coconut Sauce and Swahili Spices',qty:1,price:1250,modifiers:[{name:'Extra lemon butter'}]},{name:'Soda',qty:2,price:300}]}} type="UNSETTLED"/>
      <div className="text-[11px] leading-5 text-muted-foreground">Preview uses the selected paper width and current VAT settings. Receipt time is formatted in Africa/Nairobi.</div>
    </aside>
  </div>;
}
