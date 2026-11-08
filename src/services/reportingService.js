import { supabase } from '@/lib/supabaseClient';

export const SALES_RECEIPT_PAGE_SIZE = 500;
export const SALES_RECEIPT_MAX_ROWS = 10_000;

const nextIsoDate = (value) => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Select a valid report end date.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const reportingService = {
  async getManagementReport(propertyId, from, to) {
    const { data, error } = await supabase.rpc('fn_management_report', {
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
