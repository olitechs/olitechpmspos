import { supabase } from '@/lib/supabaseClient';
import { buildShiftSalesSummary, normalizeShiftPaymentMethod } from '@/services/shiftReportCore';

export const shiftService = {
  async getCurrentShift(propertyId) {
    const { data, error } = await supabase.rpc('fn_current_pos_shift', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    return data || null;
  },

  async openShift({ propertyId, openingCash, notes = '' }) {
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('A starting cash float greater than zero is required to open a shift.');
    }
    const { data, error } = await supabase.rpc('fn_open_pos_shift', {
      p_property_id: propertyId,
      p_opening_cash: amount,
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
      .order('created_at', { ascending: true });
    if (rowsError) throw new Error(rowsError.message);

    const postedRows = (rows || []).filter((receipt) => receipt.status === 'posted');
    const voidedRows = (rows || []).filter((receipt) => receipt.status === 'voided');
    const splitIds = postedRows.filter((receipt) => receipt.payment_method === 'split').map((receipt) => receipt.id);
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

    const postedIds = postedRows.map((receipt) => receipt.id);
    let refunds = [];
    if (postedIds.length) {
      const { data, error: refundError } = await supabase
        .from('cashier_refunds')
        .select('receipt_id,amount,settlement_method,method')
        .eq('property_id', shift.property_id)
        .in('receipt_id', postedIds);
      if (refundError) throw new Error(refundError.message);
      refunds = data || [];
    }

    const allocationTotals = new Map();
    for (const allocation of allocations) {
      const receiptId = String(allocation.receipt_id || '');
      allocationTotals.set(receiptId, (allocationTotals.get(receiptId) || 0) + Number(allocation.amount || 0));
    }
    const unreconciled = postedRows.filter((receipt) => receipt.payment_method === 'split'
      && Math.abs((allocationTotals.get(String(receipt.id)) || 0) - Number(receipt.total || 0)) > 0.01);
    if (unreconciled.length) {
      throw new Error('Shift report blocked: split payment allocations do not reconcile for receipt(s) ' + unreconciled.map((receipt) => receipt.order_number || receipt.id).join(', ') + '.');
    }

    const summary = buildShiftSalesSummary(postedRows, allocations, refunds, voidedRows);
    const staffIds = [shift.opened_by, shift.closed_by].filter(Boolean);
    let staffNames = {};
    if (staffIds.length) {
      const { data: staffRows } = await supabase.from('staff').select('user_id,full_name,email').eq('property_id', shift.property_id).in('user_id', staffIds);
      staffNames = Object.fromEntries((staffRows || []).map((person) => [person.user_id, person.full_name || person.email || 'Staff']));
    }
    const countedCash = shift.counted_cash == null ? null : Number(shift.counted_cash);
    const variance = shift.cash_variance == null ? null : Number(shift.cash_variance);
    return {
      shift,
      openedBy: staffNames[shift.opened_by] || '',
      closedBy: staffNames[shift.closed_by] || '',
      orders: postedRows,
      voidedOrders: voidedRows,
      refunds,
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
