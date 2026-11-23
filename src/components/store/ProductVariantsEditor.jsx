import React,{useEffect,useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {supabase} from '@/lib/supabaseClient';

const empty={name:'',sku:'',barcode:'',price_delta:'0',cost_price:'0',current_stock:'0',track_stock:true,attributes:'',active:true};
export default function ProductVariantsEditor({propertyId,productId}){
  const [rows,setRows]=useState([]),[draft,setDraft]=useState(empty),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const load=async()=>{const {data,error}=await supabase.from('product_variants').select('*').eq('property_id',propertyId).eq('product_id',productId).order('sort_order').order('created_at');if(error)throw error;setRows(data||[]);};
  useEffect(()=>{let live=true;(async()=>{try{await load();}catch(e){if(live)toast.error(e.message);}finally{if(live)setLoading(false);}})();return()=>{live=false;};},[propertyId,productId]);
  const save=async()=>{if(!draft.name.trim()){toast.error('Enter a variant name.');return;}setSaving(true);try{const attrs=draft.attributes.trim()?JSON.parse(draft.attributes):{};if(!attrs||Array.isArray(attrs)||typeof attrs!=='object')throw new Error('Variant attributes must be a JSON object.');const payload={property_id:propertyId,product_id:productId,name:draft.name.trim(),sku:draft.sku.trim()||null,barcode:draft.barcode.trim()||null,price_delta:Number(draft.price_delta)||0,cost_price:Number(draft.cost_price)||0,current_stock:Number(draft.current_stock)||0,track_stock:Boolean(draft.track_stock),attributes:attrs,active:Boolean(draft.active),sort_order:rows.length};const {error}=await supabase.from('product_variants').insert(payload);if(error)throw error;setDraft(empty);await load();toast.success('Variant added.');}catch(e){toast.error(e.message);}finally{setSaving(false);}};
  const remove=async id=>{if(!window.confirm('Delete this variant?'))return;const {error}=await supabase.from('product_variants').delete().eq('id',id).eq('property_id',propertyId);if(error)toast.error(error.message);else{await load();toast.success('Variant deleted.');}};
  if(loading)return <p className="text-xs text-muted-foreground">Loading variants…</p>;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Create size, colour or pack variants with their own SKU, barcode, price adjustment and stock. POS line-item selection is not yet connected to these variant records.</p>
    {rows.map(row=><div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-border p-3 text-xs"><div><strong>{row.name}</strong><div className="text-muted-foreground">{row.sku||'No SKU'} · {row.track_stock?'Stock '+row.current_stock:'Untracked'} · Price delta KES {Number(row.price_delta||0).toLocaleString()}</div></div><span>{row.active?'Active':'Inactive'}</span><button type="button" onClick={()=>remove(row.id)} className="rounded border border-border p-2 text-destructive" aria-label="Delete variant"><Trash2 size={14}/></button></div>)}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3">
      <label className="text-xs font-semibold">Variant name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="e.g. 500 ml / Large / Blue" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="text-xs font-semibold">SKU<input value={draft.sku} onChange={e=>setDraft({...draft,sku:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="text-xs font-semibold">Barcode<input value={draft.barcode} onChange={e=>setDraft({...draft,barcode:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="text-xs font-semibold">Price adjustment (KES)<input type="number" step="0.01" value={draft.price_delta} onChange={e=>setDraft({...draft,price_delta:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="text-xs font-semibold">Unit cost (KES)<input type="number" min="0" step="0.01" value={draft.cost_price} onChange={e=>setDraft({...draft,cost_price:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="text-xs font-semibold">Opening stock<input type="number" min="0" step="any" value={draft.current_stock} onChange={e=>setDraft({...draft,current_stock:e.target.value})} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="sm:col-span-2 text-xs font-semibold">Attributes (optional JSON)<input value={draft.attributes} onChange={e=>setDraft({...draft,attributes:e.target.value})} placeholder='{"size":"Large","colour":"Blue"}' className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"/></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.track_stock} onChange={e=>setDraft({...draft,track_stock:e.target.checked})}/> Track variant stock</label>
      <button type="button" onClick={save} disabled={saving||!draft.name.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"><Plus size={14}/>{saving?'Saving…':'Add variant'}</button>
    </div>
  </div>;
}
