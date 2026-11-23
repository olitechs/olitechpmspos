import React,{useEffect,useState} from 'react';
import {Boxes,ClipboardCheck,Factory,History,MapPin,PackageX,Scale,Warehouse} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/lib/AuthContext';
import {inventoryService} from '@/services/inventoryService';
import {pmsService} from '@/services/pmsService';
import {resolvePermissions} from '@/lib/permissions';

const tabs=[['locations','Locations',MapPin],['adjustments','Adjustments',ClipboardCheck],['counts','Counts',Scale],['production','Production',Factory],['wastage','Wastage / Expiry',PackageX],['history','Inventory History',History],['valuation','Valuation',Warehouse]];
const input='border rounded-lg px-3 py-2 text-sm w-full';

export default function InventoryOperations({initialTab='locations'}){
 const {user}=useAuth(), propertyId=user?.property?.id; const permissions=resolvePermissions(user); const [tab,setTab]=useState(initialTab);
 const visibleTabs=tabs.filter(([id])=>id==='locations'||id==='history'||id==='valuation'?permissions.codes.has('stores.inventory.view'):id==='adjustments'||id==='counts'?permissions.codes.has('stores.stock.adjust'):id==='production'?permissions.codes.has('stores.production.post'):id==='wastage'?(permissions.codes.has('stores.stock.wastage.submit')||permissions.codes.has('stores.stock.wastage.approve')):false);
 const visibleTabIds=visibleTabs.map(([id])=>id).join('|');
 useEffect(()=>{const ids=visibleTabIds.split('|').filter(Boolean);if(ids.includes(initialTab))setTab(initialTab);else if(ids.length)setTab(ids[0])},[initialTab,visibleTabIds]);
 const [locations,setLocations]=useState([]),[products,setProducts]=useState([]),[recipes,setRecipes]=useState([]),[history,setHistory]=useState([]),[expiry,setExpiry]=useState([]),[valuation,setValuation]=useState([]),[summary,setSummary]=useState(null),[counts,setCounts]=useState([]),[loading,setLoading]=useState(true);
 const load=async()=>{if(!propertyId)return;setLoading(true);try{const [l,p,r,h,e,v,s,c]=await Promise.all([pmsService.listInventoryLocations(propertyId),inventoryService.listProducts(propertyId),inventoryService.listRecipes(propertyId),inventoryService.listInventoryHistory(propertyId),inventoryService.listExpiryWatch(propertyId),inventoryService.getInventoryValuation(propertyId),inventoryService.getInventoryValuationSummary(propertyId),inventoryService.listInventoryCounts(propertyId)]);setLocations(l);setProducts(p);setRecipes(r);setHistory(h);setExpiry(e);setValuation(v);setSummary(Array.isArray(s)?s[0]||null:s);setCounts(c)}catch(e){toast.error(e.message)}finally{setLoading(false)}};useEffect(()=>{load()},[propertyId]);
 return <div className="flex-1 overflow-y-auto p-4 lg:p-6"><div className="flex items-center gap-2 mb-4"><Boxes/><div><h1 className="text-xl font-black">Inventory Operations</h1><p className="text-xs text-muted-foreground">Manage stock locations, physical counts and inventory activity.</p></div></div><div className="flex gap-1 overflow-x-auto border rounded-xl p-1 mb-4">{visibleTabs.map(([id,label,I])=><button key={id} onClick={()=>setTab(id)} className="px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1" style={{background:tab===id?'var(--primary-soft)':'transparent',color:tab===id?'var(--primary)':'var(--text)'}}><I size={14}/>{label}</button>)}</div>{loading?<div className="p-10 text-center text-muted-foreground">Loading inventory controls…</div>:<>{tab==='locations'&&<Locations locations={locations}/>} {tab==='adjustments'&&<Adjustments propertyId={propertyId} locations={locations} products={products} onSaved={load}/>} {tab==='counts'&&<Counts propertyId={propertyId} locations={locations} products={products} counts={counts} onSaved={load}/>} {tab==='production'&&<Production propertyId={propertyId} products={products} recipes={recipes} canPost={permissions.codes.has('stores.production.post')} onSaved={load}/>} {tab==='wastage'&&<Wastage propertyId={propertyId} locations={locations} products={products} expiry={expiry} canSubmit={permissions.codes.has('stores.stock.wastage.submit')} canApprove={permissions.codes.has('stores.stock.wastage.approve')} currentUserId={user?.id} onSaved={load}/>} {tab==='history'&&<HistoryTable rows={history}/>} {tab==='valuation'&&<Valuation rows={valuation} summary={summary}/>}</>}</div>
}
function Locations({locations}){return <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">{locations.map(l=><div key={l.id} className="bg-surface border rounded-xl p-4"><div className="font-black">{l.name}</div><div className="text-xs text-muted-foreground mt-1">Inventory location ready for transfers and physical counts.</div></div>)}</div>}
function Adjustments({propertyId,locations,products,onSaved}){const [f,setF]=useState({productId:'',locationId:'',changeQty:'',reason:''});const save=async()=>{try{await inventoryService.postAdjustment({...f,propertyId});toast.success('Stock adjustment posted.');setF({productId:'',locationId:'',changeQty:'',reason:''});onSaved()}catch(e){toast.error(e.message)}};return <Panel title="Stock Adjustment"><Select label="Product" value={f.productId} set={v=>setF({...f,productId:v})} options={products.map(x=>[x.id,x.name])}/><Select label="Location" value={f.locationId} set={v=>setF({...f,locationId:v})} options={locations.map(x=>[x.id,x.name])}/><label className="text-xs font-bold">Quantity change<input type="number" value={f.changeQty} onChange={e=>setF({...f,changeQty:e.target.value})} className={input} placeholder="Negative reduces stock"/></label><label className="text-xs font-bold">Reason<input value={f.reason} onChange={e=>setF({...f,reason:e.target.value})} className={input}/></label><button onClick={save} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold">Post Adjustment</button></Panel>}
function Counts({propertyId,locations,products,counts,onSaved}){const [loc,setLoc]=useState(''),[ref,setRef]=useState(''),[lines,setLines]=useState({});const save=async()=>{try{await inventoryService.createInventoryCount({propertyId,locationId:loc,reference:ref,lines:products.map(p=>({product_id:p.id,counted_qty:Number(lines[p.id]??p.current_stock??0)}))});toast.success('Count submitted for approval.');onSaved()}catch(e){toast.error(e.message)}};const approve=async id=>{try{await inventoryService.approveInventoryCount(id);toast.success('Count approved and variance posted.');onSaved()}catch(e){toast.error(e.message)}};return <div className="space-y-4"><Panel title="New Physical Count"><Select label="Location" value={loc} set={setLoc} options={locations.map(x=>[x.id,x.name])}/><label className="text-xs font-bold">Reference<input value={ref} onChange={e=>setRef(e.target.value)} className={input}/></label><div className="grid md:grid-cols-2 gap-2 max-h-80 overflow-auto">{products.map(p=><label key={p.id} className="text-xs border rounded-lg p-2"><span className="font-bold">{p.name}</span><input type="number" min="0" value={lines[p.id]??''} onChange={e=>setLines({...lines,[p.id]:e.target.value})} placeholder={String(p.current_stock||0)} className={input+' mt-1'}/></label>)}</div><button onClick={save} disabled={!loc} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold">Submit Count</button></Panel><Panel title="Count Approvals">{counts.filter(x=>x.status==='submitted').map(x=><div key={x.id} className="flex justify-between border-b py-3 text-sm"><span>{x.reference||'Physical count'} · {x.status}</span><button onClick={()=>approve(x.id)} className="px-3 py-1.5 rounded bg-[var(--success)] text-foreground text-xs font-bold">Approve</button></div>)}</Panel></div>}
function Production({propertyId,products,recipes,canPost,onSaved}){
 const [recipeId,setRecipeId]=useState(''),[output,setOutput]=useState(''),[qty,setQty]=useState('1'),[ref,setRef]=useState(''),[busy,setBusy]=useState(false);
 const [requestKey,setRequestKey]=useState(()=>globalThis.crypto?.randomUUID?.()||`production-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const save=async()=>{
  if(busy||!canPost)return;
  setBusy(true);
  try{
   await inventoryService.postProduction({propertyId,recipeId,outputProductId:output,quantity:qty,reference:ref,requestKey});
   toast.success('Production batch posted; components deducted and output added.');
   setRequestKey(globalThis.crypto?.randomUUID?.()||`production-${Date.now()}-${Math.random().toString(36).slice(2)}`);
   onSaved();
  }catch(e){toast.error(e.message)}finally{setBusy(false)}
 };
 return <Panel title="Production / Recipe Batch">
  <Select label="Recipe" value={recipeId} set={setRecipeId} options={recipes.map(x=>[x.id,x.menu_item_name])}/>
  <Select label="Output product" value={output} set={setOutput} options={products.filter(p=>p.track_stock!==false&&p.inventory_tracking_mode!=='composite').map(x=>[x.id,x.name])}/>
  <label className="text-xs font-bold">Quantity<input type="number" min="0.000001" step="0.000001" value={qty} onChange={e=>setQty(e.target.value)} className={input}/></label>
  <label className="text-xs font-bold">Reference<input value={ref} onChange={e=>setRef(e.target.value)} className={input}/></label>
  <div className="md:col-span-2 flex items-center justify-between gap-3">
   <p className="text-xs text-muted-foreground">{canPost?'Posting is atomic and retry-safe. The recipe version and component cost snapshot are recorded with the batch.':'You need the stores.production.post permission to post production.'}</p>
   <button onClick={save} disabled={!canPost||busy||!recipeId||!output||Number(qty)<=0} className="px-4 py-2 rounded-lg bg-[var(--success)] text-foreground font-bold disabled:opacity-50">{busy?'Posting…':'Post Production'}</button>
  </div>
 </Panel>
}
function Wastage({propertyId,locations,products,expiry,canSubmit,canApprove,currentUserId,onSaved}){
 const [f,setF]=useState({productId:'',locationId:'',quantity:'',reason:'',expiryDate:''});
 const [requests,setRequests]=useState([]),[busy,setBusy]=useState(false),[loadingRequests,setLoadingRequests]=useState(true);
 const [requestKey,setRequestKey]=useState(()=>globalThis.crypto?.randomUUID?.()||`wastage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const refresh=async()=>{setLoadingRequests(true);try{setRequests(await inventoryService.listWastageRequests(propertyId));}catch(e){toast.error(e.message)}finally{setLoadingRequests(false)}};
 useEffect(()=>{if(propertyId)refresh()},[propertyId]);
 const save=async()=>{
  if(busy)return;
  if(!canSubmit){toast.error('You do not have permission to submit wastage requests.');return;}
  setBusy(true);
  try{
   await inventoryService.postWastage({...f,propertyId,requestKey});
   toast.success('Wastage request submitted for manager approval. Stock has not yet changed.');
   setF({productId:'',locationId:'',quantity:'',reason:'',expiryDate:''});
   setRequestKey(globalThis.crypto?.randomUUID?.()||`wastage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
   await refresh();onSaved();
  }catch(e){toast.error(e.message)}finally{setBusy(false)}
 };
 const decide=async(row,decision)=>{
  if(busy)return;
  const reason=decision==='reject'?window.prompt('Enter the reason for rejecting this wastage request:'):null;
  if(decision==='reject'&&!String(reason||'').trim())return;
  setBusy(true);
  try{
   await inventoryService.decideWastage(row.id,decision,reason);
   toast.success(decision==='approve'?'Wastage approved and stock updated.':'Wastage request rejected; stock unchanged.');
   await refresh();onSaved();
  }catch(e){toast.error(e.message)}finally{setBusy(false)}
 };
 const productName=(id)=>products.find(p=>p.id===id)?.name||'Inventory item';
 return <div className="space-y-4">
  <Panel title="Submit Wastage / Expired Stock">
   <Select label="Product" value={f.productId} set={v=>setF({...f,productId:v})} options={products.filter(p=>p.track_stock!==false).map(x=>[x.id,x.name])}/>
   <Select label="Location" value={f.locationId} set={v=>setF({...f,locationId:v})} options={locations.map(x=>[x.id,x.name])}/>
   <label className="text-xs font-bold">Quantity<input type="number" min="0.01" step="0.01" value={f.quantity} onChange={e=>setF({...f,quantity:e.target.value})} className={input}/></label>
   <label className="text-xs font-bold">Reason<input value={f.reason} onChange={e=>setF({...f,reason:e.target.value})} className={input} placeholder="e.g. damaged, expired, spoilage"/></label>
   <label className="text-xs font-bold">Expiry date (optional)<input type="date" value={f.expiryDate} onChange={e=>setF({...f,expiryDate:e.target.value})} className={input}/></label>
   <div className="md:col-span-2 flex items-center justify-between gap-3">
    <p className="text-xs text-muted-foreground">Requests remain pending until a different authorized manager approves them. Stock is not deducted at submission.</p>
    <button disabled={!canSubmit||busy||!f.productId||!f.locationId||!f.quantity||!f.reason.trim()} onClick={save} className="px-4 py-2 rounded-lg bg-[var(--primary)] text-primary-foreground font-bold disabled:opacity-50">{busy?'Submitting…':'Submit for Approval'}</button>
   </div>
  </Panel>
  <div className="bg-surface border rounded-xl p-4">
   <div className="flex items-center justify-between mb-3"><h2 className="font-black">Pending Wastage Requests</h2><span className="text-xs text-muted-foreground">{requests.length} pending</span></div>
   {loadingRequests?<p className="text-sm text-muted-foreground">Loading requests…</p>:requests.length===0?<p className="text-sm text-muted-foreground">No pending wastage requests.</p>:<div className="space-y-2">
    {requests.map(row=><div key={row.id} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
     <div><div className="font-bold text-sm">{productName(row.product_id)} · {row.quantity}</div><div className="text-xs text-muted-foreground">{row.reason} · {locations.find(l=>l.id===row.location_id)?.name||'Location'} · {new Date(row.created_at).toLocaleString()}</div></div>
     {canApprove&&row.created_by!==currentUserId?<div className="flex gap-2"><button disabled={busy} onClick={()=>decide(row,'approve')} className="px-3 py-2 rounded-lg bg-[var(--success)] text-foreground text-xs font-bold disabled:opacity-50">Approve & Deduct</button><button disabled={busy} onClick={()=>decide(row,'reject')} className="px-3 py-2 rounded-lg border text-xs font-bold disabled:opacity-50">Reject</button></div>:<span className="text-xs text-muted-foreground">{row.created_by===currentUserId?'Awaiting approval by another manager':'Manager approval required'}</span>}
    </div>)}
   </div>}
  </div>
  <div className="bg-surface border rounded-xl p-4"><h2 className="font-black mb-3">Expiry Watch</h2>{expiry.map(x=><div key={x.product_id} className="py-2 border-b flex justify-between text-sm"><span>{x.name}</span><span className={x.expiry_status==='expired'?'text-[var(--danger-text)] font-bold':'text-[var(--warning-text)] font-bold'}>{x.expiry_status} · {x.expiry_date}</span></div>)}</div>
 </div>
}
function HistoryTable({rows}){return <div className="bg-surface border rounded-xl overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th><th>Source</th></tr></thead><tbody>{rows.map(x=><tr key={x.id} className="border-b"><td className="p-3">{new Date(x.created_at).toLocaleString()}</td><td>{x.product_name}</td><td>{x.type}</td><td>{x.signed_qty}</td><td>{x.reason||'—'}</td><td>{x.source_type||'—'}</td></tr>)}</tbody></table></div>}
function Valuation({rows,summary}){return <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Products',summary?.total_products||0],['Units',summary?.total_units||0],['Stock value','KES '+Number(summary?.total_value||0).toLocaleString('en-KE')],['Expired value','KES '+Number(summary?.expired_value||0).toLocaleString('en-KE')]].map(([k,v])=><div className="bg-surface border rounded-xl p-4" key={k}><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-black mt-1">{v}</div></div>)}</div><div className="bg-surface border rounded-xl overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">SKU</th><th>Product</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead><tbody>{rows.map(x=><tr key={x.product_id} className="border-b"><td className="p-3">{x.sku||'—'}</td><td>{x.name}</td><td>{x.current_stock}</td><td>KES {Number(x.cost_price||0).toLocaleString('en-KE')}</td><td>KES {Number(x.stock_value||0).toLocaleString('en-KE')}</td></tr>)}</tbody></table></div></div>}
function Panel({title,children}){return <div className="bg-surface border rounded-xl p-4"><h2 className="font-black mb-4">{title}</h2><div className="grid md:grid-cols-2 gap-3">{children}</div></div>}
function Select({label,value,set,options}){return <label className="text-xs font-bold">{label}<select value={value} onChange={e=>set(e.target.value)} className={input}><option value="">Select {label.toLowerCase()}</option>{options.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
