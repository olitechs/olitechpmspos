import { supabase } from '@/lib/supabaseClient';
import { buildShiftSalesSummary } from '@/services/shiftReportCore';

const propertyDate = (value) => {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
};

const normalizeCashierShift = (row) => {
  if (!row?.id) return null;
  return {
    ...row,
    shift_no: row.shift_no == null ? null : String(row.shift_no),
    opening_cash: Number(row.opening_float ?? row.opening_cash ?? 0),
    date: row.date || propertyDate(row.opened_at),
    counted_cash: row.closing_cash_count == null ? null : Number(row.closing_cash_count),
    cash_variance: row.variance == null ? null : Number(row.variance),
  };
};

export const shiftService = {
  // cashier_shifts is the production source of truth. pos_shifts and its
  // open/current/close RPCs were intentionally retired by migration
  // 20261109071322; never call those retired endpoints from the POS UI.
  async getCurrentShift(propertyId) {
    if (!propertyId) return null;
    const { data, error } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('property_id', propertyId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return normalizeCashierShift(data);
  },

  async openShift({ propertyId, openingCash, notes = '' }) {
    const amount = Number(openingCash);
    if (!propertyId) throw new Error('Select an active property before opening a shift.');
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('A starting cash float greater than zero is required to open a shift.');
    }
    const payload = { p_property_id: propertyId, p_opening_float: amount };
    const openingNotes = String(notes || '').trim();
    // Send p_notes only when it has content, so a note-free shift still opens on
    // a database where the opening-notes migration has not been applied yet.
    if (openingNotes) payload.p_notes = openingNotes;
    const { data, error } = await supabase.rpc('fn_open_cashier_shift', payload);
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    const shift = normalizeCashierShift(row);
    if (!shift?.id) throw new Error('The database did not return the opened shift. Refresh and verify the shift before continuing.');
    localStorage.setItem(`olitech_pos_shift_${propertyId}`, shift.id);
    return shift;
  },

  async closeShift({ shiftId, countedCash, notes = '' }) {
    const amount = Number(countedCash);
    if (!shiftId) throw new Error('The active shift could not be identified.');
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid closing cash count.');
    const { data, error } = await supabase.rpc('fn_close_cashier_shift', {
      p_shift_id: shiftId,
      p_closing_cash_count: amount,
      p_notes: notes || null,
    });
    if (error) throw new Error(error.message);
    return normalizeCashierShift(data);
  },

  async getOpenTables(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_active_pos_table_sessions', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async getShiftReport(shiftId) {
    const { data: rawShift, error: shiftError } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('id', shiftId)
      .single();
    if (shiftError) throw new Error(shiftError.message);
    const shift = normalizeCashierShift(rawShift);

    const { data: rows, error: rowsError } = await supabase
      .from('pos_receipts')
      .select('*')
      .eq('property_id', shift.property_id)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: true });
    if (rowsError) throw new Error(rowsError.message);

    const postedRows = (rows || []).filter((receipt) => receipt.status === 'posted');
    const voidedRows = (rows || []).filter((receipt) => receipt.status === 'voided');
    const splitIds = postedRows
      .filter((receipt) => receipt.payment_method === 'split')
      .map((receipt) => receipt.id);

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

    const allocationTotals = new Map();
    for (const allocation of allocations) {
      const receiptId = String(allocation.receipt_id || '');
      allocationTotals.set(receiptId, (allocationTotals.get(receiptId) || 0) + Number(allocation.amount || 0));
    }
    const unreconciled = postedRows.filter((receipt) => receipt.payment_method === 'split'
      && Math.abs((allocationTotals.get(String(receipt.id)) || 0) - Number(receipt.total || 0)) > 0.01);
    if (unreconciled.length) {
      throw new Error('Shift report blocked: split payment allocations do not reconcile for receipt(s) '
        + unreconciled.map((receipt) => receipt.order_number || receipt.id).join(', ') + '.');
    }

    let refunds = [];
    const postedIds = postedRows.map((receipt) => receipt.id);
    if (postedIds.length) {
      const { data, error: refundError } = await supabase
        .from('cashier_refunds')
        .select('receipt_id,amount,settlement_method,method')
        .eq('property_id', shift.property_id)
        .in('receipt_id', postedIds);
      if (refundError) throw new Error(refundError.message);
      refunds = data || [];
    }

    const summary = buildShiftSalesSummary(postedRows, allocations, refunds, voidedRows);
    const { data: cashierSummary, error: summaryError } = await supabase.rpc('fn_cashier_shift_summary', {
      p_shift_id: shiftId,
    });
    if (summaryError) throw new Error(summaryError.message);

    const staffIds = [shift.opened_by, shift.closed_by].filter(Boolean);
    let staffNames = {};
    if (staffIds.length) {
      const { data: staffRows, error: staffError } = await supabase
        .from('staff')
        .select('user_id,full_name,email')
        .eq('property_id', shift.property_id)
        .in('user_id', staffIds);
      if (staffError) throw new Error(staffError.message);
      staffNames = Object.fromEntries((staffRows || []).map((person) => [
        person.user_id,
        person.full_name || person.email || 'Staff',
      ]));
    }

    return {
      shift,
      openedBy: staffNames[shift.opened_by] || '',
      closedBy: staffNames[shift.closed_by] || '',
      orders: postedRows,
      voidedOrders: voidedRows,
      refunds,
      ...summary,
      // Use the database reconciliation as the cash-drawer authority. The
      // detailed payment mix above is calculated from the same receipt ledger.
      expectedCash: Number(cashierSummary?.expected_cash ?? 0),
      countedCash: shift.counted_cash,
      variance: shift.cash_variance,
    };
  },

  async listShifts(propertyId, filters = null) {
    let query = supabase
      .from('cashier_shifts')
      .select('*')
      .eq('property_id', propertyId)
      .order('opened_at', { ascending: false });

    const startOfNairobiDay = (date) => `${date}T00:00:00+03:00`;
    const startAfterNairobiDay = (date) => {
      const next = new Date(`${date}T00:00:00+03:00`);
      next.setUTCDate(next.getUTCDate() + 1);
      return next.toISOString();
    };

    if (typeof filters === 'string') {
      query = query.gte('opened_at', startOfNairobiDay(filters)).lt('opened_at', startAfterNairobiDay(filters));
    } else if (filters && typeof filters === 'object') {
      if (filters.from) query = query.gte('opened_at', startOfNairobiDay(filters.from));
      if (filters.to) query = query.lt('opened_at', startAfterNairobiDay(filters.to));
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    }

    const { data, error } = await query.limit(500);
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeCashierShift);
  },

  async getShiftReceipts(propertyId, shiftId) {
    if (!propertyId || !shiftId) return [];
    const { data: receipts, error: receiptError } = await supabase
      .from('pos_receipts')
      .select('*')
      .eq('property_id', propertyId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (receiptError) throw new Error(receiptError.message);
    const rows = receipts || [];
    if (!rows.length) return [];

    const receiptIds = rows.map((receipt) => receipt.id);
    const [refundResult, adjustmentResult] = await Promise.all([
      supabase
        .from('cashier_refunds')
        .select('*')
        .eq('property_id', propertyId)
        .in('receipt_id', receiptIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('cashier_adjustments')
        .select('id,target_id,amount,refund_method,reason,status,created_at')
        .eq('property_id', propertyId)
        .eq('target_type', 'pos_receipt')
        .eq('adjustment_type', 'refund')
        .eq('status', 'pending')
        .in('target_id', receiptIds)
        .order('created_at', { ascending: false }),
    ]);
    if (refundResult.error) throw new Error(refundResult.error.message);
    if (adjustmentResult.error) throw new Error(adjustmentResult.error.message);

    const refundRows = refundResult.data || [];
    const pendingRows = adjustmentResult.data || [];
    const pendingByReceipt = new Map();
    for (const pending of pendingRows) {
      const key = String(pending.target_id);
      const list = pendingByReceipt.get(key) || [];
      list.push(pending);
      pendingByReceipt.set(key, list);
    }

    const refundsByReceipt = new Map();
    for (const refund of refundRows || []) {
      const key = String(refund.receipt_id);
      const list = refundsByReceipt.get(key) || [];
      list.push(refund);
      refundsByReceipt.set(key, list);
    }

    return rows.map((receipt) => {
      const refunds = refundsByReceipt.get(String(receipt.id)) || [];
      const refundedTotal = refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      const pendingRefunds = pendingByReceipt.get(String(receipt.id)) || [];
      const pendingRefundTotal = pendingRefunds.reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);
      return {
        ...receipt,
        refunds,
        pending_refunds: pendingRefunds,
        refunded_total: refundedTotal,
        pending_refund_total: pendingRefundTotal,
        refundable_balance: Math.max(0, Number(receipt.total || 0) - refundedTotal - pendingRefundTotal),
      };
    });
  },

  async printData(shiftId) {
    return this.getShiftReport(shiftId);
  },
};
