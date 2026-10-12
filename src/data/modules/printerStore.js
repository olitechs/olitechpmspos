import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/lib/supabaseClient';

const id = () => globalThis.crypto?.randomUUID?.() || String(Date.now());

export const usePrinterStore = create(persist((set, get) => ({
  stores: [], storeId: null, propertyId: null, workspaceId: null,
  printers: [], printAgents: [], printerGroups: [], loading: false, error: null,

  async hydrate(storeId) {
    if (!storeId) return;
    set({ storeId, loading: true, error: null });
    try {
      const [{ data: stores, error: storesError }, { data: groups, error: groupsError }, { data: printers, error: printersError }, { data: agents, error: agentsError }] = await Promise.all([
        supabase.from('stores').select('*').order('is_default', { ascending: false }).order('name'),
        supabase.from('printer_groups').select('*').eq('store_id', storeId).order('name'),
        supabase.from('printers').select('*').eq('store_id', storeId).order('name'),
        supabase.from('print_agents').select('*').order('last_seen', { ascending: false })
      ]);
      for (const error of [storesError, groupsError, printersError, agentsError]) if (error) throw error;

      const store = (stores || []).find(s => s.id === storeId);
      const ids = (groups || []).map(g => g.id);
      let links = [], cats = [];
      if (ids.length) {
        const a = await supabase.from('printer_group_categories').select('printer_group_id,category_id').in('printer_group_id', ids);
        if (a.error) throw a.error;
        cats = a.data || [];
        const b = await supabase.from('printer_group_printers').select('printer_group_id,printer_id').in('printer_group_id', ids);
        if (b.error) throw b.error;
        links = b.data || [];
      }

      set({
        stores: stores || [], propertyId: store?.property_id || null,
        workspaceId: store?.workspace_id || null, printers: printers || [],
        printAgents: agents || [],
        printerGroups: (groups || []).map(g => ({
          ...g,
          categoryIds: cats.filter(x => x.printer_group_id === g.id).map(x => x.category_id),
          categoryCount: cats.filter(x => x.printer_group_id === g.id).length,
          printerIds: links.filter(x => x.printer_group_id === g.id).map(x => x.printer_id)
        })),
        loading: false, error: null
      });
    } catch (e) {
      set({ loading: false, error: e?.message || 'Unable to load printer configuration.' });
      throw e;
    }
  },

  async savePrinterGroup(input) {
    const { storeId, workspaceId, propertyId } = get();
    if (!storeId || !workspaceId) throw new Error('Select a valid store before saving.');
    const name = String(input.name || '').trim();
    if (!name || name.length > 80) throw new Error('Printer group name must contain 1 to 80 characters.');

    const { data, error } = await supabase.rpc('fn_save_store_printer_group', {
      p_workspace_id: workspaceId,
      p_store_id: storeId,
      p_property_id: propertyId,
      p_group_id: input.id || null,
      p_name: name,
      p_category_ids: [...new Set(input.categoryIds || [])],
      p_printer_ids: [...new Set(input.printerIds || [])]
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Printer group save returned no ID.');
    await get().hydrate(storeId);
    return data;
  },

  async addPrinterGroup(input) { return get().savePrinterGroup(input); },

  async updatePrinterGroup(input) {
    if (!input.id) throw new Error('Printer group ID is required.');
    return get().savePrinterGroup(input);
  },

  async deletePrinterGroup(groupId) {
    const { storeId, workspaceId } = get();
    if (!storeId || !workspaceId || !groupId) throw new Error('Select a store and printer group first.');
    const { error } = await supabase.from('printer_groups').delete()
      .eq('id', groupId).eq('store_id', storeId).eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);
    await get().hydrate(storeId);
  },

  async addPrinter(input) {
    const { storeId, workspaceId } = get();
    if (!storeId || !workspaceId) throw new Error('Select a store before adding a printer.');
    const name = String(input.name || '').trim();
    if (!name || name.length > 100) throw new Error('Printer name must contain 1 to 100 characters.');
    const ipAddress = String(input.ipAddress || '').trim();
    const port = Number(input.port ?? 9100);
    if (!['usb', 'bluetooth', 'serial'].includes(input.connectionType)) {
      const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ipAddress);
      const hostname = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(ipAddress);
      if (!ipv4 && !hostname) throw new Error('Enter a valid printer IP address or hostname.');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Printer port must be an integer between 1 and 65535.');

    const { data, error } = await supabase.from('printers').insert({
      id: id(), workspace_id: workspaceId, store_id: storeId,
      name, connection_type: input.connectionType || 'network',
      ip_address: ipAddress || null, port,
      mac_address: input.macAddress || null, is_kitchen: !!input.isKitchen,
      is_receipt: !!input.isReceipt, status: 'offline'
    }).select().single();
    if (error) throw new Error(error.message);
    await get().hydrate(storeId);
    return data;
  },

  async updateStatus(printerId, status) {
    const { storeId } = get();
    const { data, error } = await supabase.from('printers')
      .update({ status, ...(status === 'online' ? { last_seen: new Date().toISOString() } : {}) })
      .eq('id', printerId).eq('store_id', storeId).select().single();
    if (error) throw new Error(error.message);
    set(s => ({ printers: s.printers.map(p => p.id === printerId ? data : p) }));
  },

  async pairPrinter(agentId, info) {
    const p = await get().addPrinter({ ...info, connectionType: info.connectionType || 'network' });
    const { error } = await supabase.from('printers').update({
      agent_id: agentId, status: 'online', last_seen: new Date().toISOString()
    }).eq('id', p.id).eq('store_id', get().storeId);
    if (error) throw new Error(error.message);
    await get().hydrate(get().storeId);
    return p;
  },

  getPrinterGroupsForCategory(categoryId) {
    return get().printerGroups.filter(g => (g.categoryIds || []).includes(categoryId));
  },

  splitOrderByPrinterGroups(items = []) {
    const out = new Map();
    for (const item of items) {
      const categoryId = item.categoryId || item.category_id;
      const groups = categoryId ? get().getPrinterGroupsForCategory(categoryId) : [];
      for (const group of groups) {
        if (!out.has(group.id)) out.set(group.id, []);
        out.get(group.id).push(item);
      }
    }
    return out;
  }
}), { name: 'olitech-printer-store', storage: createJSONStorage(() => localStorage) }));

export const selectGroupCategoryCount = group => (group?.categoryIds || []).length;
