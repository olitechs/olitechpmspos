import { supabase } from '@/lib/supabaseClient';

export const posAccessService = {
  async verifyPin({ propertyId, pin }) {
    const { data, error } = await supabase.rpc('fn_verify_pos_access_pin', {
      p_property_id: propertyId,
      p_pin: String(pin || ''),
    });
    if (error) throw new Error(error.message);
    return data || { ok: false };
  },

  async getPinStatus(propertyId) {
    const { data, error } = await supabase.rpc('fn_pos_access_pin_status', {
      p_property_id: propertyId,
    });
    if (error) throw new Error(error.message);
    return data || { configured: false, is_default: true };
  },

  async resetPin({ propertyId, pin }) {
    const { data, error } = await supabase.rpc('fn_reset_pos_access_pin', {
      p_property_id: propertyId,
      p_new_pin: String(pin || ''),
    });
    if (error) throw new Error(error.message);
    return data || { ok: false };
  },
};
