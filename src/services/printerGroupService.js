import { supabase } from '@/lib/supabaseClient';
import { inventoryService } from '@/services/inventoryService';

export const printerGroupService = {
  async listCategories(propertyId) {
    const rows = await inventoryService.listPosCategories(propertyId);
    return rows.map((c) => ({ id: c.id, name: c.name }));
  },
  async listGroups(propertyId) {
    const [groupsRes, linksRes] = await Promise.all([
      supabase.from('printer_groups').select('id,name,production_center').eq('property_id', propertyId).order('name'),
      supabase.from('printer_group_categories').select('printer_group_id,category_id').eq('property_id', propertyId),
    ]);
    if (groupsRes.error) throw new Error(groupsRes.error.message);
    if (linksRes.error) throw new Error(linksRes.error.message);
    const byGroup = new Map();
    for (const l of linksRes.data || []) {
      if (!byGroup.has(l.printer_group_id)) byGroup.set(l.printer_group_id, []);
      byGroup.get(l.printer_group_id).push(l.category_id);
    }
    return (groupsRes.data || []).map((g) => ({
      id: g.id, name: g.name, productionCenter: g.production_center || '',
      categoryIds: byGroup.get(g.id) || [],
    }));
  },
  async saveGroup(propertyId, { id = null, name, productionCenter = '', categoryIds = [] }) {
    const { data, error } = await supabase.rpc('fn_save_printer_group', {
      p_property_id: propertyId, p_id: id, p_name: name,
      p_production_center: productionCenter || null, p_category_ids: categoryIds,
    });
    if (error) throw new Error(error.code === '23505' ? 'A printer group with this name already exists.' : error.message);
    return data;
  },
  async deleteGroups(propertyId, ids) {
    const { error } = await supabase.rpc('fn_delete_printer_groups', { p_property_id: propertyId, p_ids: ids });
    if (error) throw new Error(error.message);
  },
};
