import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Edit3, Plus, Settings2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { inventoryService } from '@/services/inventoryService';
import { useAuth } from '@/lib/AuthContext';

const CENTER_OPTIONS = ['Kitchen','Bar'];
const UNIT_OPTIONS = ['pcs','bottle','glass','plate','portion','kg','ltr'];

export default function MenuManager({ open, onClose, embedded = false }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const fileRef = useRef(null);
  const [menu,setMenu]=useState([]);
  const [categories,setCategories]=useState([]);
  const [editing,setEditing]=useState(null);
  const [categoryName,setCategoryName]=useState('');
  const [loading,setLoading]=useState(false);
  const [search,setSearch]=useState('');

  const reload=async()=>{
    if(!propertyId)return;
    setLoading(true);
    try {
      const [m,c]=await Promise.all([inventoryService.listPosMenu(propertyId),inventoryService.listPosCategories(propertyId)]);
      setMenu(m); setCategories(c);
    } catch(e){ toast.error(e.message); } finally { setLoading(false); }
  };
  useEffect(()=>{ if(open) reload(); },[open,propertyId]);
  const filtered=useMemo(()=>menu.filter(p=>!search||p.name.toLowerCase().includes(search.toLowerCase())||String(p.sku||'').toLowerCase().includes(search.toLowerCase())),[menu,search]);

  if(!open)return null;

  const save=async()=>{
    if(!editing?.name?.trim())return;
    try{
      await inventoryService.upsertPosMenuItem({
        propertyId,id:editing.id,sku:editing.sku,name:editing.name,category:editing.category||'General',
        unit:editing.unit||'pcs',sellingPrice:editing.selling_price,currentStock:editing.current_stock,
        minStock:editing.min_stock,maxStock:editing.max_stock,productionCenter:editing.production_center||'Kitchen',
        sortOrder:editing.pos_sort,active:true
      });
      toast.success(editing.id?'Menu item updated.':'Menu item added to POS.');
      setEditing(null); await reload(); window.dispatchEvent(new Event('olitech:menu-updated'));
    }catch(e){toast.error(e.message);}
  };

  const addCategory=async()=>{
    if(!categoryName.trim())return;
    try{await inventoryService.upsertPosCategory({propertyId,name:categoryName,productionCenter:'Kitchen'});setCategoryName('');await reload();toast.success('Category added.');}
    catch(e){toast.error(e.message);}
  };

  const importFile=async(e)=>{
    const f=e.target.files?.[0]; if(!f)return;
    try{
      const rows=await inventoryService.parseImportFile(f);
      const count=await inventoryService.bulkUpsertPosMenu(propertyId,rows);
      window.dispatchEvent(new Event('olitech:menu-updated'));
      toast.success(`${count} menu products imported and assigned to POS.`);
      await reload();
    }catch(err){toast.error(err.message);}
    e.target.value='';
  };

  const exportFile=async()=>{try{await inventoryService.exportPosMenu(menu);toast.success('POS menu exported.');}catch(e){toast.error(e.message);}};

  return <div className={embedded ? 'flex w-full flex-col' : 'fixed inset-0 z-[400] flex items-center justify-center bg-[var(--overlay-scrim)] p-3 md:p-6'}>
    <div className={'flex w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)] ' + (embedded ? 'min-h-[28rem]' : 'max-h-[94vh] shadow-2xl')}>
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <div><div className="flex items-center gap-2 text-lg font-medium text-[var(--text)]"><Settings2 size={20}/> POS Menu & Product Catalogue</div><div className="mt-1 text-xs text-[var(--text-muted)]">Managers and cashiers can create menu products, categories and POS pricing. Stock remains linked to the product ledger.</div></div>
        {!embedded && <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 text-[var(--text-muted)] hover:bg-[var(--sidebar)]" aria-label="Close menu manager"><X size={20}/></button>}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_1fr]">
        <aside className="border-b border-[var(--border)] bg-[var(--surface)] p-4 lg:border-b-0 lg:border-r">
          <div className="text-[10px] font-medium  text-[var(--text-muted)]">Categories</div>
          <div className="mt-3 space-y-1">{categories.map(c=><div key={c.id} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium hover:bg-[var(--canvas)]"><span>{c.name}</span><span className="text-[10px] text-[var(--text-muted)]">{c.production_center}</span></div>)}</div>
          <div className="mt-5 border-t pt-4"><div className="text-xs font-medium">Add category</div><div className="mt-2 flex gap-2"><input value={categoryName} onChange={e=>setCategoryName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addCategory()} placeholder="e.g. Cocktails" className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"/><button onClick={addCategory} className="rounded-xl bg-[var(--primary)] px-3 text-primary-foreground"><Plus size={16}/></button></div></div>
        </aside>
        <main className="min-h-0 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search products / SKU…" className="min-w-[220px] flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"/>
            <button onClick={()=>setEditing({category:categories[0]?.name||'General',unit:'pcs',production_center:categories[0]?.production_center||'Kitchen',current_stock:0,min_stock:0,max_stock:0,selling_price:0,pos_sort:0})} className="inline-flex items-center gap-1 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-xs font-medium text-primary-foreground"><Plus size={15}/> Add Product</button>
            <button onClick={()=>fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-xs font-medium text-primary-foreground"><Upload size={15}/> Import Excel</button>
            <button onClick={exportFile} className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-medium"><Download size={15}/> Export</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={importFile} hidden/>
          </div>
          {loading?<div className="p-12 text-center text-sm font-medium text-[var(--text-muted)]">Loading menu…</div>:<div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"><div className="overflow-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-[var(--canvas)] text-[var(--text)]"><tr>{['SKU','Product','Category','Center','Price','Stock','Min',''].map(h=><th key={h} className="px-3 py-2 text-left text-[10px] ">{h}</th>)}</tr></thead><tbody>{filtered.map(p=><tr key={p.id} className="border-b border-[var(--border)] hover:bg-[var(--canvas)]"><td className="px-3 py-3 font-mono text-xs">{p.sku||'—'}</td><td className="px-3 py-3 font-medium">{p.name}</td><td className="px-3 py-3">{p.category}</td><td className="px-3 py-3">{p.production_center}</td><td className="px-3 py-3 font-medium">KES {Number(p.selling_price||0).toLocaleString()}</td><td className="px-3 py-3">{Number(p.current_stock||0)} {p.unit}</td><td className="px-3 py-3">{Number(p.min_stock||0)}</td><td className="px-3 py-3"><button onClick={()=>setEditing(p)} className="rounded-lg border p-2 hover:bg-[var(--primary-soft)]"><Edit3 size={14}/></button></td></tr>)}</tbody></table></div></div>}
        </main>
      </div>
      {editing&&<div className={'fixed inset-0 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 ' + (embedded ? 'z-[550]' : 'z-[450]')}><div className="w-full max-w-2xl rounded-3xl bg-[var(--surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-medium">{editing.id?'Edit POS Product':'Add POS Product'}</h3><button onClick={()=>setEditing(null)}><X size={18}/></button></div><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{[['name','Product Name'],['sku','SKU'],['selling_price','Selling Price'],['current_stock','Current Stock'],['min_stock','Minimum Stock'],['max_stock','Maximum Stock'],['pos_sort','Sort Order']].map(([k,l])=><label key={k} className="text-xs font-medium">{l}<input type={['selling_price','current_stock','min_stock','max_stock','pos_sort'].includes(k)?'number':'text'} value={editing[k]??''} onChange={e=>setEditing({...editing,[k]:e.target.value})} className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5"/></label>)}<label className="text-xs font-medium">Category<select value={editing.category||'General'} onChange={e=>setEditing({...editing,category:e.target.value})} className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5">{categories.map(c=><option key={c.id}>{c.name}</option>)}{!categories.length&&<option>General</option>}</select></label><label className="text-xs font-medium">Unit<select value={editing.unit||'pcs'} onChange={e=>setEditing({...editing,unit:e.target.value})} className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5">{UNIT_OPTIONS.map(x=><option key={x}>{x}</option>)}</select></label><label className="text-xs font-medium">Production Center<select value={editing.production_center||'Kitchen'} onChange={e=>setEditing({...editing,production_center:e.target.value})} className="mt-1 w-full rounded-xl border border-[var(--border)] px-3 py-2.5">{CENTER_OPTIONS.map(x=><option key={x}>{x}</option>)}</select></label></div><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setEditing(null)} className="rounded-xl border px-4 py-2.5 text-sm font-medium">Cancel</button><button onClick={save} className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-primary-foreground">Save Product</button></div></div></div>}
    </div>
  </div>;
}
