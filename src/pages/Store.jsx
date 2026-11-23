import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ClipboardList, FileSpreadsheet, Package, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { inventoryService, STORE_CATEGORIES, STORE_LOCATIONS } from '@/services/inventoryService';
import ProductTable from '@/components/store/ProductTable';
import StockAlerts from '@/components/store/StockAlerts';
import SupplierList from '@/components/store/SupplierList';
import ImportExport from '@/components/store/ImportExport';
import StockMovements from '@/components/store/StockMovements';
import UsageForm from '@/components/store/UsageForm';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import PackExcelExportButton from '@/components/shared/PackExcelExportButton';
import { buildStockControlDefinition } from '@/services/reportDefinitions';
import { packExportDataService, todayKenya } from '@/services/packExportDataService';
import { adjustmentFormFilename, downloadPackWorkbook, stockExportFilename } from '@/services/packExports';
import { buildAdjustmentFormWorkbook, buildStockWorkbook } from '@/services/packExports/stockWorkbook.js';
import { Modal } from '@/components/store/SupplierList';
import { getSessionStaff, normalizeStaffRole } from '@/services/authService';
import StoreBarcodeLabels from '@/components/store/StoreBarcodeLabels';
import CompositeItemEditor from '@/components/pos/CompositeItemEditor';
import ProductVariantsEditor from '@/components/store/ProductVariantsEditor';
import { useSearchParams } from 'react-router-dom';
import { resolvePermissions } from '@/lib/permissions';

const TABS = [
  ['overview','Stock Overview'], ['products','Products'], ['suppliers','Suppliers'], ['purchases','Purchases / GRN'], ['usage','Stock Usage'], ['alerts','Alerts'], ['labels','Label Printing'],
];
const ROLES = ['storekeeper','store_keeper','store_manager','fb_manager','general_manager','admin','owner','administrator','manager','front_office_manager','hotel_admin','super_admin'];

export default function Store({ initialTab = 'overview' }) {
  const [searchParams] = useSearchParams();
  const routeTab = TABS.some(([id]) => id === searchParams.get('tab')) ? searchParams.get('tab') : initialTab;
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const sessionStaff = getSessionStaff();
  const role = normalizeStaffRole(sessionStaff?.role || user?.staff?.role || user?.propertyRole || user?.role);
  const permissions = resolvePermissions(user);
  const allowed = permissions.codes.has('stores.access') || ROLES.includes(role) || user?.isPlatformOwner;
  const isFnbManager = role === 'fb_manager';
  const showCost = permissions.codes.has('stores.stock.adjust') || ['storekeeper','store_keeper','store_manager','fb_manager','hotel_admin','super_admin','owner','admin','administrator','manager'].includes(role) || user?.isPlatformOwner;
  const readOnly = role === 'front_office_manager';
  const canWrite = !readOnly && (permissions.codes.has('stores.stock.adjust') || ['storekeeper','store_keeper','store_manager','fb_manager','hotel_admin','super_admin','owner','admin','administrator','manager'].includes(role) || user?.isPlatformOwner);
  const [tab,setTab]=useState(routeTab);
  useEffect(()=>{ if(routeTab) setTab(routeTab); },[routeTab]);
  const [products,setProducts]=useState([]), [suppliers,setSuppliers]=useState([]), [movements,setMovements]=useState([]), [alerts,setAlerts]=useState([]), [purchases,setPurchases]=useState([]);
  const [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [search,setSearch]=useState(searchParams.get('search') || ''), [category,setCategory]=useState('all'), [location,setLocation]=useState('all');
  const [productModal,setProductModal]=useState(null); const [reportFrom,setReportFrom]=useState(''); const [reportTo,setReportTo]=useState(''); const [reportCategory,setReportCategory]=useState('all'); const [reportLocation,setReportLocation]=useState('all');

  const load = useCallback(async()=>{ if(!propertyId)return; setLoading(true); try { const filterCategory=isFnbManager?'F&B':category; const [ps,ss,ms,as,po]=await Promise.all([inventoryService.listProducts(propertyId,{category:filterCategory,location,search}),inventoryService.listSuppliers(propertyId),inventoryService.listMovements(propertyId),inventoryService.getAlerts(propertyId),inventoryService.listPurchases(propertyId)]); setProducts(ps);setSuppliers(ss);setMovements(ms);setAlerts(as);setPurchases(po);setError(''); } catch(e){setError(e.message);} finally{setLoading(false);} },[propertyId,category,location,search,isFnbManager]);
  useEffect(()=>{load();},[load]);
  const stats=useMemo(()=>({total:products.length,low:products.filter(p=>Number(p.current_stock)>0&&Number(p.current_stock)<=Number(p.min_stock)).length,out:products.filter(p=>Number(p.current_stock)<=0).length,value:products.reduce((s,p)=>s+Number(p.current_stock||0)*Number(p.cost_price||0),0)}),[products]);
  const filteredProducts=useMemo(()=>products.filter(p=>!isFnbManager||p.category==='F&B'),[products,isFnbManager]);

  if(!allowed) return <div className="flex-1 bg-canvas flex items-center justify-center p-6"><div className="max-w-md text-center bg-surface border-2 border-border rounded-2xl p-8"><Package className="mx-auto mb-3"/><h2 className="text-xl font-black">Store access restricted</h2><p className="text-sm text-muted-foreground mt-2">Stores access is available to Storekeepers, Store Managers, F&B Managers, General Managers and Administrators.</p></div></div>;

  const addProduct=async(form)=>{try{await inventoryService.createProduct({...form,category:isFnbManager?'F&B':form.category,property_id:propertyId,current_stock:Number(form.current_stock)||0,min_stock:Number(form.min_stock)||0,max_stock:Number(form.max_stock)||0,cost_price:Number(form.cost_price)||0,selling_price:Number(form.selling_price)||0});toast.success('Product added.');setProductModal(null);load();}catch(e){toast.error(e.message);}};
  const editProduct=async(form)=>{try{await inventoryService.updateProduct(form.id,{...form,category:isFnbManager?'F&B':form.category,current_stock:Number(form.current_stock)||0,min_stock:Number(form.min_stock)||0,max_stock:Number(form.max_stock)||0,cost_price:Number(form.cost_price)||0,selling_price:Number(form.selling_price)||0,supplier_id:form.supplier_id||null});toast.success('Product updated.');setProductModal(null);load();}catch(e){toast.error(e.message);}};
  const importRows=async(rows)=>{
    try {
      const result=await inventoryService.bulkUpsertProducts(propertyId,rows);
      const errors=Array.isArray(result?.errors)?result.errors:[];
      const processed=Number(result?.processed||0);
      if(errors.length) toast.warning(`${processed} registered; ${errors.length} row(s) rejected. Check the import errors.`);
      else toast.success(`${processed || rows.length} products registered. POS-enabled rows are now available from Store in the POS catalogue.`);
      load();
      return result;
    } catch(e){toast.error(e.message);throw e;}
  };
  const addSupplier=async(f)=>{await inventoryService.createSupplier({propertyId,...f});toast.success('Supplier added.');load();};
  const recordUsage=async(f)=>{await inventoryService.recordUsage({propertyId,...f});load();};
  const getStockReportDefinition=async(onProgress=()=>{})=>{
    if(reportFrom&&reportTo&&reportFrom>reportTo) throw new Error('The stock report start date must be on or before the end date.');
    const categoryFilter=isFnbManager?'F&B':reportCategory;
    const [reportProducts,reportMovements]=await Promise.all([
      inventoryService.listProducts(propertyId,{category:categoryFilter,location:reportLocation}),
      inventoryService.listMovementsForReport(propertyId,{from:reportFrom||undefined,to:reportTo||undefined,category:categoryFilter,location:reportLocation},count=>onProgress(`Loading stock movements · ${count.toLocaleString()} rows`)),
    ]);
    const canIncludeCost=showCost&&(reportProducts.length===0||reportProducts.some(product=>product.cost_price!==null&&product.cost_price!==undefined));
    return buildStockControlDefinition({products:reportProducts,movements:reportMovements,from:reportFrom,to:reportTo,category:categoryFilter,location:reportLocation,propertyName:user?.property?.business_name||user?.property?.name||'OliTechs',generatedBy:user?.full_name||user?.staff?.full_name||'Authorized staff',showCost:canIncludeCost});
  };

  const propertyName=user?.property?.business_name||user?.property?.name||'OliTechs';
  const currency=user?.property?.currency||'KES';
  const loadStockExportData=()=>{
    if(reportFrom&&reportTo&&reportFrom>reportTo) throw new Error('The stock report start date must be on or before the end date.');
    return packExportDataService.loadStockExport(propertyId,{from:reportFrom||undefined,to:reportTo||undefined,category:isFnbManager?'F&B':reportCategory,location:reportLocation});
  };
  const exportStockWorkbook=async()=>{
    const extract=await loadStockExportData();
    return downloadPackWorkbook(buildStockWorkbook,{...extract,propertyName,currency,generatedAt:new Date(),from:reportFrom||undefined,to:reportTo||undefined},stockExportFilename({propertyName,from:reportFrom||undefined,to:reportTo||undefined}));
  };
  const exportAdjustmentForm=async()=>{
    const extract=await loadStockExportData();
    return downloadPackWorkbook(buildAdjustmentFormWorkbook,{...extract,propertyName,currency,generatedAt:new Date(),from:reportFrom||undefined,to:reportTo||undefined},adjustmentFormFilename({propertyName,date:reportTo||todayKenya()}));
  };

  return <div className="flex-1 min-h-0 overflow-y-auto bg-canvas p-4 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-5"><div><div className="flex items-center gap-2"><Package size={22}/><h1 className="text-2xl font-black">Store / Controls</h1>{isFnbManager&&<span className="text-[10px] font-black px-2 py-1 rounded-full bg-primary">F&B ONLY</span>}</div><p className="text-sm text-muted-foreground mt-1">Inventory, suppliers, purchasing, usage and stock alerts.</p></div><ImportExport products={filteredProducts} onImport={canWrite ? importRows : null}/></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">{[['Total Products',stats.total,Boxes,'black'],['Low Stock',stats.low,AlertTriangle,'yellow'],['Out of Stock',stats.out,AlertTriangle,'red'],['Stock Value',readOnly?'Restricted':`KES ${stats.value.toLocaleString('en-KE')}`,FileSpreadsheet,'green']].map(([l,v,I,c])=><div key={l} className="bg-surface border-2 border-border rounded-2xl p-4"><div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-widest font-black">{l}</span><I size={17} className={c==='red'?'text-[var(--danger)]':c==='yellow'?'text-[var(--warning)]':c==='green'?'text-[var(--success)]':''}/></div><div className="text-2xl font-black mt-2">{v}</div></div>)}</div>
    <div className="flex gap-1 overflow-x-auto mb-4 bg-surface border-2 border-border rounded-xl p-1">{TABS.map(([id,label])=><button key={id} disabled={readOnly && ['purchases','usage'].includes(id)} onClick={()=>setTab(id)} className="px-4 py-2.5 rounded-lg text-xs font-black whitespace-nowrap" style={{background:tab===id?'var(--primary)':'var(--surface)',color:tab===id?'var(--on-primary)':'var(--text)'}}>{label}{id==='alerts'&&alerts.length>0?<span className="ml-1.5 rounded-full bg-[var(--danger)] text-[var(--status-not-paid-foreground)] px-1.5 py-0.5">{alerts.length}</span>:null}</button>)}</div>
    {error&&<div className="mb-4 rounded-xl bg-[var(--danger-soft)] border-2 border-[var(--danger)] text-[var(--danger-text)] p-3 text-sm font-bold">{error}</div>}
    {loading?<div className="p-12 text-center font-bold text-muted-foreground">Loading Store…</div>:<>
      {tab==='overview'&&<Overview products={filteredProducts} alerts={alerts} movements={movements} onAlerts={()=>setTab('alerts')} showCost={showCost} onEdit={canWrite ? setProductModal : undefined}/>} 
      {tab==='products'&&<><Filters search={search} setSearch={setSearch} category={category} setCategory={setCategory} location={location} setLocation={setLocation} fnb={isFnbManager}/><div className="mt-4"><ProductTable products={filteredProducts} onEdit={canWrite ? setProductModal : undefined} onAdd={canWrite ? ()=>setProductModal({}) : undefined} showCost={showCost}/></div></>}
      {tab==='suppliers'&&<SupplierList suppliers={suppliers} onAdd={canWrite ? addSupplier : undefined}/>} 
      {tab==='purchases'&&canWrite&&<PurchasePanel propertyId={propertyId} products={filteredProducts} suppliers={suppliers} onSaved={load}/>} 
      {tab==='usage'&&canWrite&&<div className="space-y-4"><UsageForm products={filteredProducts} onSubmit={recordUsage}/><StockMovements movements={movements.filter(m=>String(m.reason||'').toLowerCase().includes('usage'))}/></div>}
      {tab==='labels'&&<StoreBarcodeLabels products={filteredProducts}/>}
      {tab==='alerts'&&<div className="space-y-4"><StockAlerts alerts={alerts}/><ReportBar from={reportFrom} setFrom={setReportFrom} to={reportTo} setTo={setReportTo} category={reportCategory} setCategory={setReportCategory} location={reportLocation} setLocation={setReportLocation} getDefinition={getStockReportDefinition} onExportWorkbook={exportStockWorkbook} onExportAdjustmentForm={exportAdjustmentForm} disabled={!propertyId}/></div>}
    </>}
    {productModal!==null&&<ProductModal value={productModal} suppliers={suppliers} propertyId={propertyId} fnbOnly={isFnbManager} onClose={()=>setProductModal(null)} onSave={productModal.id?editProduct:addProduct}/>} 
  </div>;
}

function Filters({search,setSearch,category,setCategory,location,setLocation,fnb}){return <div className="flex flex-wrap gap-2 bg-surface border-2 border-border rounded-xl p-3"><div className="flex items-center gap-2 border-2 border-border rounded-lg px-3 flex-1 min-w-[220px]"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product or SKU…" className="py-2 w-full outline-none text-sm"/></div><select disabled={fnb} value={fnb?'F&B':category} onChange={e=>setCategory(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm font-bold">{!fnb&&<option value="all">All Categories</option>}{STORE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><select value={location} onChange={e=>setLocation(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm font-bold"><option value="all">All Locations</option>{STORE_LOCATIONS.map(x=><option key={x}>{x}</option>)}</select></div>}

function Overview({products,alerts,movements,onAlerts,showCost,onEdit}){return <div className="grid lg:grid-cols-3 gap-4"><div className="lg:col-span-2"><ProductTable products={products.slice(0,12)} onEdit={onEdit} showCost={showCost} /></div><div><StockAlerts alerts={alerts.slice(0,8)}/>{alerts.length>8&&<button onClick={onAlerts} className="mt-2 text-xs font-black underline">View all alerts</button>}<div className="mt-4"><StockMovements movements={movements.slice(0,10)}/></div></div></div>}

function ProductModal({value,suppliers,propertyId,fnbOnly=false,onClose,onSave}){
  const [f,setF]=useState({sku:'',name:'',description:'',category:'F&B',unit:'bottle',base_unit:'bottle',current_stock:0,min_stock:5,max_stock:100,cost_price:0,selling_price:0,supplier_id:'',location:'Main Store',expiry_date:'',pos_enabled:false,pos_category:'',production_center:'Kitchen',pos_sort:0,pos_active:true,track_stock:true,inventory_tracking_mode:'direct',...value});
  const set=(k,v)=>setF(current=>({...current,[k]:v}));
  const isComposite=f.inventory_tracking_mode==='composite';
  return <Modal title={value.id?'Edit item':'Add item'} wide onClose={onClose}>
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
      <section className="rounded-xl border-2 border-border p-4">
        <h3 className="mb-3 font-black">Item details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs font-black">Name *<input value={f.name} onChange={e=>set('name',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">SKU<input value={f.sku||''} onChange={e=>set('sku',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">Category<select disabled={fnbOnly} value={fnbOnly?'F&B':f.category} onChange={e=>set('category',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5">{STORE_CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="text-xs font-black">Description<textarea value={f.description||''} onChange={e=>set('description',e.target.value)} rows={2} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">Sold by / Stock unit<select value={f.unit||'pcs'} onChange={e=>{set('unit',e.target.value);set('base_unit',e.target.value)}} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5">{['pcs','bottle','glass','plate','portion','kg','g','ltr','ml','pack','box'].map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="text-xs font-black">Location<select value={f.location||'Main Store'} onChange={e=>set('location',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5">{STORE_LOCATIONS.map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="text-xs font-black">Selling price (KES)<input type="number" min="0" step="0.01" value={f.selling_price??0} onChange={e=>set('selling_price',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">Average cost (KES)<input type="number" min="0" step="0.01" value={f.cost_price??0} onChange={e=>set('cost_price',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">Primary supplier<select value={f.supplier_id||''} onChange={e=>set('supplier_id',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"><option value="">No supplier</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
      </section>
      <section className="rounded-xl border-2 border-border p-4">
        <h3 className="mb-3 font-black">Inventory</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[[ 'current_stock','In stock' ],['min_stock','Low stock alert'],['max_stock','Optimal / maximum stock'],['expiry_date','Expiry date']].map(([k,label])=><label key={k} className="text-xs font-black">{label}<input type={k==='expiry_date'?'date':'number'} min="0" value={f[k]??''} disabled={k==='current_stock'&&Boolean(value.id)} onChange={e=>set(k,e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5 disabled:opacity-60"/></label>)}
        </div>
        {value.id&&<p className="mt-2 text-xs text-muted-foreground">For an existing item, use Stock Adjustments to change on-hand quantity so every change is recorded in inventory history.</p>}
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.track_stock!==false} onChange={e=>{set('track_stock',e.target.checked);if(!e.target.checked)set('inventory_tracking_mode','untracked');else if(f.inventory_tracking_mode==='untracked')set('inventory_tracking_mode','direct')}}/> Track stock</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pos_enabled===true||String(f.pos_enabled).toLowerCase()==='true'} onChange={e=>set('pos_enabled',e.target.checked)}/> The item is available for sale</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pos_active!==false} onChange={e=>set('pos_active',e.target.checked)}/> Active on POS</label>
        </div>
        {!f.pos_enabled&&<p className="mt-2 text-xs text-muted-foreground">This item is kept for inventory and will not appear as a sale item in the POS menu.</p>}
      </section>
      <section className="rounded-xl border-2 border-border p-4">
        <h3 className="mb-1 font-black">Composite item</h3>
        <p className="mb-3 text-xs text-muted-foreground">Create a sellable item from component products. Set up and save each component as an item first, then add it to this recipe.</p>
        {value.id?<CompositeItemEditor propertyId={propertyId} productId={value.id} onSaved={()=>{toast.success('Composite recipe saved.');}}/>:<p className="rounded-lg bg-muted p-3 text-xs">Save this item first. Reopen it to add its components and quantities.</p>}
        {isComposite&&<p className="mt-2 text-xs text-muted-foreground">This item's stock is derived from its component recipe.</p>}
      </section>
      <section className="rounded-xl border-2 border-border p-4">
        <h3 className="mb-3 font-black">Variants</h3>
        {value.id?<ProductVariantsEditor propertyId={propertyId} productId={value.id}/>:<p className="text-xs text-muted-foreground">Save the item first to add size, colour or pack variants.</p>}
      </section>
      <section className="rounded-xl border-2 border-border p-4">
        <h3 className="mb-3 font-black">POS presentation</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-black">POS category<input value={f.pos_category||''} onChange={e=>set('pos_category',e.target.value)} placeholder="e.g. Dry goods" className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label>
          <label className="text-xs font-black">Production center<select value={f.production_center||'Kitchen'} onChange={e=>set('production_center',e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"><option>Kitchen</option><option>Bar</option><option>Other</option></select></label>
        </div>
      </section>
    </div>
    <button onClick={()=>onSave(f)} disabled={!f.name.trim()} className="mt-5 w-full py-3 rounded-xl bg-primary font-black">{value.id?'Save item changes':'Create item'}</button>
  </Modal>
}

function PurchasePanel({propertyId,products,suppliers,onSaved}){const [supplierId,setSupplierId]=useState(''),[invoice,setInvoice]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[lines,setLines]=useState([{productId:'',qty:1,costPrice:0}]);const update=(i,k,v)=>setLines(lines.map((l,n)=>n===i?{...l,[k]:v}:l));const save=async()=>{try{await inventoryService.createPurchase({propertyId,supplierId,invoiceNo:invoice,purchaseDate:date,lines});toast.success('GRN / stock in posted.');setLines([{productId:'',qty:1,costPrice:0}]);onSaved();}catch(e){toast.error(e.message);}};return <div className="bg-surface border-2 border-border rounded-2xl p-4"><div className="grid grid-cols-2 lg:grid-cols-3 gap-3"><label className="text-xs font-black">Supplier<select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="text-xs font-black">Invoice No.<input value={invoice} onChange={e=>setInvoice(e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label><label className="text-xs font-black">Date<input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-1 w-full border-2 border-border rounded-lg px-3 py-2.5"/></label></div><div className="mt-5 space-y-2">{lines.map((l,i)=><div key={i} className="grid grid-cols-[1fr_100px_130px] gap-2"><select value={l.productId} onChange={e=>update(i,'productId',e.target.value)} className="border-2 border-border rounded-lg px-3 py-2"><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input type="number" min="1" value={l.qty} onChange={e=>update(i,'qty',e.target.value)} className="border-2 border-border rounded-lg px-3 py-2" placeholder="Qty"/><input type="number" min="0" value={l.costPrice} onChange={e=>update(i,'costPrice',e.target.value)} className="border-2 border-border rounded-lg px-3 py-2" placeholder="Cost"/></div>)}</div><div className="flex gap-2 mt-4"><button onClick={()=>setLines([...lines,{productId:'',qty:1,costPrice:0}])} className="px-4 py-2 rounded-lg border-2 border-border font-black text-xs"><Plus size={14} className="inline"/> Add line</button><button onClick={save} className="px-5 py-2 rounded-lg bg-primary font-black text-xs">Post Stock In / GRN</button></div><div className="mt-6 border-t-2 border-border pt-4"><h3 className="font-black mb-2">Recent Purchases</h3><div className="text-xs text-muted-foreground">Use the Stock Movements tab below for the audit trail.</div></div></div>}

function ReportBar({from,setFrom,to,setTo,category,setCategory,location,setLocation,getDefinition,onExportWorkbook,onExportAdjustmentForm,disabled}){return <div className="bg-surface border-2 border-border rounded-2xl p-4"><div className="flex items-center gap-2 mb-3"><ClipboardList size={17}/><h3 className="font-black">Stock Control report</h3></div><p className="mb-3 text-xs text-muted-foreground">Current stock position plus every matching movement in the selected date range. Exports stop with a clear error if source rows exceed the supported limit.</p><div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="stock-report-from">Movement from</label><input id="stock-report-from" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm"/><label className="sr-only" htmlFor="stock-report-to">Movement to</label><input id="stock-report-to" type="date" value={to} onChange={e=>setTo(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm"/><label className="sr-only" htmlFor="stock-report-category">Category</label><select id="stock-report-category" value={category} onChange={e=>setCategory(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm"><option value="all">All Categories</option>{STORE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><label className="sr-only" htmlFor="stock-report-location">Location</label><select id="stock-report-location" value={location} onChange={e=>setLocation(e.target.value)} className="border-2 border-border rounded-lg px-3 py-2 text-sm"><option value="all">All Locations</option>{STORE_LOCATIONS.map(item=><option key={item}>{item}</option>)}</select><DocumentExportMenu getDefinition={getDefinition} label="Export stock control" disabled={disabled}/><PackExcelExportButton label="Stock Excel (formulas)" run={onExportWorkbook} disabled={disabled}/><PackExcelExportButton label="Adjustment form" run={onExportAdjustmentForm} disabled={disabled}/></div></div>}
