import { supabase } from '@/lib/supabaseClient';

export const SALES_RECEIPT_PAGE_SIZE = 500;
export const SALES_RECEIPT_MAX_ROWS = 10_000;

const nextIsoDate = (value) => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Select a valid report end date.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const isMissingRpc = (error, rpcName) => {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' && message.includes(rpcName)
    || message.includes(`function public.${rpcName}`)
    || message.includes(`Could not find the function public.${rpcName}`);
};

const emptyReconciliation = () => ({
  room_revenue_variance: 0,
  pos_tax_discount_variance: 0,
  pos_split_tender_variance: 0,
  voids_excluded: 0,
  unavailable: true,
});

// Defense in depth for databases where the forward-only migration has not yet
// been applied. The authoritative control is the corrected server function;
// this prevents an old legacy payload from being used by an unauthorized role.
const withoutValuation = (data) => {
  if (!data?.inventory) return data;
  const { valuation, ...inventory } = data.inventory;
  return { ...data, inventory: { ...inventory, valuation: null, valuation_restricted: true } };
};

export const reportingService = {
  async getManagementReport(propertyId, from, to, { canViewValuation = false } = {}) {
    const args = { p_property_id: propertyId, p_from: from, p_to: to };
    const sanitize = (data) => (canViewValuation ? data : withoutValuation(data));
    const corrected = await supabase.rpc('fn_phase4b_management_report', args);
    if (!corrected.error) {
      const data = corrected.data || {};
      return { ...sanitize(data), reconciliation: data.reconciliation || emptyReconciliation(), phase4bSource: 'corrected' };
    }
    if (!isMissingRpc(corrected.error, 'fn_phase4b_management_report')) throw new Error(corrected.error.message);

    // Legacy fallback: keep the screen available before the forward-only
    // migration is applied. Valuation is removed here as well, and the UI
    // labels the reconciliation as unavailable.
    const legacy = await supabase.rpc('fn_management_report', args);
    if (legacy.error) throw new Error(legacy.error.message);
    const data = legacy.data || {};
    return { ...sanitize(data), reconciliation: emptyReconciliation(), phase4bSource: 'legacy' };
  },

  // Scoped POS-only source for the Storekeeper dashboard. It deliberately does
  // not request the management report, so store roles never receive hotel or
  // inventory data and are not blocked by back_office.reports.view.
  async getStoreSalesSnapshot(propertyId, from, to) {
    const args = { p_property_id: propertyId, p_from: from, p_to: to };
    const corrected = await supabase.rpc('fn_phase4b_store_sales_snapshot', args);
    if (!corrected.error) return corrected.data || { sales: {} };
    if (!isMissingRpc(corrected.error, 'fn_phase4b_store_sales_snapshot')) throw new Error(corrected.error.message);

    // Pre-migration compatibility: the legacy management RPC is membership
    // scoped and, after the forward correction, no longer leaks valuation.
    const legacy = await supabase.rpc('fn_management_report', args);
    if (legacy.error) throw new Error(legacy.error.message);
    const data = legacy.data || {};
    return { sales: data.sales || {} };
  },

  async getReconciliationReport(propertyId, from, to) {
    const { data, error } = await supabase.rpc('fn_phase4b_reconciliation_report', {
      p_property_id: propertyId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    return data || {};
  },

  async getSalesDetail(propertyId, from, to) {
    const { data, error } = await supabase.rpc('fn_management_sales_detail', {
      p_property_id: propertyId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    return data || { departments: [], payments: [], daily: [], discounts: [], voids: [], refunds: [] };
  },

  async getPostedSalesReceipts(propertyId, from, to, onProgress = () => {}) {
    if (!propertyId) throw new Error('An active property is required to load sales reports.');
    if (!from || !to || from > to) throw new Error('Choose a valid start and end date for the sales report.');
    const fromTimestamp = `${from}T00:00:00+03:00`;
    const toTimestampExclusive = `${nextIsoDate(to)}T00:00:00+03:00`;
    const receipts = [];
    let offset = 0;

    while (offset <= SALES_RECEIPT_MAX_ROWS) {
      const { data, error } = await supabase.from('pos_receipts')
        .select('id,created_at,items,total,status,shift_id,pos_shift_id')
        .eq('property_id', propertyId)
        .eq('status', 'posted')
        .gte('created_at', fromTimestamp)
        .lt('created_at', toTimestampExclusive)
        .order('created_at', { ascending: true })
        .range(offset, offset + SALES_RECEIPT_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const page = data || [];
      receipts.push(...page);
      onProgress(receipts.length);
      if (receipts.length > SALES_RECEIPT_MAX_ROWS) {
        throw new Error(`This report contains more than ${SALES_RECEIPT_MAX_ROWS.toLocaleString()} posted receipts. Narrow the date range so all source rows can be included.`);
      }
      if (page.length < SALES_RECEIPT_PAGE_SIZE) break;
      offset += SALES_RECEIPT_PAGE_SIZE;
    }

    const shiftIds = [...new Set(receipts.map((receipt) => receipt.pos_shift_id || receipt.shift_id).filter(Boolean))];
    const shifts = [];
    for (let index = 0; index < shiftIds.length; index += 200) {
      const ids = shiftIds.slice(index, index + 200);
      const { data, error } = await supabase.from('pos_shifts').select('id,shift_no,date')
        .eq('property_id', propertyId)
        .in('id', ids);
      if (error) throw new Error(error.message);
      shifts.push(...(data || []));
    }
    return { receipts, shifts };
  },
};
