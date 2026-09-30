import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PackagePlus, Plus, Truck, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

const BORDER='#E5E5E5', SURFACE='#FFFFFF', SURFACE2='#F2F2F2', TEXT='#090C11', MUTED='#757B81', YELLOW='#FFD300';

export default function Purchasing() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [suppliers,setSuppliers]=useState([]);
  const [products,setProducts]=useState([]);
  const [orders,setOrders]=useState([]);
  const [supplierId,setSupplierId]=useState('');
  const [productId,setProductId]=useState('');
  const [qty,setQty]=useState('1');
  const [unitCost,setUnitCost]=useState('0');
  const [invoiceNo,setInvoiceNo]=useState('');
  const [lines,setLines]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    if(!propertyId){setLoading(false);return;}
    setLoading(true);
    try{
      const [s,p,o]=await Promise.all([
        pmsService.listSuppliers(propertyId),
        pmsService.listProducts(propertyId),
        pmsService.listPurchaseOrders(propertyId),
      ]);
      setSuppliers(s); setProducts(p); setOrders(o); setError('');
    }catch(e){setError(e.message||'Could not load purchasing data.');}
    finally{setLoading(false);}
  },[propertyId]);
  useEffect(()=>{load();},[load]);

  const addLine=()=>{
    if(!productId || Number(qty)<=0 || Number(unitCost)<0) return setError('Select a product and enter valid quantity/cost.');
    const product=products.find(p=>p.id===productId);
    setLines(prev=>[...prev,{product_id:productId,product_name:product?.name||'Product',qty:Number(qty),unit_cost:Number(unitCost)}]);
    setProductId(''); setQty('1'); setUnitCost('0'); setError('');
  };
  const total=useMemo(()=>lines.reduce((sum,l)=>sum+l.qty*l.unit_cost,0),[lines]);

  const createOrder=async()=>{
    if(!supplierId) return setError('Select a supplier.');
    if(!lines.length) return setError('Add at least one purchase line.');
    try{
      await pmsService.createPurchaseOrder({propertyId,supplierId,lines,invoiceNo});
      setLines([]);setSupplierId('');setInvoiceNo('');setError('');load();
    }catch(e){setError(e.message||'Could not create purchase order.');}
  };

  const receive=async(id)=>{
    if(!window.confirm('Receive this purchase order and add its quantities to stock?')) return;
    try{await pmsService.receivePurchaseOrder({purchaseOrderId:id});setError('');load();}
    catch(e){setError(e.message||'Could not receive purchase order.');}
  };

  return <div className="flex-1 overflow-y-auto p-4" style={{background:'#F8F8F7'}}>
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="xl:col-span-1 rounded-2xl p-4" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <div className="flex items-center gap-2 mb-4"><PackagePlus size={18}/><h2 className="text-sm font-black uppercase tracking-widest">New Purchase Order</h2></div>
        <label className="block text-xs font-bold mb-1">Supplier</label>
        <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="w-full p-2.5 rounded-lg mb-3 text-sm" style={{background:SURFACE2,border:`1px solid ${BORDER}`}}>
          <option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="block text-xs font-bold mb-1">Invoice / Reference</label>
        <input value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)} className="w-full p-2.5 rounded-lg mb-3 text-sm" style={{background:SURFACE2,border:`1px solid ${BORDER}`}} placeholder="Optional"/>
        <div className="grid grid-cols-2 gap-2">
          <select value={productId} onChange={e=>{setProductId(e.target.value);const p=products.find(x=>x.id===e.target.value);if(p)setUnitCost(String(p.cost_price||0));}} className="p-2.5 rounded-lg text-sm" style={{background:SURFACE2,border:`1px solid ${BORDER}`}}>
            <option value="">Product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="number" min="0.01" step="0.01" value={qty} onChange={e=>setQty(e.target.value)} className="p-2.5 rounded-lg text-sm" style={{background:SURFACE2,border:`1px solid ${BORDER}`}} placeholder="Qty"/>
        </div>
        <div className="flex gap-2 mt-2">
          <input type="number" min="0" step="0.01" value={unitCost} onChange={e=>setUnitCost(e.target.value)} className="flex-1 p-2.5 rounded-lg text-sm" style={{background:SURFACE2,border:`1px solid ${BORDER}`}} placeholder="Unit cost"/>
          <button onClick={addLine} className="px-3 rounded-lg font-black" style={{background:YELLOW,color:TEXT}}><Plus size={16}/></button>
        </div>
        <div className="mt-4 space-y-2">
          {lines.map((l,i)=><div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{background:SURFACE2}}><span>{l.product_name} × {l.qty}</span><span>{(l.qty*l.unit_cost).toFixed(2)}</span></div>)}
          {!lines.length&&<div className="text-xs" style={{color:MUTED}}>No lines added.</div>}
        </div>
        <div className="mt-4 pt-3 flex justify-between font-black text-sm" style={{borderTop:`1px solid ${BORDER}`}}><span>Total</span><span>{total.toFixed(2)}</span></div>
        {error&&<div className="mt-3 text-xs font-semibold text-red-600">{error}</div>}
        <button onClick={createOrder} className="w-full mt-4 py-3 rounded-xl font-black text-sm" style={{background:TEXT,color:'white'}}>Create Purchase Order</button>
      </section>
      <section className="xl:col-span-2 rounded-2xl overflow-hidden" style={{background:SURFACE,border:`1px solid ${BORDER}`}}>
        <div className="px-4 py-3 flex items-center justify-between" style={{borderBottom:`1px solid ${BORDER}`}}><div><h2 className="text-sm font-black uppercase tracking-widest">Purchase Orders</h2><p className="text-xs mt-1" style={{color:MUTED}}>Ordered items remain out of stock until receiving.</p></div><Truck size={18}/></div>
        {loading?<div className="p-6 text-center text-sm" style={{color:MUTED}}>Loading…</div>:orders.length===0?<div className="p-6 text-center text-sm" style={{color:MUTED}}>No purchase orders yet.</div>:orders.map(o=><div key={o.id} className="p-4 flex items-center gap-3" style={{borderBottom:`1px solid ${BORDER}`}}>
          <div className="flex-1 min-w-0"><div className="text-sm font-bold">{o.supplier?.name||'Supplier'} · {o.invoice_no||'No reference'}</div><div className="text-xs mt-1" style={{color:MUTED}}>{o.purchase_date} · {o.status} · {Number(o.total||0).toFixed(2)}</div></div>
          {o.status!=='received'&&o.status!=='cancelled'?<button onClick={()=>receive(o.id)} className="px-3 py-2 rounded-lg text-xs font-black flex items-center gap-1" style={{background:YELLOW,color:TEXT}}><CheckCircle2 size={14}/> Receive</button>:<span className="text-xs font-bold" style={{color:MUTED}}>{o.status}</span>}
        </div>)}
      </section>
    </div>
  </div>;
}
