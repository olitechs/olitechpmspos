import { supabase } from '@/lib/supabaseClient';

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
};
