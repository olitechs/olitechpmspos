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


  async listFloorConfiguration(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_pos_floor_configuration', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  },
  async listFloorWaiters(propertyId) {
    const { data, error } = await supabase.rpc('fn_list_pos_floor_waiters', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async saveFloorConfiguration({ propertyId, zones }) {
    if (!propertyId) throw new Error('A property must be selected before saving the POS floor.');
    const payload = (Array.isArray(zones) ? zones : []).map((zone) => ({
      id: String(zone.id || ''), name: String(zone.name || '').trim(),
      tables: (Array.isArray(zone.tables) ? zone.tables : []).map((table) => ({
        id: String(table.id || ''), number: Number(table.number), seats: Number(table.seats) || 4,
        x: Math.max(0, Math.round(Number(table.x) || 0)), y: Math.max(0, Math.round(Number(table.y) || 0)),
        w: Math.max(48, Math.round(Number(table.w || table.width) || 86)),
        h: Math.max(48, Math.round(Number(table.h || table.height) || 64)),
        assignedWaiterId: table.assignedWaiterId || table.assigned_waiter_id || null,
      })),
    }));
    const { data, error } = await supabase.rpc('fn_save_pos_floor_configuration', { p_property_id: propertyId, p_zones: payload });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : payload;
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


  async moveOrMergeTable({ propertyId, sourceTableKey, targetTableKey, targetTableNumber, mode }) {
    const { data, error } = await supabase.rpc('fn_move_or_merge_pos_table', {
      p_property_id: propertyId,
      p_source_table_key: sourceTableKey,
      p_target_table_key: targetTableKey,
      p_target_table_number: String(targetTableNumber ?? targetTableKey ?? ''),
      p_mode: mode,
    });
    if (error) throw new Error(error.message);
    return data || null;
  },

  async markKotSent({ propertyId, tableKey }) {
    const { data, error } = await supabase
      .from('pos_table_sessions')
      .update({ kot_sent_at: new Date().toISOString() })
      .eq('property_id', propertyId)
      .eq('table_key', tableKey)
      .neq('status', 'closed')
      .select()
      .single();
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

  subscribeToKitchenOrders(propertyId, { onChange } = {}) {
    if (!propertyId || typeof onChange !== 'function') return null;
    return supabase
      .channel(`pos-kitchen-orders:${propertyId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pos_kitchen_orders',
        filter: `property_id=eq.${propertyId}`,
      }, (payload) => onChange({
        eventType: payload.eventType,
        row: payload.new || payload.old || null,
      }))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('[KDS] realtime channel failed');
      });
  },

  async getShiftReconciliation({ propertyId, shiftId }) {
    const { data, error } = await supabase.rpc('fn_pos_shift_reconciliation', {
      p_property_id: propertyId,
      p_pos_shift_id: shiftId,
    });
    if (error) throw new Error(error.message);
    return data || {};
  },

  async refireKitchenOrder({ propertyId, orderId, reason }) {
    const { data, error } = await supabase.rpc('fn_refire_kitchen_order', {
      p_property_id: propertyId,
      p_order_id: orderId,
      p_reason: reason,
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
