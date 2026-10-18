import { supabase } from '@/lib/supabaseClient';

export const featureEntitlementService = {
  async getForProperty(propertyId) {
    if (!propertyId) throw new Error('A property must be selected.');
    const { data, error } = await supabase.rpc('fn_get_property_feature_entitlements', { p_property_id: propertyId });
    if (error) throw new Error(error.message);
    if (!data?.features || typeof data.features !== 'object') throw new Error('The server returned an invalid entitlement response.');
    return data;
  },
  async setForProperty(propertyId, featureKey, enabled) {
    if (!propertyId) throw new Error('A property must be selected.');
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(featureKey)) throw new Error('Invalid feature key.');
    const { data, error } = await supabase.rpc('fn_set_property_feature_entitlement', {
      p_property_id: propertyId, p_feature_key: featureKey, p_enabled: Boolean(enabled),
    });
    if (error) throw new Error(error.message);
    if (!data?.features) throw new Error('The server did not confirm the entitlement update.');
    return data;
  },
};
