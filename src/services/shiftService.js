import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';

const KENYA_DATE = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'});
const today = () => KENYA_DATE.format(new Date());

const normalizeMethod = (m) => ({ room:'room_charge',room_charge:'room_charge',cash:'cash',mpesa:'mpesa',card:'card',bank:'bank',other:'other' }[String(m||'').toLowerCase()] || String(m||'other').toLowerCase());

export const shiftService = {
  async getCurrentShift(propertyId) {
    const { data, error } = await supabase.rpc('fn_current_pos_shift',{p_property_id:propertyId});
    if(error) throw new Error(error.message);
    return data || null;
  },
  async openShift({propertyId, openingCash=0, notes=''}) {
    const {data,error}=await supabase.rpc('fn_open_pos_shift',{p_property_id:propertyId,p_opening_cash:Number(openingCash||0),p_notes:notes||null});
    if(error) throw new Error(error.message);
    if(data?.id) localStorage.setItem(`olitech_pos_shift_${propertyId}`,data.id);
    return data;
  },
  async closeShift({shiftId,countedCash,notes=''}) {
    const {data,error}=await supabase.rpc('fn_close_pos_shift',{p_shift_id:shiftId,p_counted_cash:Number(countedCash||0),p_notes:notes||null});
    if(error) throw new Error(error.message);
    return data;
  },
  async getShiftReport(shiftId) {
    const {data:shift,error}=await supabase.from('pos_shifts').select('*').eq('id',shiftId).single();
    if(error) throw new Error(error.message);
    const {data:rows,error:rowsError}=await supabase.from('pos_receipts').select('*').eq('shift_id',shiftId).eq('status','posted').order('created_at');
    if(rowsError) throw new Error(rowsError.message);
    const payments={cash:{amount:0,count:0},mpesa:{amount:0,count:0},card:{amount:0,count:0},bank:{amount:0,count:0},room_charge:{amount:0,count:0},other:{amount:0,count:0}};
    const categories={food:{qty:0,amount:0},drinks:{qty:0,amount:0}};
    const orders=(rows||[]).map(r=>{
      const method=normalizeMethod(r.payment_method); const p=payments[method]||payments.other; p.amount+=Number(r.total||0);p.count+=1;
      (Array.isArray(r.items)?r.items:[]).forEach(i=>{const qty=Number(i.qty||i.quantity||1);const amount=Number(i.total||0)||Number(i.price||0)*qty;const cat=String(i.category||i.center||'').toLowerCase().includes('drink')||String(i.center||'').toLowerCase()==='bar'?'drinks':'food';categories[cat].qty+=qty;categories[cat].amount+=amount;});
      return r;
    });
    const total=Object.values(payments).reduce((s,p)=>s+p.amount,0);
    const cash=payments.cash.amount;
    return {shift,orders,payments,categories,totalSales:total,totalTransactions:orders.length,expectedCash:Number(shift.opening_cash||0)+cash,countedCash:null,variance:null};
  },
  async listShifts(propertyId,date=null) {
    let q=supabase.from('pos_shifts').select('*').eq('property_id',propertyId).order('opened_at',{ascending:false});
    if(date) q=q.eq('date',date);
    const {data,error}=await q;
    if(error) throw new Error(error.message);
    return data||[];
  },
  async printData(shiftId) { return this.getShiftReport(shiftId); },
};

export function exportShiftToExcel(report) {
  const shift=report.shift;
  const wb=XLSX.utils.book_new();
  const money=n=>Number(n||0);
  const summary=[
    ['Metric','Amount','Count'],
    ['Opening Cash',money(shift.opening_cash),1],
    ['Cash',money(report.payments.cash.amount),report.payments.cash.count],
    ['M-Pesa',money(report.payments.mpesa.amount),report.payments.mpesa.count],
    ['Card',money(report.payments.card.amount),report.payments.card.count],
    ['Bank',money(report.payments.bank.amount),report.payments.bank.count],
    ['Room Charge',money(report.payments.room_charge.amount),report.payments.room_charge.count],
    ['Other',money(report.payments.other.amount),report.payments.other.count],
    ['Total Sales',money(report.totalSales),report.totalTransactions],
    ['Expected Cash',money(report.expectedCash),''],
    ['Counted Cash',report.countedCash==null?'':money(report.countedCash),''],
    ['Variance',report.variance==null?'':money(report.variance),''],
  ];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Summary');
  const detailed=[['Bill No','Check No','Table','Waiter','Time','Items','Payment Method','Amount','Guest']];
  report.orders.forEach(r=>detailed.push([r.order_number||'',r.order_number||'',r.table_number||'',r.waiter||'',new Date(r.created_at).toLocaleString('en-KE'),(Array.isArray(r.items)?r.items:[]).map(i=>`${i.name||''} x${i.qty||i.quantity||1}`).join(', '),normalizeMethod(r.payment_method),money(r.total),r.guest_name||'']));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(detailed),'Detailed Orders');
  const sales=report.totalSales||0; const breakdown=[['Payment Method','Transaction Count','Total Amount','% of Sales']];
  Object.entries(report.payments).forEach(([k,v])=>breakdown.push([k,v.count,money(v.amount),sales?money(v.amount)/sales:0]));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(breakdown),'Payment Method Breakdown');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Category','Qty Sold','Amount'],['Food',report.categories.food.qty,report.categories.food.amount],['Drinks',report.categories.drinks.qty,report.categories.drinks.amount]]),'Category Breakdown');
  [summary,detailed,breakdown].forEach((rows)=>{});
  const dateLabel=new Date(shift.date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'');
  XLSX.writeFile(wb,`Shift-Report-${shift.shift_no}-${dateLabel}.xlsx`);
}
