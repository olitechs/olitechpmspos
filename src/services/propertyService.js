import { supabase } from '@/lib/supabaseClient';

function assertPropertyId(propertyId) {
  if (!propertyId) throw new Error('A property is required.');
  return propertyId;
}

export const propertyService = {
  async listMyProperties() {
    const { data, error } = await supabase
      .from('my_properties')
      .select('*')
      .order('name');

    if (error) throw new Error(error.message);
    return data || [];
  },

  async getProperty(propertyId) {
    assertPropertyId(propertyId);

    const { data, error } = await supabase
      .from('properties')
      .select('id,name,business_name,property_type,address,country,city,phone,email,website,currency,timezone,tax_settings,logo_url,business_registration,contact_person,status,package,created_at,updated_at')
      .eq('id', propertyId)
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  async updateProperty(propertyId, patch) {
    assertPropertyId(propertyId);

    const allowed = [
      'name', 'business_name', 'property_type', 'address', 'country', 'city',
      'phone', 'email', 'website', 'currency', 'timezone', 'tax_settings',
      'logo_url', 'business_registration', 'contact_person',
    ];

    const safePatch = Object.fromEntries(
      Object.entries(patch || {}).filter(([key]) => allowed.includes(key))
    );

    if (Object.keys(safePatch).length === 0) {
      throw new Error('No editable property fields were supplied.');
    }

    const { data, error } = await supabase
      .from('properties')
      .update(safePatch)
      .eq('id', propertyId)
      .select('id,name,business_name,property_type,address,country,city,phone,email,website,currency,timezone,tax_settings,logo_url,business_registration,contact_person,status,package,created_at,updated_at')
      .single();

    if (error) throw new Error(error.message);
    return data;
  },
};
