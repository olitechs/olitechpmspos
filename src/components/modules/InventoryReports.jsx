import React,{useEffect,useState} from 'react';
import {AlertTriangle,Boxes,RefreshCw,TrendingDown,TrendingUp} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/lib/AuthContext';
import {inventoryService} from '@/services/inventoryService';

export default function InventoryReports(){
 const {user}=useAuth(),propertyId=user?.property?.id;const [rows,setRows]=useState([]),[valuation,setValuation]=useState([]),[loading,setLoading]=useState(true);
 const load=async()=>{if(!propertyId)return;setLoading(true);try{const [r,v]=await Promise.all([inventoryService.listInventoryReconciliation(propertyId),inventoryService.getInventoryValuation(propertyId)]);setRows(r);setValuation(v)}catch(e){toast.error(e.message)}finally{setLoading(false)}};useEffect(()=>{load()},[propertyId]);
 const total=valuation.reduce((s,x)=>s+Number(x.stock_value||0),0),mismatches=rows.filter(x=>Math.abs(Number(x.difference||0))>0.000001),negative=valuation.filter(x=>Number(x.current_stock)<0);
 return <div className="flex-1 overflow-y-auto p-4 lg:p-6"><div className="flex items-center justify-between mb-5"><div><h1 className="text-xl font-black">Inventory Reports</h1><p className="text-xs text-slate-500">Authoritative stock ledger, valuation and reconciliation.</p></div><button onClick={load} className="p-2 rounded-lg border" title="Refresh"><RefreshCw size={16}/></button></div>
 {loading?<div className="p-10 text-center text-slate-500">Loading reports…</div>:<>
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"><Metric icon={Boxes} label="Products" value={valuation.length}/><Metric icon={TrendingUp} label="Inventory value" value={'KES '+total.toLocaleString('en-KE',{minimumFractionDigits:2})}/><Metric icon={AlertTriangle} label="Ledger mismatches" value={mismatches.length}/><Metric icon={TrendingDown} label="Negative stock" value={negative.length}/></div>
 <section className="bg-white border rounded-xl overflow-auto mb-5"><div className="p-4 border-b font-black">Stock Reconciliation</div><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">Product</th><th>Current stock</th><th>Ledger stock</th><th>Difference</th></tr></thead><tbody>{rows.map(x=><tr key={x.product_id} className="border-b"><td className="p-3 font-bold">{x.name}</td><td>{x.current_stock}</td><td>{x.ledger_stock}</td><td className={Math.abs(Number(x.difference))>0.000001?'text-red-600 font-black':'text-emerald-700'}>{x.difference}</td></tr>)}{!rows.length&&<tr><td colSpan="4" className="p-8 text-center text-slate-500">No products have been configured for this property yet.</td></tr>}</tbody></table></section>
 <section className="bg-white border rounded-xl overflow-auto"><div className="p-4 border-b font-black">Inventory Valuation</div><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-3">SKU</th><th>Product</th><th>Stock</th><th>Cost</th><th>Value</th></tr></thead><tbody>{valuation.map(x=><tr key={x.product_id} className="border-b"><td className="p-3">{x.sku||'—'}</td><td>{x.name}</td><td>{x.current_stock}</td><td>KES {Number(x.cost_price||0).toLocaleString('en-KE')}</td><td>KES {Number(x.stock_value||0).toLocaleString('en-KE')}</td></tr>)}</tbody></table></section>
 </>}</div>
}
function Metric({icon:Icon,label,value}){return <div className="bg-white border rounded-xl p-4"><Icon size={17}/><div className="text-xs text-slate-500 mt-2">{label}</div><div className="font-black text-lg mt-1">{value}</div></div>}
