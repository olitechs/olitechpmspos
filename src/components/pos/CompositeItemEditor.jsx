import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Layers3, Info } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryService } from '@/services/inventoryService';

export default function CompositeItemEditor({ propertyId, productId, onSaved }) {
  const [products,setProducts]=useState([]);
  const [components,setComponents]=useState([]);
  const [enabled,setEnabled]=useState(false);
  const [notes,setNotes]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    let active=true;
    async function load(){
      if(!propertyId||!productId)return;
      setLoading(true);
      try{
        const [catalogue,recipe]=await Promise.all([
          inventoryService.listProducts(propertyId),
          inventoryService.getCompositeRecipe(propertyId,productId)
        ]);
        if(!active)return;
        setProducts((catalogue||[]).filter(p=>p.id!==productId&&p.track_stock!==false&&p.inventory_tracking_mode!=='untracked'&&p.inventory_tracking_mode!=='composite'));
        const current=(catalogue||[]).find(p=>p.id===productId);
        setEnabled(current?.inventory_tracking_mode==='composite'||Boolean(recipe));
        setNotes(recipe?.notes||'');
        setComponents((recipe?.recipe_ingredients||[]).map(line=>({product_id:line.product_id,qty:String(line.qty)})));
        setLoaded(true);
      }catch(error){if(active)toast.error(error.message||'Could not load composite recipe.');}
      finally{if(active)setLoading(false);}
    }
    load();
    return()=>{active=false;};
  },[propertyId,productId]);

  const selectedIds=useMemo(()=>new Set(components.map(x=>x.product_id)),[components]);
  const componentCost=useMemo(()=>components.reduce((sum,line)=>{
    const p=products.find(x=>x.id===line.product_id);
    return sum+(Number(p?.cost_price)||0)*(Number(line.qty)||0);
  },0),[components,products]);
  const updateLine=(index,patch)=>setComponents(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const addLine=()=>{const next=products.find(p=>!selectedIds.has(p.id));if(next)setComponents(current=>[...current,{product_id:next.id,qty:'1'}]);};
  const save=async()=>{
    if(enabled&&(!components.length||components.some(x=>!x.product_id||!(Number(x.qty)>0)))){toast.error('Add valid component products and quantities greater than zero.');return;}
    setSaving(true);
    try{
      await inventoryService.saveCompositeRecipe({propertyId,productId,isComposite:enabled,components:components.map(x=>({product_id:x.product_id,qty:Number(x.qty)})),notes});
      toast.success(enabled?'Composite recipe saved.':'Composite item disabled.');
      onSaved?.();
    }catch(error){toast.error(error.message||'Could not save composite recipe.');}
    finally{setSaving(false);}
  };

  if(!productId)return <div className="mt-5 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">Save this product first. Reopen it to configure inventory components.</div>;
  return <section className="mt-5 rounded-2xl border border-[var(--border)] p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2"><Layers3 size={18} className="mt-0.5 text-[var(--primary)]"/><div><h4 className="text-sm font-semibold">Inventory · Composite item</h4><p className="mt-1 text-xs text-[var(--text-muted)]">Consumes specified quantities of other inventory products when sold.</p></div></div>
      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={loading||saving}/> Enable</label>
    </div>
    {enabled&&<div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold">Components per one product</div><button type="button" onClick={addLine} disabled={loading||saving||products.every(p=>selectedIds.has(p.id))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-50"><Plus size={14}/> Add component</button></div>
      {components.map((line,index)=>{const p=products.find(x=>x.id===line.product_id);return <div key={line.product_id} className="grid grid-cols-[minmax(0,1fr)_110px_36px] items-end gap-2">
        <label className="min-w-0 text-[11px] font-medium">Inventory product<select value={line.product_id} onChange={e=>updateLine(index,{product_id:e.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm">{products.filter(x=>x.id===line.product_id||!selectedIds.has(x.id)).map(x=><option key={x.id} value={x.id}>{x.name} · {x.base_unit||x.unit||'pcs'}</option>)}</select></label>
        <label className="text-[11px] font-medium">Quantity ({p?.base_unit||p?.unit||'pcs'})<input type="number" min="0.000001" step="any" value={line.qty} onChange={e=>updateLine(index,{qty:e.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"/></label>
        <button type="button" onClick={()=>setComponents(current=>current.filter((_,i)=>i!==index))} aria-label="Remove component" className="mb-0.5 flex h-10 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--danger)]"><Trash2 size={15}/></button>
      </div>;})}
      {!components.length&&<div className="rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">No components added yet.</div>}
      <label className="block text-xs font-medium">Recipe notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" placeholder="Optional inventory notes"/></label>
      <div className="flex items-center justify-between rounded-lg bg-[var(--canvas)] p-3"><span className="text-xs text-[var(--text-muted)]">Estimated component cost per unit</span><strong className="text-sm tabular-nums">{componentCost.toLocaleString(undefined,{style:'currency',currency:'KES'})}</strong></div>
      <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]"><Info size={14} className="mt-0.5 shrink-0"/> Quantities use each component's base unit. Cost is an estimate from current product costs. Unit conversions and authoritative cost snapshots are a later phase.</div>
    </div>}
    <div className="mt-4 flex justify-end"><button type="button" onClick={save} disabled={loading||saving||!loaded} className="min-h-11 rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving?'Saving…':'Save composite settings'}</button></div>
  </section>;
}
