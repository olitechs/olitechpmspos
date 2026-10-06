import { supabase } from '@/lib/supabaseClient';

export const posPhase3Service = {
  async getItemModifiers(propertyId, menuItemId) {
    const { data: mappings, error } = await supabase
      .from('pos_menu_modifier_groups')
      .select('modifier_group_id, sort_order')
      .eq('property_id', propertyId)
      .eq('menu_item_id', menuItemId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    if (!mappings?.length) return [];

    const groupIds = mappings.map((row) => row.modifier_group_id);
    const [{ data: groups, error: groupError }, { data: options, error: optionError }] = await Promise.all([
      supabase.from('pos_modifier_groups').select('*').eq('property_id', propertyId).in('id', groupIds).eq('active', true).order('sort_order', { ascending: true }),
      supabase.from('pos_modifier_options').select('*').eq('property_id', propertyId).in('modifier_group_id', groupIds).eq('active', true).order('sort_order', { ascending: true }),
    ]);
    if (groupError) throw groupError;
    if (optionError) throw optionError;
    return (groups || []).map((group) => ({
      ...group,
      options: (options || []).filter((option) => option.modifier_group_id === group.id),
    })).filter((group) => group.options.length);
  },

  async listActiveDiscounts(propertyId) {
    const { data, error } = await supabase
      .from('pos_discounts')
      .select('*')
      .eq('property_id', propertyId)
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;
    const now = Date.now();
    return (data || []).filter((discount) => {
      const starts = discount.starts_at ? new Date(discount.starts_at).getTime() : -Infinity;
      const ends = discount.ends_at ? new Date(discount.ends_at).getTime() : Infinity;
      return now >= starts && now <= ends;
    });
  },

  calculateDiscount(discount, subtotal) {
    if (!discount || subtotal <= 0) return 0;
    if (discount.discount_type === 'percentage') {
      return Math.min(subtotal, Math.round(subtotal * Number(discount.percentage_basis_points || 0) / 10000));
    }
    return Math.min(subtotal, Number(discount.amount_minor || 0) / 100);
  },
};