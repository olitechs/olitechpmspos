import { supabase } from '@/lib/supabaseClient';
import { buildShiftSalesSummary, normalizeShiftPaymentMethod } from '@/services/shiftReportCore';

export const shiftService = {
  async getCurrentShift(propertyId) {
    if (!propertyId) return null;

    const normalizeShift = (value) => {
      const row = Array.isArray(value) ? value[0] : value;
      if (!row || typeof row !== 'object') return null;
      const nested = row.shift && typeof row.shift === 'object' ? row.shift
        : row.current_shift && typeof row.current_shift === 'object' ? row.current_shift
        : row;
      const shift = {
        ...nested,
        id: nested.id || nested.shift_id || row.id || row.shift_id || null,
        shift_no: nested.shift_no || nested.shift_number || row.shift_no || row.shift_number || null,
        opened_at: nested.opened_at || nested.started_at || row.opened_at || row.started_at || null,
        opening_cash: nested.opening_cash ?? nested.opening_float ?? row.opening_cash ?? row.opening_float ?? 0,
        date: nested.date || nested.business_date || row.date || row.business_date || null,
      };
      return shift.id ? shift : null;
    };

    const { data, error } = await supabase.rpc('fn_current_pos_shift', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    const rpcShift = normalizeShift(data);
    // Some deployed RPC versions return a composite wrapper rather than the
    // plain pos_shifts row. Verify the canonical row directly if its identity
    // or display fields are missing. This also finds an open shift carried
    // across midnight; an open shift must not disappear just because its
    // business date is yesterday.
    if (rpcShift?.id && rpcShift.opened_at && rpcShift.shift_no) return rpcShift;

    const { data: row, error: rowError } = await supabase
      .from('pos_shifts')
      .select('*')
      .eq('property_id', propertyId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rowError) {
      if (rpcShift?.id) return rpcShift;
      throw new Error(rowError.message);
    }
    return normalizeShift(row) || rpcShift;
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
    const { data, error } = await supabase.rpc('fn_list_active_pos_table_sessions', {
      p_property_id: propertyId,
    });
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

  async listShifts(propertyId, filters = null) {
    let query = supabase.from('pos_shifts').select('*').eq('property_id', propertyId).order('opened_at', { ascending: false });
    // Preserve the legacy exact-date call shape while supporting the Back Office
    // date-range and status filters.
    if (typeof filters === 'string') {
      query = query.eq('date', filters);
    } else if (filters && typeof filters === 'object') {
      if (filters.from) query = query.gte('date', filters.from);
      if (filters.to) query = query.lte('date', filters.to);
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    }
    const { data, error } = await query.limit(500);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async printData(shiftId) {
    return this.getShiftReport(shiftId);
  },
};
