import React,{useEffect,useState} from 'react';
import {Boxes,ClipboardCheck,Factory,History,MapPin,PackageX,Scale,Warehouse} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/lib/AuthContext';
import {inventoryService} from '@/services/inventoryService';
import {pmsService} from '@/services/pmsService';
import {supabase} from '@/lib/supabaseClient';

const tabs=[['locations','Locations',MapPin],['adjustments','Adjustments',ClipboardCheck],['counts','Counts',Scale],['production','Production',Factory],['wastage','Wastage / Expiry',PackageX],['history','Inventory History',History],['valuation','Valuation',Warehouse]];
const input='border rounded-lg px-3 py-2 text-sm w-full';
const makeInventoryRequestKey=()=>globalThis.crypto?.randomUUID?.()||`inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function InventoryOperations({initialTab='locations'}){
 const {user}=useAuth(), propertyId=user?.property?.id; const [tab,setTab]=useState(initialTab);
 useEffect(()=>{if(tabs.some(([id])=>id===initialTab))setTab(initialTab)},[initialTab]);
 const [locations,setLocations]=useState([]),[products,setProducts]=useState([]),[recipes,setRecipes]=useState([]),[history,setHistory]=useState([]),[expiry,setExpiry]=useState([]),[valuation,setValuation]=useState([]),[summary,setSummary]=useState(null),[counts,setCounts]=useState([]),[loading,setLoading]=useState(true);
 const load=async()=>{if(!propertyId)return;setLoading(true);try{const [l,p,r,h,e,v,s,c]=await Promise.all([pmsService.listInventoryLocations(propertyId),inventoryService.listProducts(propertyId),inventoryService.listRecipes(propertyId),inventoryService.listInventoryHistory(propertyId),inventoryService.listExpiryWatch(propertyId),inventoryService.getInventoryValuation(propertyId),inventoryService.getInventoryValuationSummary(propertyId),supabase.from('inventory_counts').select('*, inventory_count_lines(*)').eq('property_id',propertyId).order('created_at',{ascending:false})]);if(c.error)throw new Error(c.error.message);setLocations(l);setProducts(p);setRecipes(r);setHistory(h);setExpiry(e);setValuation(v);setSummary(Array.isArray(s)?s[0]||null:s);setCounts(c.data||[])}catch(e){toast.error(e.message)}finally{setLoading(false)}};useEffect(()=>{load()},[propertyId]);
 return <div className="flex-1 overflow-y-auto p-4 lg:p-6"><div className="flex items-center gap-2 mb-4"><Boxes/><div><h1 className="text-xl font-black">Inventory Operations</h1><p className="text-xs text-muted-foreground">Manage stock locations, physical counts and inventory activity.</p></div></div><div className="flex gap-1 overflow-x-auto border rounded-xl p-1 mb-4">{tabs.map(([id,label,I])=><button key={id} onClick={()=>setTab(id)} className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1" style={{background:tab===id?'var(--primary-soft)':'transparent',color:tab===id?'var(--primary)':'var(--text)'}}><I size={14}/>{label}</button>)}</div>{loading?<div className="p-10 text-center text-muted-foreground">Loading inventory controls…</div>:<>{tab==='locations'&&<Locations locations={locations}/>} {tab==='adjustments'&&<Adjustments propertyId={propertyId} locations={locations} products={products} onSaved={load}/>} {tab==='counts'&&<Counts propertyId={propertyId} locations={locations} products={products} counts={counts} onSaved={load}/>} {tab==='production'&&<Production propertyId={propertyId} products={products} recipes={recipes} onSaved={load}/>} {tab==='wastage'&&<Wastage propertyId={propertyId} locations={locations} products={products} expiry={expiry} onSaved={load}/>} {tab==='history'&&<HistoryTable rows={history}/>} {tab==='valuation'&&<Valuation rows={valuation} summary={summary}/>}</>}</div>
}
function Locations({locations}){return <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">{locations.map(l=><div key={l.id} className="bg-surface border rounded-xl p-4"><div className="font-black">{l.name}</div><div className="text-xs text-muted-foreground mt-1">Inventory location ready for transfers and physical counts.</div></div>)}</div>}
function Adjustments({propertyId,locations,products,onSaved}){
 const [f,setF]=useState({productId:'',locationId:'',changeQty:'',reason:'',requestKey:makeInventoryRequestKey()});
 const change=patch=>setF(current=>({...current,...patch,requestKey:makeInventoryRequestKey()}));
 const save=async()=>{
  try{
   await inventoryService.postAdjustment({...f,propertyId});
   toast.success('Stock adjustment posted.');
   setF({productId:'',locationId:'',changeQty:'',reason:'',requestKey:makeInventoryRequestKey()});
   onSaved();
  }catch(e){toast.error(e.message)}
 };
 return <Panel title="Stock Adjustment">
  <Select label="Product" value={f.productId} set={v=>change({productId:v})} options={products.filter(x=>x.track_stock!==false).map(x=>[x.id,x.name])}/>
  <Select label="Location" value={f.locationId} set={v=>change({locationId:v})} options={locations.map(x=>[x.id,x.name])}/>
  <label className="text-xs font-bold">Quantity change<input type="number" step="0.01" value={f.changeQty} onChange={e=>change({changeQty:e.target.value})} className={input} placeholder="Negative reduces stock"/></label>
  <label className="text-xs font-bold">Reason<input value={f.reason} onChange={e=>change({reason:e.target.value})} className={input}/></label>
  <button onClick={save} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold">Post Adjustment</button>
 </Panel>
}
function Counts({propertyId,locations,products,counts,onSaved}){
 const [loc,setLoc]=useState('');
 const [ref,setRef]=useState('');
 const [lines,setLines]=useState({});
 const [locationStock,setLocationStock]=useState({});
 const [requestKey,setRequestKey]=useState(makeInventoryRequestKey);

 useEffect(()=>{
  let active=true;
  const load=async()=>{
   if(!loc){setLocationStock({});return;}
   const {data,error}=await supabase.from('product_stock_locations')
    .select('product_id,qty').eq('property_id',propertyId).eq('location_id',loc);
   if(error){if(active)toast.error(error.message);return;}
   if(active)setLocationStock(Object.fromEntries((data||[]).map(row=>[row.product_id,Number(row.qty)||0])));
  };
  load();
  return()=>{active=false};
 },[loc,propertyId]);

 const changeLocation=value=>{setLoc(value);setLines({});setLocationStock({});setRequestKey(makeInventoryRequestKey())};
 const save=async()=>{
  const countLines=products
   .filter(p=>p.track_stock!==false&&lines[p.id]!==undefined&&String(lines[p.id]).trim()!=='')
   .map(p=>({product_id:p.id,counted_qty:Number(lines[p.id])}));
  if(!countLines.length){toast.error('Enter a physical count for at least one tracked product.');return}
  try{
   await inventoryService.createInventoryCount({propertyId,locationId:loc,reference:ref,lines:countLines,requestKey});
   toast.success('Count submitted for approval.');
   setLines({});
   setRef('');
   setRequestKey(makeInventoryRequestKey());
   onSaved();
  }catch(e){toast.error(e.message)}
 };
 const approve=async id=>{
  try{await inventoryService.approveInventoryCount(id);toast.success('Count approved and variance posted.');onSaved()}
  catch(e){toast.error(e.message)}
 };
 return <div className="space-y-4">
  <Panel title="New Physical Count">
   <Select label="Location" value={loc} set={changeLocation} options={locations.map(x=>[x.id,x.name])}/>
   <label className="text-xs font-bold">Reference<input value={ref} onChange={e=>{setRef(e.target.value);setRequestKey(makeInventoryRequestKey())}} className={input}/></label>
   <div className="grid md:grid-cols-2 gap-2 max-h-80 overflow-auto">
    {products.filter(p=>p.track_stock!==false).map(p=><label key={p.id} className="text-xs border rounded-lg p-2">
     <span className="font-bold">{p.name}</span>
     <span className="block text-muted-foreground mt-1">System at location: {Number(locationStock[p.id]||0).toFixed(2)}</span>
     <input type="number" min="0" step="0.01" value={lines[p.id]??''}
      onChange={e=>{setLines(current=>({...current,[p.id]:e.target.value}));setRequestKey(makeInventoryRequestKey())}}
      placeholder="Enter counted quantity" className={input+' mt-1'}/>
    </label>)}
   </div>
   <button onClick={save} disabled={!loc} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold">Submit Count</button>
  </Panel>
  <Panel title="Count Approvals">
   {counts.filter(x=>x.status==='submitted').map(x=><div key={x.id} className="flex justify-between border-b py-3 text-sm">
    <span>{x.reference||'Physical count'} · {x.status}</span>
    <button onClick={()=>approve(x.id)} className="px-3 py-1.5 rounded bg-[var(--success)] text-foreground text-xs font-bold">Approve</button>
   </div>)}
  </Panel>
 </div>
}
function Production({propertyId,products,recipes,onSaved}){const [recipeId,setRecipeId]=useState(''),[output,setOutput]=useState(''),[qty,setQty]=useState('1'),[ref,setRef]=useState('');const save=async()=>{try{await inventoryService.postProduction({propertyId,recipeId,outputProductId:output,quantity:qty,reference:ref});toast.success('Production posted; ingredients consumed and output added.');onSaved()}catch(e){toast.error(e.message)}};return <Panel title="Production / Recipe Batch"><Select label="Recipe" value={recipeId} set={setRecipeId} options={recipes.map(x=>[x.id,x.menu_item_name])}/><Select label="Output product" value={output} set={setOutput} options={products.map(x=>[x.id,x.name])}/><label className="text-xs font-bold">Quantity<input type="number" min="0.001" value={qty} onChange={e=>setQty(e.target.value)} className={input}/></label><label className="text-xs font-bold">Reference<input value={ref} onChange={e=>setRef(e.target.value)} className={input}/></label><button onClick={save} disabled={!recipeId||!output} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold">Post Production</button></Panel>}
function Wastage({propertyId,locations,products,expiry,onSaved}){
 const [f,setF]=useState({productId:'',locationId:'',quantity:'',reason:'',expiryDate:'',requestKey:makeInventoryRequestKey()});
 const change=patch=>setF(current=>({...current,...patch,requestKey:makeInventoryRequestKey()}));
 const save=async()=>{
  try{
   await inventoryService.postWastage({...f,propertyId});
   toast.success('Wastage posted to stock ledger.');
   setF({productId:'',locationId:'',quantity:'',reason:'',expiryDate:'',requestKey:makeInventoryRequestKey()});
   onSaved();
  }catch(e){toast.error(e.message)}
 };
 return <div className="space-y-4">
  <Panel title="Post Wastage / Expired Stock">
   <Select label="Product" value={f.productId} set={v=>change({productId:v})} options={products.filter(x=>x.track_stock!==false).map(x=>[x.id,x.name])}/>
   <Select label="Location" value={f.locationId} set={v=>change({locationId:v})} options={locations.map(x=>[x.id,x.name])}/>
   <label className="text-xs font-bold">Quantity<input type="number" min="0" step="0.01" value={f.quantity} onChange={e=>change({quantity:e.target.value})} className={input}/></label>
   <label className="text-xs font-bold">Reason<input value={f.reason} onChange={e=>change({reason:e.target.value})} className={input}/></label>
   <label className="text-xs font-bold">Expiry date<input type="date" value={f.expiryDate} onChange={e=>change({expiryDate:e.target.value})} className={input}/></label>
   <button onClick={save} className="px-4 py-2 rounded-lg bg-[var(--danger)] text-foreground font-bold">Post Wastage</button>
  </Panel>
  <div className="bg-surface border rounded-xl p-4"><h2 className="font-black mb-3">Expiry Watch</h2>
   {expiry.map(x=><div key={x.product_id} className="py-2 border-b flex justify-between text-sm">
    <span>{x.name}</span><span className={x.expiry_status==='expired'?'text-[var(--danger-text)] font-bold':'text-[var(--warning-text)] font-bold'}>{x.expiry_status} · {x.expiry_date}</span>
   </div>)}
  </div>
 </div>
}
function HistoryTable({rows}){return <div className="bg-surface border rounded-xl overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th><th>Source</th></tr></thead><tbody>{rows.map(x=><tr key={x.id} className="border-b"><td className="p-3">{new Date(x.created_at).toLocaleString()}</td><td>{x.product_name}</td><td>{x.type}</td><td>{x.signed_qty}</td><td>{x.reason||'—'}</td><td>{x.source_type||'—'}</td></tr>)}</tbody></table></div>}
function Valuation({rows,summary}){return <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Products',summary?.total_products||0],['Units',summary?.total_units||0],['Stock value','KES '+Number(summary?.total_value||0).toLocaleString('en-KE')],['Expired value','KES '+Number(summary?.expired_value||0).toLocaleString('en-KE')]].map(([k,v])=><div className="bg-surface border rounded-xl p-4" key={k}><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-black mt-1">{v}</div></div>)}</div><div className="bg-surface border rounded-xl overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">SKU</th><th>Product</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead><tbody>{rows.map(x=><tr key={x.product_id} className="border-b"><td className="p-3">{x.sku||'—'}</td><td>{x.name}</td><td>{x.current_stock}</td><td>KES {Number(x.cost_price||0).toLocaleString('en-KE')}</td><td>KES {Number(x.stock_value||0).toLocaleString('en-KE')}</td></tr>)}</tbody></table></div></div>}
function Panel({title,children}){return <div className="bg-surface border rounded-xl p-4"><h2 className="font-black mb-4">{title}</h2><div className="grid md:grid-cols-2 gap-3">{children}</div></div>}
function Select({label,value,set,options}){return <label className="text-xs font-bold">{label}<select value={value} onChange={e=>set(e.target.value)} className={input}><option value="">Select {label.toLowerCase()}</option>{options.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
