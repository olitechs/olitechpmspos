import { supabase } from '@/lib/supabaseClient';

export const posService = {
  async listActiveSessions(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_active_pos_table_sessions', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async saveSession({
    propertyId,
    tableKey,
    tableNumber,
    zoneId = null,
    status = 'occupied',
    guests = 1,
    waiter = null,
    orderNumber = null,
    orderLines = [],
  }) {
    const { data, error } = await supabase.rpc('fn_touch_pos_table_session', {
      p_property_id: propertyId,
      p_table_key: tableKey,
      p_table_number: String(tableNumber ?? ''),
      p_zone_id: zoneId || null,
      p_status: status,
      p_guests: Math.max(1, Number(guests || 1)),
      p_waiter: waiter || null,
      p_order_number: orderNumber || null,
      p_order_lines: Array.isArray(orderLines) ? orderLines : [],
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async closeSession({ propertyId, tableKey, orderLines = [] }) {
    return this.saveSession({
      propertyId,
      tableKey,
      tableNumber: '',
      status: 'closed',
      orderLines,
    });
  },
  async listActiveKitchenOrders(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_active_kitchen_orders', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async createKitchenOrder({
    propertyId,
    tableKey,
    tableNumber,
    orderNumber,
    waiter = null,
    orderLines = [],
    printJobs = {},
  }) {
    const { data, error } = await supabase.rpc('fn_create_kitchen_order', {
      p_property_id: propertyId,
      p_table_key: tableKey || null,
      p_table_number: String(tableNumber ?? ''),
      p_order_number: String(orderNumber ?? ''),
      p_waiter: waiter || null,
      p_order_lines: Array.isArray(orderLines) ? orderLines : [],
      p_print_jobs: printJobs || {},
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async updateKitchenOrder({ propertyId, orderId, status, printJobs = {} }) {
    const { data, error } = await supabase.rpc('fn_update_kitchen_order', {
      p_property_id: propertyId,
      p_order_id: orderId,
      p_status: status,
      p_print_jobs: printJobs || {},
    });
    if (error) throw new Error(error.message);
    return data;
  },
};
