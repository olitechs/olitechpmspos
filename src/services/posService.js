import { supabase } from '@/lib/supabaseClient';

export const posService = {
  async listPrinters(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_pos_printers', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async savePrinter({
    propertyId,
    clientKey,
    name,
    connectionType,
    host = '',
    port = '',
    agentUrl = '',
    purposes = ['receipt'],
    center = '',
    baudRate = 9600,
  }) {
    const { data, error } = await supabase.rpc('fn_upsert_pos_printer', {
      p_property_id: propertyId,
      p_client_key: clientKey,
      p_name: name,
      p_connection_type: connectionType,
      p_host: host || null,
      p_port: port || null,
      p_agent_url: agentUrl || null,
      p_purposes: Array.isArray(purposes) ? purposes : ['receipt'],
      p_center: center || null,
      p_baud_rate: Number(baudRate) || 9600,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async deletePrinter({ propertyId, clientKey }) {
    const { data, error } = await supabase.rpc('fn_delete_pos_printer', {
      p_property_id: propertyId,
      p_client_key: clientKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async listActiveSessions(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_active_pos_table_sessions', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || [];
  },

  subscribeToTableSessions(propertyId, { onChange } = {}) {
    if (!propertyId || typeof onChange !== 'function') return null;
    const channel = supabase
      .channel(`pos-table-sessions:${propertyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pos_table_sessions',
          filter: `property_id=eq.${propertyId}`,
        },
        (payload) => {
          onChange({
            eventType: payload.eventType,
            row: payload.new || payload.old || null,
          });
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[POS] table session realtime channel failed');
        }
      });
    return channel;
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
