// Store/outlet CRUD for the Stores screen. Property-scoped; RLS stays the
// authority. Errors are rethrown raw so callers can branch on PostgREST codes
// (e.g. 23505 unique store name per property).
import { supabase } from '@/lib/supabaseClient';

export const storeService = {
  async listStores(propertyId) {
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('property_id', propertyId)
      .order('is_default', { ascending: false })
      .order('name');
    if (error) throw error;
    return data || [];
  },

  async createStore({ propertyId, name, address = null, isDefault = false }) {
    const payload = { property_id: propertyId, name, address, is_default: isDefault };
    const { data, error } = await supabase.from('stores').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateStore(id, propertyId, payload) {
    const { data, error } = await supabase.from('stores').update(payload)
      .eq('id', id).eq('property_id', propertyId)
      .select().single();
    if (error) throw error;
    return data;
  },

  async deleteStore(id, propertyId) {
    const { error } = await supabase.from('stores').delete()
      .eq('id', id).eq('property_id', propertyId);
    if (error) throw error;
  },
};
