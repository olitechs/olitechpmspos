import React,{useEffect,useMemo,useState}from'react';
import{ArrowLeft,Plus,Printer,Receipt,RotateCcw,WalletCards}from'lucide-react';
import{toast}from'sonner';
import{VAT_RATE,tableLabel}from'@/data/mockData';
import{useStore}from'@/data/AppStore';
import{useAuth}from'@/lib/AuthContext';
import{pmsService}from'@/services/pmsService';
import{getSessionStaff}from'@/services/authService';
import{inventoryService}from'@/services/inventoryService';
import{printReceipt}from'@/services/printService';

const PAYMENT_METHODS=[{id:'cash',label:'Cash'},{id:'card',label:'Card'},{id:'mpesa',label:'M-Pesa'},{id:'room',label:'Room Charge'}];
const fmt=n=>'KES '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function BillPayment({table,orderLines,onConfirmPayment,onAddOrder,onBackToFloor,orderNumber,waiter,covers}){
 const store=useStore();const{user}=useAuth();const propertyId=user?.property?.id;const sessionStaff=getSessionStaff();
 const role=String(sessionStaff?.role||user?.staff?.role||user?.propertyRole||'').toLowerCase().replace(/\s+/g,'_');
 const canRoomCharge=user?.isPlatformOwner||['hotel_admin','super_admin','cashier','front_office_manager','owner','admin','manager'].includes(role);
 const [paymentMethod,setPaymentMethod]=useState('cash');const[discountPct,setDiscountPct]=useState('');const[chargeReservationId,setChargeReservationId]=useState('');const[activeStays,setActiveStays]=useState([]);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 const [billPrinted,setBillPrinted]=useState(false);
 const subtotal=useMemo(()=>orderLines.reduce((s,l)=>s+Number(l.price||0)*Number(l.qty||0),0),[orderLines]);
 const discount=discountPct?Math.round(subtotal*(Number(discountPct)/100)):0;const discounted=subtotal-discount;const vat=Math.round(discounted*VAT_RATE);const total=discounted+vat;
 const stableOrderNumber=orderNumber||'ORD-'+String(table.number).padStart(3,'0');
 const room=activeStays.find(x=>x.id===chargeReservationId);
 useEffect(()=>{if(paymentMethod!=='room'||!propertyId)return;pmsService.listActiveStays(propertyId).then(setActiveStays).catch(e=>setError(e.message));},[paymentMethod,propertyId]);
 useEffect(()=>{if(!canRoomCharge&&paymentMethod==='room')setPaymentMethod('cash')},[canRoomCharge,paymentMethod]);

 async function handlePrintBill(){
  setBusy(true);setError('');
  try{
   const result=await printReceipt('UNSETTLED',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers:covers ?? table.seats,items:orderLines,total,currency:'KES'});
   if(!result.ok){setError(result.friendlyError||'Bill printer failed.');toast.error('Bill was not printed.');return}
   store.setUnsettled(table.id);setBillPrinted(true);toast.success('Unsettled bill printed. The table remains open.');
  }catch(e){setError(e?.message||'Bill printer failed.');toast.error('Bill was not printed.');}
  finally{setBusy(false)}
 }
 const confirmPayment=async()=>{
  if(!propertyId){setError('This table is not attached to a property.');return}
  if(!orderLines.length){setError('There are no items on this bill.');return}
  if(paymentMethod==='room'&&!chargeReservationId){setError('Select the guest/room to charge.');return}
  setBusy(true);setError('');
  try{
   await pmsService.recordPosSale({propertyId,tableNumber:tableLabel(table),orderNumber:stableOrderNumber,items:orderLines.map(x=>({name:x.name,qty:x.qty,price:x.price})),subtotal,discountAmount:discount,vat,total,paymentMethod,reservationId:paymentMethod==='room'?chargeReservationId:null});
   const methodLabel=PAYMENT_METHODS.find(x=>x.id===paymentMethod)?.label||paymentMethod;
   await store.completeSale({table,orderLines,total,method:methodLabel,receiptText:'',skipPrint:true});
   const result=await printReceipt('RECEIPT',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers,items:orderLines,total,currency:'KES',paymentMethod:methodLabel,room:room?.room_number});
   if(propertyId){try{await inventoryService.deductStockForOrder({propertyId,orderItems:orderLines.map(x=>({productId:x.productId||x.id,qty:x.qty,name:x.name})),reference:'POS Sale - Table '+tableLabel(table)})}catch(e){console.warn('[inventory]',e)}}
   // Payment is already recorded in PMS at this point. A printer failure must
   // never leave the table occupied or prevent the next guest/waiter using it.
   onConfirmPayment();
   if(result.ok){
    toast.success(`Payment completed and receipt printed via ${methodLabel}.`);
   }else{
    toast.warning('Payment completed, but the receipt did not print. Reprint it later from Receipts.');
   }
  }catch(e){setError('Payment was not recorded: '+e.message);toast.error('Payment was not recorded.');}
  finally{setBusy(false)}
 };
 const reprintBill=async()=>{
  setBusy(true);const result=await printReceipt('UNSETTLED',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers,items:orderLines,total,currency:'KES'});setBusy(false);
  if(result.ok){setBillPrinted(true);toast.success('Bill reprinted.')}else setError(result.friendlyError||'Bill printer failed.');
 };
 return <div className="h-full overflow-auto bg-[#F7F7F5] p-4 md:p-6">
  <div className="mx-auto max-w-6xl">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div><button onClick={onBackToFloor} className="mb-2 inline-flex items-center gap-2 text-xs font-bold text-[#5F6368] hover:text-[#090C11]"><ArrowLeft size={15}/>Back to floor</button><h2 className="text-2xl font-black text-[#090C11]">Table {tableLabel(table)} · Bill</h2><p className="text-sm text-[#6B7280]">{stableOrderNumber} · Waiter: {waiter||'Unassigned'}</p></div>
    <div className="flex gap-2"><button onClick={onAddOrder} className="inline-flex items-center gap-2 rounded-xl bg-[#FFD300] px-4 py-2.5 text-sm font-black text-[#090C11]"><Plus size={17}/>Add Order</button>{billPrinted&&<button onClick={reprintBill} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border-2 border-[#090C11] bg-white px-4 py-2.5 text-sm font-black text-[#090C11]"><RotateCcw size={16}/>Reprint Bill</button>}</div>
   </div>
   {error&&<div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
   <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
    <section className="rounded-2xl border border-[#E1E1DE] bg-white shadow-sm">
     <div className="flex items-center justify-between border-b border-[#EAEAE7] p-5"><div><h3 className="font-black">Full bill</h3><p className="text-xs text-[#777]">All items remain attached to this table until final settlement.</p></div>{billPrinted&&<span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase text-amber-800">Unsettled bill printed</span>}</div>
     <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[#F7F7F5] text-left text-xs uppercase text-[#777]"><tr><th className="p-4">Item</th><th className="p-4">Qty</th><th className="p-4 text-right">Price</th><th className="p-4 text-right">Amount</th></tr></thead><tbody>{orderLines.map((x,i)=><tr key={x.id||x.productId||i} className="border-t border-[#F0F0ED]"><td className="p-4 font-bold">{x.name}</td><td className="p-4">{x.qty}</td><td className="p-4 text-right">{fmt(x.price)}</td><td className="p-4 text-right font-bold">{fmt(Number(x.price)*Number(x.qty))}</td></tr>)}</tbody></table></div>
     <div className="border-t border-[#EAEAE7] p-5"><button onClick={onAddOrder} className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-[#CFCFCB] px-4 py-3 text-sm font-black text-[#333]"><Plus size={16}/>Add more items to this table</button></div>
    </section>
    <aside className="space-y-4">
     <section className="rounded-2xl border border-[#E1E1DE] bg-white p-5 shadow-sm"><h3 className="mb-4 flex items-center gap-2 font-black"><Receipt size={18}/>Bill total</h3><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{fmt(subtotal)}</b></div>{discount>0&&<div className="flex justify-between text-green-700"><span>Discount</span><b>-{fmt(discount)}</b></div>}<div className="flex justify-between"><span>VAT 16%</span><b>{fmt(vat)}</b></div><div className="mt-3 flex justify-between border-t-2 border-[#090C11] pt-3 text-lg font-black"><span>TOTAL</span><span>{fmt(total)}</span></div></div><div className="mt-4"><label className="mb-1 block text-xs font-black uppercase text-[#777]">Discount %</label><input value={discountPct} onChange={e=>setDiscountPct(e.target.value)} type="number" min="0" max="100" className="w-full rounded-xl border border-[#D9D9D5] p-3"/></div></section>
     <section className="rounded-2xl border border-[#E1E1DE] bg-white p-5 shadow-sm"><h3 className="mb-3 flex items-center gap-2 font-black"><WalletCards size={18}/>Payment method</h3><div className="grid grid-cols-2 gap-2">{PAYMENT_METHODS.map(m=><button key={m.id} disabled={m.id==='room'&&!canRoomCharge} onClick={()=>setPaymentMethod(m.id)} className={`rounded-xl border-2 p-3 text-sm font-black ${paymentMethod===m.id?'border-[#FFD300] bg-[#FFF8CC]':'border-[#E1E1DE] bg-white'}`}>{m.label}</button>)}</div>{paymentMethod==='room'&&<div className="mt-3"><label className="mb-1 block text-xs font-black uppercase text-[#777]">Guest / room</label><select value={chargeReservationId} onChange={e=>setChargeReservationId(e.target.value)} className="w-full rounded-xl border border-[#D9D9D5] bg-white p-3 text-sm"><option value="">Select checked-in guest</option>{activeStays.map(s=><option key={s.id} value={s.id}>Room {s.room_number||'—'} · {s.guest_name||'Guest'}</option>)}</select></div>}</section>
     <button onClick={handlePrintBill} disabled={busy||!orderLines.length} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#090C11] bg-white p-3.5 text-sm font-black"><Printer size={17}/>{busy?'Working…':'Print Unsettled Bill'}</button>
     <button onClick={confirmPayment} disabled={busy||!orderLines.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#090C11] p-4 text-sm font-black text-[#FFD300]"><Receipt size={18}/>{busy?'Processing…':'Finalize & Print Receipt'}</button>
     <p className="text-center text-[11px] leading-5 text-[#777]">Printing an unsettled bill never closes the table. Staff can reopen the same table, view the complete bill, add orders, reprint the bill, or finalize payment later.</p>
    </aside>
   </div>
  </div>
 </div>;
}