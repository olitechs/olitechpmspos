import React,{useEffect,useMemo,useState}from'react';
import{ArrowLeft,Plus,Printer,Receipt,RotateCcw,WalletCards,ArrowRightLeft}from'lucide-react';
import{toast}from'sonner';
import{tableLabel}from'@/data/mockData';
import{useStore}from'@/data/AppStore';
import{useAuth}from'@/lib/AuthContext';
import{pmsService}from'@/services/pmsService';
import{getSessionStaff}from'@/services/authService';
import{printReceipt,getPrinters,getAssignments,openCashDrawer}from'@/services/printService';
import{shiftService}from'@/services/shiftService';\nimport{getUnsettledReceiptSettings}from'@/services/settingsService';
import{posService}from'@/services/posService';
import{posPhase3Service}from'@/services/posPhase3Service';

const PAYMENT_METHODS=[{id:'cash',label:'Cash'},{id:'card',label:'Card'},{id:'mpesa',label:'M-Pesa'},{id:'bank',label:'Bank Transfer'},{id:'room',label:'Room Charge'},{id:'split',label:'Split Payment'}];
const fmt=n=>'KES '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function BillPayment({table,orderLines,onConfirmPayment,onAddOrder,onBackToFloor,onMoveTable,orderNumber,waiter,covers}){
 const store=useStore();const{user}=useAuth();const propertyId=user?.property?.id;const sessionStaff=getSessionStaff();
 const role=String(sessionStaff?.role||user?.staff?.role||user?.propertyRole||'').toLowerCase().replace(/\s+/g,'_');
 const canRoomCharge=user?.isPlatformOwner||['hotel_admin','super_admin','cashier','front_office_manager','owner','admin','manager'].includes(role);
 const [paymentMethod,setPaymentMethod]=useState('cash');const [splitPayments,setSplitPayments]=useState([{method:'cash',amount:''},{method:'mpesa',amount:''}]);const[discountId,setDiscountId]=useState('');const[discounts,setDiscounts]=useState([]);const[chargeReservationId,setChargeReservationId]=useState('');const[activeStays,setActiveStays]=useState([]);const[stayQuery,setStayQuery]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 const [billPrinted,setBillPrinted]=useState(false);const [saleIdempotencyKey,setSaleIdempotencyKey]=useState(()=>crypto.randomUUID());const [vatSettings,setVatSettings]=useState({unsettled_receipt_show_vat:false,unsettled_receipt_vat_rate:16,unsettled_receipt_vat_mode:'exclusive'});const [vatSettingsLoaded,setVatSettingsLoaded]=useState(false);
 useEffect(()=>{if(!propertyId)return;posPhase3Service.listActiveDiscounts(propertyId).then(setDiscounts).catch(()=>setDiscounts([]));},[propertyId]);
 useEffect(()=>{if(!propertyId||!table?.id)return;let active=true;(async()=>{try{const value=await getUnsettledReceiptSettings(propertyId);const saved=await posService.getVatSnapshot({propertyId,tableKey:table.id});if(!active)return;if(saved){setVatSettings({...value,unsettled_receipt_show_vat:saved.enabled===true,unsettled_receipt_vat_rate:Number(saved.rate??value.unsettled_receipt_vat_rate),unsettled_receipt_vat_mode:saved.mode==='inclusive'?'inclusive':'exclusive'})}else setVatSettings(value)}catch(e){if(active)setError(e.message||'Could not load property VAT settings.')}finally{if(active)setVatSettingsLoaded(true)}})();return()=>{active=false}},[propertyId,table?.id]);
 const subtotal=useMemo(()=>orderLines.reduce((s,l)=>s+Number(l.price||0)*Number(l.qty||0),0),[orderLines]);
 const selectedDiscount=discounts.find(d=>d.id===discountId);const splitTotal=splitPayments.reduce((s,p)=>s+Number(p.amount||0),0);const discount=posPhase3Service.calculateDiscount(selectedDiscount,subtotal);const discounted=Math.max(0,subtotal-discount);const vatRate=Math.max(0,Math.min(100,Number(vatSettings.unsettled_receipt_vat_rate??16)));const vatEnabled=vatSettings.unsettled_receipt_show_vat===true;const vatMode=vatSettings.unsettled_receipt_vat_mode==='inclusive'?'inclusive':'exclusive';const vat=vatEnabled?Math.round((vatMode==='inclusive'?discounted*vatRate/(100+vatRate):discounted*vatRate/100)*100)/100:0;const total=vatEnabled&&vatMode==='exclusive'?Math.round((discounted+vat)*100)/100:Math.round(discounted*100)/100;const vatSnapshot={enabled:vatEnabled,rate:vatRate,mode:vatMode,subtotal:Math.round(subtotal*100)/100,discount:Math.round(discount*100)/100,taxableSubtotal:Math.round(discounted*100)/100,vat,total,currency:'KES'};
 const stableOrderNumber=orderNumber||'ORD-'+String(table.number).padStart(3,'0');
 const room=activeStays.find(x=>x.id===chargeReservationId);const filteredStays=activeStays.filter(s=>[s.room_number,s.guest_name,s.id].some(v=>String(v||'').toLowerCase().includes(stayQuery.trim().toLowerCase())));
 useEffect(()=>{if(!['room','split'].includes(paymentMethod)||!propertyId)return;pmsService.listActiveStays(propertyId).then(setActiveStays).catch(e=>setError(e.message));},[paymentMethod,propertyId]);
 useEffect(()=>{if(!canRoomCharge&&paymentMethod==='room')setPaymentMethod('cash')},[canRoomCharge,paymentMethod]);

 async function handlePrintBill(){
  setBusy(true);setError('');
  try{
   await posService.saveVatSnapshot({propertyId,tableKey:table.id,snapshot:vatSnapshot});
   const result=await printReceipt('UNSETTLED',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers:covers ?? table.seats,diningOption:table?.diningOption||table?.dining_option||table?.orderType||'Dine In',items:orderLines,subtotal,discount,vat,total,vatSnapshot,currency:'KES'});
   if(!result.ok){setError(result.friendlyError||'Bill printer failed.');toast.error('Bill was not printed.');return}
   store.setUnsettled(table.id);setBillPrinted(true);toast.success('Unsettled bill printed. The table remains open.');
  }catch(e){setError(e?.message||'Bill printer failed.');toast.error('Bill was not printed.');}
  finally{setBusy(false)}
 }
 const confirmPayment=async()=>{
  if(!propertyId){setError('This table is not attached to a property.');return}
  if(!orderLines.length){setError('There are no items on this bill.');return}
  if(paymentMethod==='room'&&!chargeReservationId){setError('Select the guest/room to charge.');return}if(paymentMethod==='room'&&room&&!window.confirm('Confirm room charge?\nGuest: '+(room.guest_name||'Guest')+'\nRoom: '+(room.room_number||'—')+'\nReservation: '+room.id+'\nAmount: '+fmt(total)))return;if(paymentMethod==='split'&&(Math.round(splitTotal*100)!==Math.round(total*100)||splitPayments.some(p=>p.method==='room'&&Number(p.amount)>0&&!p.reservationId))){setError(splitPayments.some(p=>p.method==='room'&&Number(p.amount)>0&&!p.reservationId)?'Select a checked-in guest for every room-charge portion.':`Split payments must equal ${fmt(total)}.`);return}
  setBusy(true);setError('');
  try{
   const currentShift=await shiftService.getCurrentShift(propertyId);
   if(!currentShift?.id){setError('No open POS shift. Open a shift before taking payments.');return;}
   await pmsService.recordPosSale({propertyId,tableNumber:tableLabel(table),orderNumber:stableOrderNumber,items:orderLines.map(x=>({product_id:x.productId || x.product_id || null,name:x.name,qty:x.qty,price:x.price,base_price:x.basePrice ?? x.price,modifier_total:x.modifierTotal || 0,modifiers:x.modifiers || [],category:x.category,center:x.center})),subtotal,discountAmount:discount,discountId:selectedDiscount?.id || null,discountName:selectedDiscount?.name || null,vat,total,paymentMethod,reservationId:paymentMethod==='room'?chargeReservationId:null,shiftId:currentShift.id,waiter,idempotencyKey:saleIdempotencyKey,vatSnapshot,paymentAllocations:paymentMethod==='split'?splitPayments.filter(p=>Number(p.amount)>0).map(p=>({method:p.method,amount:Number(p.amount),reservation_id:p.method==='room'?p.reservationId||null:null})):null});
   const methodLabel=paymentMethod==='split'?'Split Payment':PAYMENT_METHODS.find(x=>x.id===paymentMethod)?.label||paymentMethod;
   await store.completeSale({table,orderLines,total,method:methodLabel,receiptText:'',skipPrint:true});
   const voidRows=propertyId?await pmsService.listVoidedItems(propertyId).catch(()=>[]):[];
   const tableVoids=voidRows.filter(v=>String(v.table_number||'')===String(tableLabel(table)) && String(v.order_number||'')===String(stableOrderNumber));
   const result=await printReceipt('RECEIPT',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers,items:orderLines,total,currency:'KES',paymentMethod:methodLabel,room:room?.room_number,voidedCount:tableVoids.length,voidSlipNumber:tableVoids[0]?.void_number||null});
   // Payment is already recorded in PMS at this point. A printer failure must
   // never leave the table occupied or prevent the next guest/waiter using it.
   onConfirmPayment();
   // Drawer opening is a post-payment convenience only. It must never roll
   // back a recorded sale or prevent the table from being released.
   const cashWasTaken = paymentMethod === 'cash' ||
    (paymentMethod === 'split' && splitPayments.some(p => p.method === 'cash' && Number(p.amount) > 0));
   if (cashWasTaken) {
    try {
     const [configuredPrinters, printerAssignments] = await Promise.all([getPrinters(propertyId), getAssignments(propertyId)]);
     const receiptPrinterIds = new Set(printerAssignments.filter(a => a.assignment_type === 'final_receipts').map(a => a.printer_id));
     const drawerPrinter = configuredPrinters.find(p => receiptPrinterIds.has(p.id) && p.open_drawer_after_sale === true && p.connection_type === 'network_ip');
     if (drawerPrinter) {
      const drawerResult = await openCashDrawer(drawerPrinter, propertyId);
      if (!drawerResult.ok) toast.warning('Payment completed, but the cash drawer did not open. Check the drawer cable and printer connection.');
     }
    } catch (drawerError) {
     console.warn('[BillPayment] cash drawer pulse failed after completed sale', drawerError);
     toast.warning('Payment completed, but automatic cash drawer opening could not be verified.');
    }
   }
   if(result.ok){
    toast.success(`Payment completed and receipt printed via ${methodLabel}.`);
   }else{
    toast.warning('Payment completed, but the receipt did not print. Reprint it later from Receipts.');
   }
   setSaleIdempotencyKey(crypto.randomUUID());
  }catch(e){setError('Payment was not recorded: '+e.message);toast.error('Payment was not recorded.');}
  finally{setBusy(false)}
 };
 const reprintBill=async()=>{
  setBusy(true);await posService.saveVatSnapshot({propertyId,tableKey:table.id,snapshot:vatSnapshot});const result=await printReceipt('UNSETTLED',{propertyId,orderNumber:stableOrderNumber,checkNo:stableOrderNumber,table:tableLabel(table),waiter,covers,items:orderLines,subtotal,discount,vat,total,vatSnapshot,currency:'KES'});setBusy(false);
  if(result.ok){setBillPrinted(true);toast.success('Bill reprinted.')}else setError(result.friendlyError||'Bill printer failed.');
 };
 return <div className="h-full overflow-auto bg-[var(--canvas)] p-4 md:p-6">
  <div className="mx-auto max-w-6xl">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div><button onClick={onBackToFloor} className="mb-2 inline-flex items-center gap-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)]"><ArrowLeft size={15}/>Back to floor</button><h2 className="text-2xl font-black text-[var(--text)]">Table {tableLabel(table)} · Bill</h2><p className="text-sm text-[var(--text-muted)]">{stableOrderNumber} · Waiter: {waiter||'Unassigned'}</p></div>
    <div className="flex flex-wrap justify-end gap-2"><button onClick={onAddOrder} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--primary)]"><Plus size={17}/>Add Order</button><button onClick={onMoveTable} disabled={!onMoveTable} className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-black text-[var(--primary)]"><ArrowRightLeft size={16}/>Move / Join</button>{billPrinted&&<button onClick={reprintBill} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-black text-[var(--text)]"><RotateCcw size={16}/>Reprint Bill</button>}</div>
   </div>
   {error&&<div className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm font-semibold text-[var(--danger-text)]">{error}</div>}
   <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-none">
     <div className="flex items-center justify-between border-b border-[var(--border)] p-5"><div><h3 className="font-black">Full bill</h3><p className="text-xs text-[var(--text-muted)]">All items remain attached to this table until final settlement.</p></div>{billPrinted&&<span className="rounded-full bg-[var(--warning-soft)] px-3 py-1 text-[10px] font-black uppercase text-[var(--warning-text)]">Unsettled bill printed</span>}</div>
     <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--canvas)] text-left text-xs uppercase text-[var(--text-muted)]"><tr><th className="p-4">Item</th><th className="p-4">Qty</th><th className="p-4 text-right">Price</th><th className="p-4 text-right">Amount</th></tr></thead><tbody>{orderLines.map((x,i)=><tr key={x.id||x.productId||i} className="border-t border-[var(--canvas)]"><td className="p-4 font-bold">{x.name}{x.modifiers?.length>0&&<div className="mt-1 text-[11px] font-normal text-[var(--text-muted)]">{x.modifiers.map(m=>m.name).join(' · ')}</div>}</td><td className="p-4">{x.qty}</td><td className="p-4 text-right">{fmt(x.price)}</td><td className="p-4 text-right font-bold">{fmt(Number(x.price)*Number(x.qty))}</td></tr>)}</tbody></table></div>
     <div className="border-t border-[var(--border)] p-5"><button onClick={onAddOrder} className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-3 text-sm font-black text-[var(--text)]"><Plus size={16}/>Add more items to this table</button></div>
    </section>
    <aside className="space-y-4">
     <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-none"><h3 className="mb-4 flex items-center gap-2 font-black"><Receipt size={18}/>Bill total</h3><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{fmt(subtotal)}</b></div>{discount>0&&<div className="flex justify-between text-[var(--success-text)]"><span>Discount</span><b>-{fmt(discount)}</b></div>}<div className="flex justify-between"><span>{vatEnabled?`VAT ${vatRate}% (${vatMode})`:'VAT disabled'}</span><b>{fmt(vat)}</b></div><div className="mt-3 flex justify-between border-t-2 border-[var(--border)] pt-3 text-lg font-black"><span>TOTAL</span><span>{fmt(total)}</span></div></div><div className="mt-4"><label className="mb-1 block text-xs font-black uppercase text-[var(--text-muted)]">Configured discount</label><select value={discountId} onChange={e=>setDiscountId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><option value="">No discount</option>{discounts.map(d=><option key={d.id} value={d.id}>{d.name}{d.code?' · '+d.code:''} · {d.discount_type==='percentage'?(Number(d.percentage_basis_points||0)/100)+'%':'KES '+(Number(d.amount_minor||0)/100).toLocaleString('en-KE')}</option>)}</select></div></section>
     <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-none"><h3 className="mb-3 flex items-center gap-2 font-black"><WalletCards size={18}/>Payment method</h3><div className="grid grid-cols-2 gap-2">{PAYMENT_METHODS.map(m=><button key={m.id} disabled={m.id==='room'&&!canRoomCharge} onClick={()=>setPaymentMethod(m.id)} className={`rounded-xl border-2 p-3 text-sm font-black ${paymentMethod===m.id?'border-[var(--primary)] bg-[var(--primary-soft)]':'border-[var(--border)] bg-[var(--surface)]'}`}>{m.label}</button>)}</div>{paymentMethod==='split'&&<div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--canvas)] p-3"><div className="flex items-center justify-between"><span className="text-xs font-black uppercase text-[var(--text-muted)]">Payment allocation</span><b className={Math.round(splitTotal*100)===Math.round(total*100)?'text-[var(--success-text)]':'text-[var(--danger-text)]'}>{fmt(splitTotal)} / {fmt(total)}</b></div>{splitPayments.map((p,i)=><React.Fragment key={i}><div className="grid grid-cols-[1fr_110px_32px] gap-2"><select value={p.method} onChange={e=>setSplitPayments(prev=>prev.map((x,j)=>j===i?{...x,method:e.target.value,reservationId:e.target.value==='room'?(x.reservationId||chargeReservationId):null}:x))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-bold">{PAYMENT_METHODS.filter(m=>m.id!=='split').map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select><input inputMode="decimal" value={p.amount} onChange={e=>setSplitPayments(prev=>prev.map((x,j)=>j===i?{...x,amount:e.target.value}:x))} placeholder="Amount" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-bold"/><button type="button" disabled={splitPayments.length<=2} onClick={()=>setSplitPayments(prev=>prev.filter((_,j)=>j!==i))} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-black disabled:opacity-30">×</button></div>{p.method==='room'&&<select value={p.reservationId||''} onChange={e=>setSplitPayments(prev=>prev.map((x,j)=>j===i?{...x,reservationId:e.target.value}:x))} className="col-span-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-bold"><option value="">Select checked-in guest for room portion</option>{filteredStays.map(s=><option key={s.id} value={s.id}>Room {s.room_number||'—'} · {s.guest_name||'Guest'} · Ref {s.id.slice(0,8)}</option>)}</select>}</React.Fragment>)}<button type="button" onClick={()=>setSplitPayments(prev=>[...prev,{method:'cash',amount:''}])} className="w-full rounded-lg border border-dashed border-[var(--border)] p-2 text-xs font-black">+ Add payment</button></div>}{paymentMethod==='room'&&<div className="mt-3"><label className="mb-1 block text-xs font-black uppercase text-[var(--text-muted)]">Search guest, room or reservation</label><input value={stayQuery} onChange={e=>setStayQuery(e.target.value)} placeholder="Room number, guest name or reservation ID" className="mb-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"/><label className="mb-1 block text-xs font-black uppercase text-[var(--text-muted)]">Confirm guest / room</label><select value={chargeReservationId} onChange={e=>setChargeReservationId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"><option value="">Select checked-in guest</option>{filteredStays.map(s=><option key={s.id} value={s.id}>Room {s.room_number||'—'} · {s.guest_name||'Guest'} · Ref {s.id.slice(0,8)}</option>)}</select></div>}</section>
     <button onClick={handlePrintBill} disabled={busy||!vatSettingsLoaded||!orderLines.length} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm font-black"><Printer size={17}/>{busy?'Working…':'Print Unsettled Bill'}</button>
     <button onClick={confirmPayment} disabled={busy||!vatSettingsLoaded||!orderLines.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] p-4 text-sm font-medium text-primary-foreground"><Receipt size={18}/>{busy?'Processing…':'Finalize & Print Receipt'}</button>
     <p className="text-center text-[11px] leading-5 text-[var(--text-muted)]">Printing an unsettled bill never closes the table. Staff can reopen the same table, view the complete bill, add orders, reprint the bill, or finalize payment later.</p>
    </aside>
   </div>
  </div>
 </div>;
}