import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Layers3, Info, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryService } from '@/services/inventoryService';

function getUnitFactor(fromUnit,toUnit,conversions,propertyId) {
  if (!fromUnit || !toUnit) return null;
  if (fromUnit===toUnit) return 1;
  const scoped = conversions.filter(x => x.property_id===propertyId);
  const global = conversions.filter(x => x.property_id==null);
  for (const rows of [scoped,global]) {
    const direct=rows.find(x=>x.from_unit===fromUnit&&x.to_unit===toUnit);
    if (direct) return Number(direct.factor);
    const reverse=rows.find(x=>x.from_unit===toUnit&&x.to_unit===fromUnit);
    if (reverse) return 1/Number(reverse.factor);
  }
  return null;
}

export default function CompositeItemEditor({ propertyId, productId, onSaved }) {
  const [products,setProducts]=useState([]);
  const [units,setUnits]=useState([]);
  const [conversions,setConversions]=useState([]);
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
      setLoaded(false);
      try{
        const [catalogue,recipe,unitRows,conversionRows]=await Promise.all([
          inventoryService.listProducts(propertyId),
          inventoryService.getCompositeRecipe(propertyId,productId),
          inventoryService.listInventoryUnits(),
          inventoryService.listInventoryUnitConversions(propertyId)
        ]);
        if(!active)return;
        const available=(catalogue||[]).filter(p=>p.id!==productId&&p.track_stock!==false&&p.inventory_tracking_mode!=='untracked'&&p.inventory_tracking_mode!=='composite');
        setProducts(available);
        setUnits(unitRows||[]);
        setConversions(conversionRows||[]);
        const current=(catalogue||[]).find(p=>p.id===productId);
        setEnabled(current?.inventory_tracking_mode==='composite'||Boolean(recipe));
        setNotes(recipe?.notes||'');
        setComponents((recipe?.recipe_ingredients||[]).map(line=>({
          product_id:line.product_id,
          qty:String(line.entered_qty??line.qty),
          unit:line.entered_unit||line.product?.base_unit||'pcs'
        })));
        setLoaded(true);
      }catch(error){if(active)toast.error(error.message||'Could not load composite recipe.');}
      finally{if(active)setLoading(false);}
    }
    load();
    return()=>{active=false;};
  },[propertyId,productId]);

  const selectedIds=useMemo(()=>new Set(components.map(x=>x.product_id)),[components]);
  const enriched=useMemo(()=>components.map(line=>{
    const product=products.find(p=>p.id===line.product_id);
    const factor=product?getUnitFactor(line.unit,product.base_unit||product.unit,conversions,propertyId):null;
    const baseQty=factor==null?null:Number(line.qty)*factor;
    return {...line,product,factor,baseQty,lineCost:baseQty==null?null:baseQty*(Number(product?.cost_price)||0)};
  }),[components,products,conversions,propertyId]);
  const componentCost=enriched.reduce((sum,line)=>sum+(line.lineCost??0),0);
  const hasInvalidConversion=enriched.some(line=>!line.product||line.factor==null||!(Number(line.qty)>0));

  const updateLine=(index,patch)=>setComponents(current=>current.map((line,i)=>i===index?{...line,...patch}:line));
  const addLine=()=>{
    const next=products.find(p=>!selectedIds.has(p.id));
    if(next)setComponents(current=>[...current,{product_id:next.id,qty:'1',unit:next.base_unit||next.unit||'pcs'}]);
  };
  const save=async()=>{
    if(enabled&&(!components.length||components.some(x=>!x.product_id||!(Number(x.qty)>0)||!x.unit))){toast.error('Add valid component products, units and quantities greater than zero.');return;}
    if(enabled&&hasInvalidConversion){toast.error('One or more component units cannot be converted to the inventory base unit.');return;}
    setSaving(true);
    try{
      const result=await inventoryService.saveCompositeRecipe({
        propertyId,productId,isComposite:enabled,
        components:components.map(line=>({product_id:line.product_id,qty:Number(line.qty),unit:line.unit})),
        notes
      });
      toast.success(enabled?`Composite recipe saved · Component cost ${Number(result?.component_cost??componentCost).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'Composite item disabled.');
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
      {enriched.map((line,index)=>{
        const baseUnit=line.product?.base_unit||line.product?.unit||'pcs';
        const baseDimension=units.find(u=>u.code===baseUnit)?.dimension;
        const compatibleUnits=units.filter(u=>u.dimension===baseDimension);
        return <div key={line.product_id} className="grid grid-cols-[minmax(0,1fr)_90px_100px_36px] items-end gap-2">
          <label className="min-w-0 text-[11px] font-medium">Inventory product
            <select value={line.product_id} onChange={e=>{const p=products.find(x=>x.id===e.target.value);updateLine(index,{product_id:e.target.value,unit:p?.base_unit||p?.unit||'pcs'});}} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm">
              {products.filter(x=>x.id===line.product_id||!selectedIds.has(x.id)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <span className="mt-1 block text-[10px] text-[var(--text-muted)]">Stock unit: {baseUnit}</span>
          </label>
          <label className="text-[11px] font-medium">Quantity
            <input type="number" min="0.000001" step="any" value={line.qty} onChange={e=>updateLine(index,{qty:e.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"/>
          </label>
          <label className="text-[11px] font-medium">Recipe unit
            <select value={line.unit} onChange={e=>updateLine(index,{unit:e.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm">
              {compatibleUnits.map(u=><option key={u.code} value={u.code}>{u.code}</option>)}
            </select>
          </label>
          <button type="button" onClick={()=>setComponents(current=>current.filter((_,i)=>i!==index))} aria-label="Remove component" className="mb-0.5 flex h-10 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--danger)]"><Trash2 size={15}/></button>
          <div className="col-span-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--canvas)] px-3 py-2 text-[11px]">
            <span className="text-[var(--text-muted)]">{line.factor==null?'No compatible conversion':`${Number(line.qty||0).toLocaleString()} ${line.unit} = ${Number(line.baseQty||0).toLocaleString(undefined,{maximumFractionDigits:6})} ${baseUnit}`}</span>
            <strong>{line.lineCost==null?'Cost unavailable':`KES ${line.lineCost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}</strong>
          </div>
        </div>;
      })}
      {!components.length&&<div className="rounded-lg bg-[var(--canvas)] p-3 text-xs text-[var(--text-muted)]">No components added yet.</div>}
      <label className="block text-xs font-medium">Recipe notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-sm" placeholder="Optional inventory notes"/></label>
      <div className="flex items-center justify-between rounded-lg bg-[var(--canvas)] p-3"><span className="text-xs text-[var(--text-muted)]">Estimated component cost per unit</span><strong className="text-sm tabular-nums">KES {componentCost.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
      <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]"><ArrowRightLeft size={14} className="mt-0.5 shrink-0"/> Choose a recipe unit from the same dimension as the component's stock unit. Standard mass, volume and count conversions are supported; custom property conversions take precedence.</div>
      <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]"><Info size={14} className="mt-0.5 shrink-0"/> The saved recipe stores the normalized stock quantity and snapshots the component's current cost. Future purchase-cost changes do not rewrite historical recipe cost snapshots.</div>
    </div>}
    <div className="mt-4 flex justify-end"><button type="button" onClick={save} disabled={loading||saving||!loaded||(enabled&&hasInvalidConversion)} className="min-h-11 rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving?'Saving…':'Save composite settings'}</button></div>
  </section>;
}
