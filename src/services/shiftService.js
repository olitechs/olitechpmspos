import { supabase } from '@/lib/supabaseClient';
import * as XLSX from 'xlsx';
import { buildShiftSalesSummary, normalizeShiftPaymentMethod } from '@/services/shiftReportCore';

export const shiftService = {
  async getCurrentShift(propertyId) {
    const { data, error } = await supabase.rpc('fn_current_pos_shift', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    return data || null;
  },

  async openShift({ propertyId, openingCash = 0, notes = '' }) {
    const { data, error } = await supabase.rpc('fn_open_pos_shift', {
      p_property_id: propertyId,
      p_opening_cash: Number(openingCash || 0),
      p_notes: notes || null,
    });
    if (error) throw new Error(error.message);
    if (data?.id) localStorage.setItem(`olitech_pos_shift_${propertyId}`, data.id);
    return data;
  },

  async closeShift({ shiftId, countedCash, notes = '', managerApproved = false }) {
    const { data, error } = await supabase.rpc('fn_close_pos_shift', {
      p_shift_id: shiftId,
      p_counted_cash: Number(countedCash || 0),
      p_notes: notes || null,
      p_manager_approved: Boolean(managerApproved),
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async getOpenTables(propertyId) {
    const { data, error } = await supabase
      .from('pos_table_sessions')
      .select('id,table_key,table_number,status,order_number')
      .eq('property_id', propertyId)
      .neq('status', 'closed')
      .order('table_number', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getShiftReport(shiftId) {
    const { data: shift, error } = await supabase.from('pos_shifts').select('*').eq('id', shiftId).single();
    if (error) throw new Error(error.message);

    // New receipts use pos_shift_id; shift_id is included for older rows.
    const { data: rows, error: rowsError } = await supabase
      .from('pos_receipts')
      .select('*')
      .eq('property_id', shift.property_id)
      .or(`pos_shift_id.eq.${shiftId},shift_id.eq.${shiftId}`)
      .eq('status', 'posted')
      .order('created_at', { ascending: true });
    if (rowsError) throw new Error(rowsError.message);

    const splitIds = (rows || []).filter((receipt) => receipt.payment_method === 'split').map((receipt) => receipt.id);
    let allocations = [];
    if (splitIds.length) {
      const { data, error: allocationError } = await supabase
        .from('pos_receipt_payments')
        .select('receipt_id,payment_method,amount')
        .eq('property_id', shift.property_id)
        .in('receipt_id', splitIds);
      if (allocationError) throw new Error(allocationError.message);
      allocations = data || [];
    }

    const summary = buildShiftSalesSummary(rows || [], allocations);
    const countedCash = shift.counted_cash == null ? null : Number(shift.counted_cash);
    const variance = shift.cash_variance == null ? null : Number(shift.cash_variance);
    return {
      shift,
      orders: rows || [],
      ...summary,
      expectedCash: Number(shift.opening_cash || 0) + Number(summary.payments.cash.amount || 0),
      countedCash,
      variance,
    };
  },

  async listShifts(propertyId, date = null) {
    let query = supabase.from('pos_shifts').select('*').eq('property_id', propertyId).order('opened_at', { ascending: false });
    if (date) query = query.eq('date', date);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  async printData(shiftId) {
    return this.getShiftReport(shiftId);
  },
};

export function exportShiftToExcel(report) {
  const shift = report.shift;
  const money = (value) => Number(value || 0);
  const workbook = XLSX.utils.book_new();
  const summary = [
    ['Metric', 'Amount', 'Count'],
    ['Opening Cash', money(shift.opening_cash), 1],
    ['Cash', money(report.payments.cash.amount), report.payments.cash.count],
    ['M-Pesa', money(report.payments.mpesa.amount), report.payments.mpesa.count],
    ['Card', money(report.payments.card.amount), report.payments.card.count],
    ['Bank', money(report.payments.bank.amount), report.payments.bank.count],
    ['Room Charge', money(report.payments.room_charge.amount), report.payments.room_charge.count],
    ['Other', money(report.payments.other.amount), report.payments.other.count],
    ['Total Sales', money(report.totalSales), report.totalTransactions],
    ['Guest Covers', money(report.totalCovers), ''],
    ['Items Sold', money(report.itemsSold), ''],
    ['Expected Cash', money(report.expectedCash), ''],
    ['Counted Cash', report.countedCash == null ? '' : money(report.countedCash), ''],
    ['Variance', report.variance == null ? '' : money(report.variance), ''],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const detailed = [['Receipt No', 'Table', 'Waiter', 'Time', 'Items', 'Payment Method', 'Amount', 'Guest', 'Covers']];
  report.orders.forEach((receipt) => detailed.push([
    receipt.order_number || '',
    receipt.table_number || '',
    receipt.waiter || '',
    new Date(receipt.created_at).toLocaleString('en-KE'),
    (Array.isArray(receipt.items) ? receipt.items : []).map((item) => `${item.name || ''} x${item.qty || item.quantity || 1}`).join(', '),
    normalizeShiftPaymentMethod(receipt.payment_method),
    money(receipt.total),
    receipt.guest_name || '',
    Number(receipt.covers || 1),
  ]));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(detailed), 'Detailed Receipts');

  const sales = report.totalSales || 0;
  const breakdown = [['Payment Method', 'Receipt Count', 'Total Amount', '% of Sales']];
  Object.entries(report.payments).forEach(([method, values]) => breakdown.push([
    method, values.count, money(values.amount), sales ? money(values.amount) / sales : 0,
  ]));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(breakdown), 'Payment Breakdown');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Category', 'Qty Sold', 'Amount'],
    ['Food', report.categories.food.qty, report.categories.food.amount],
    ['Drinks', report.categories.drinks.qty, report.categories.drinks.amount],
    ['All Items', report.itemsSold, sales],
  ]), 'Items Sold');

  const dateLabel = new Date(shift.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '');
  XLSX.writeFile(workbook, `Shift-Report-${shift.shift_no}-${dateLabel}.xlsx`);
}
