import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { normalizePosPaymentMethod, summarizePosReceipts } from '@/lib/posFinancials';

const KENYA_DATE = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'});
const today = () => KENYA_DATE.format(new Date());


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
  async closeShift({shiftId,countedCash,notes='',managerApproved=false}) {
    const {data,error}=await supabase.rpc('fn_close_pos_shift',{p_shift_id:shiftId,p_counted_cash:Number(countedCash||0),p_notes:notes||null,p_manager_approved:Boolean(managerApproved)});
    if(error) throw new Error(error.message);
    return data;
  },
  async getShiftReport(shiftId) {
    const {data:shift,error}=await supabase.from('pos_shifts').select('*').eq('id',shiftId).single();
    if(error) throw new Error(error.message);
    const {data:rows,error:rowsError}=await supabase.from('pos_receipts').select('*').eq('pos_shift_id',shiftId).eq('status','posted').order('created_at');
    if(rowsError) throw new Error(rowsError.message);
    const receipts = rows || [];
    const splitReceiptIds = receipts.filter((receipt) => receipt.payment_method === 'split').map((receipt) => receipt.id);
    let splitPayments = [];
    if (splitReceiptIds.length) {
      const { data: allocations, error: allocationError } = await supabase
        .from('pos_receipt_payments')
        .select('receipt_id, payment_method, amount')
        .eq('property_id', shift.property_id)
        .in('receipt_id', splitReceiptIds);
      if (allocationError) throw new Error(allocationError.message);
      splitPayments = allocations || [];
    }
    const summary = summarizePosReceipts(receipts, shift.opening_cash || 0, splitPayments);
    return { shift, ...summary };
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
    ['Split Receipts',Number(report.reconciliation?.splitReceiptCount||0),''],
    ['Split Receipts Without Allocations',Number(report.reconciliation?.splitUnallocatedCount||0),''],
    ['Split Allocation Variance (receipt less allocated)',money(report.reconciliation?.splitAllocationVariance||0),Number(report.reconciliation?.splitAllocationVarianceCount||0)],
    ['Expected Cash',money(report.expectedCash),''],
    ['Counted Cash',report.countedCash==null?'':money(report.countedCash),''],
    ['Variance',report.variance==null?'':money(report.variance),''],
  ];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Summary');
  const detailed=[['Bill No','Check No','Table','Waiter','Time','Items','Payment Method','Amount','Guest']];
  report.orders.forEach(r=>detailed.push([r.order_number||'',r.order_number||'',r.table_number||'',r.waiter||'',new Date(r.created_at).toLocaleString('en-KE'),(Array.isArray(r.items)?r.items:[]).map(i=>`${i.name||''} x${i.qty||i.quantity||1}`).join(', '),normalizePosPaymentMethod(r.payment_method),money(r.total),r.guest_name||'']));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(detailed),'Detailed Orders');
  const sales=report.totalSales||0; const breakdown=[['Payment Method','Transaction Count','Total Amount','% of Sales']];
  Object.entries(report.payments).forEach(([k,v])=>breakdown.push([k,v.count,money(v.amount),sales?money(v.amount)/sales:0]));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(breakdown),'Payment Method Breakdown');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Category','Qty Sold','Amount'],['Food',report.categories.food.qty,report.categories.food.amount],['Drinks',report.categories.drinks.qty,report.categories.drinks.amount]]),'Category Breakdown');
  [summary,detailed,breakdown].forEach((rows)=>{});
  const dateLabel=new Date(shift.date+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'');
  XLSX.writeFile(wb,`Shift-Report-${shift.shift_no}-${dateLabel}.xlsx`);
}
