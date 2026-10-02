import { supabase } from '@/lib/supabaseClient';

export const DEFAULT_RECEIPT_SETTINGS = {
  logo_url: '',
  property_name: '',
  address_line1: '',
  address_line2: '',
  phone: '',
  email: '',
  website: '',
  kra_pin: '',
  extra_header_line: '',
  footer_line1: 'Thank you for dining with us.',
  footer_line2: 'Please keep your receipt.',
};

export async function getPropertySettings(propertyId) {
  if (!propertyId) return null;
  const { data, error } = await supabase
    .from('property_settings')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw error;
  return data || { property_id: propertyId, ...DEFAULT_RECEIPT_SETTINGS };
}

export async function savePropertySettings(propertyId, values) {
  if (!propertyId) throw new Error('Property is required.');
  const payload = {
    property_id: propertyId,
    ...DEFAULT_RECEIPT_SETTINGS,
    ...values,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('property_settings')
    .upsert(payload, { onConflict: 'property_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadPropertyLogo(propertyId, file) {
  if (!propertyId || !file) throw new Error('Property and logo are required.');
  if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/i.test(file.type)) {
    throw new Error('Logo must be PNG, JPG, WEBP or SVG.');
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2MB or smaller.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${propertyId}/logo.${ext}`;
  const { error } = await supabase.storage
    .from('property-logos')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/png', cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('property-logos').getPublicUrl(path);
  return data.publicUrl;
}
