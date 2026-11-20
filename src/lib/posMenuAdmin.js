/**
 * Pure helpers for POS menu administration.
 *
 * Keeping ordering, grouping, filtering and permission decisions here means the
 * UI cannot drift from the rules, and they can be unit-tested without a browser
 * or a Supabase connection.
 */

/** Roles that may change prices and stock levels. */
export const PRICE_STOCK_ROLES = new Set([
  'super_admin',
  'hotel_admin',
  'owner',
  'admin',
  'manager',
  'property_manager',
  'general_manager',
  'fb_manager',
]);

/** Roles that may only adjust presentation (photos, tile colours). */
export const APPEARANCE_ONLY_ROLES = new Set(['cashier', 'storekeeper', 'store_keeper', 'store_manager']);

/**
 * Mirrors the database `can_manage_pos_menu` helper: these roles may rename,
 * reorder and enable/disable categories. Storekeepers are intentionally absent
 * because the `pos_menu_categories` RLS policies reject their writes.
 */
export const MENU_CATEGORY_ROLES = new Set([
  'super_admin',
  'hotel_admin',
  'owner',
  'admin',
  'manager',
  'property_manager',
  'general_manager',
  'fb_manager',
  'cashier',
]);

export function roleOf(user) {
  return String(user?.staff?.role || user?.propertyRole || '').toLowerCase();
}

/**
 * Price and stock editing is limited to management roles. Cashiers and
 * storekeepers keep the appearance controls only.
 */
export function canEditPriceAndStock(user) {
  if (!user) return false;
  if (user.isPlatformOwner) return true;
  return PRICE_STOCK_ROLES.has(roleOf(user));
}

export function canManageMenuCategories(user) {
  if (!user) return false;
  if (user.isPlatformOwner) return true;
  return MENU_CATEGORY_ROLES.has(roleOf(user));
}

export function canManageAppearance(user) {
  if (!user) return false;
  if (user.isPlatformOwner) return true;
  const role = roleOf(user);
  return PRICE_STOCK_ROLES.has(role) || APPEARANCE_ONLY_ROLES.has(role);
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Next stable sort value so a new row lands after the existing ones. */
export function nextSortOrder(values = []) {
  const max = values.reduce((highest, value) => Math.max(highest, toNumber(value)), 0);
  return Math.round(max) + 1;
}

/**
 * Immutably move one row up (-1) or down (+1). Out-of-range moves return the
 * original array so callers can bail out without a state update.
 */
export function moveWithin(list, index, direction) {
  const target = index + direction;
  if (!Array.isArray(list) || index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Payload for a per-row sort_order update. */
export function buildOrderPayload(list = []) {
  return list.map((item, index) => ({ id: item.id, sortOrder: index }));
}

function compareName(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

/** Group products by category, honouring the category display order. */
export function groupMenuItems(items = [], categories = []) {
  const categoryOrder = categories.map((category) => category.name);
  const groups = new Map();
  for (const item of items) {
    const name = item.category || 'General';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ai = categoryOrder.indexOf(a);
      const bi = categoryOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      return compareName(a, b);
    })
    .map(([name, rows]) => ({
      name,
      items: [...rows].sort((x, y) => toNumber(x.pos_sort) - toNumber(y.pos_sort) || compareName(x.name, y.name)),
    }));
}

export function filterMenuItems(items = [], { search = '', category = 'all' } = {}) {
  const term = String(search || '').trim().toLowerCase();
  return items.filter((item) => {
    if (category !== 'all' && (item.category || 'General') !== category) return false;
    if (!term) return true;
    return [item.name, item.sku, item.category].some((value) => String(value || '').toLowerCase().includes(term));
  });
}

/**
 * Normalise a menu row for the editor. `category` is the resolved display name
 * and the numeric fields are real numbers, so inputs never receive "null".
 */
export function menuRowToDraft(row = {}) {
  return {
    ...row,
    category: row.category || row.pos_category || 'General',
    selling_price: toNumber(row.selling_price),
    current_stock: toNumber(row.current_stock),
    min_stock: toNumber(row.min_stock),
    max_stock: toNumber(row.max_stock),
    pos_sort: toNumber(row.pos_sort),
    pos_active: row.pos_active !== false,
    tile_color: row.tile_color || '',
    tile_text_color: row.tile_text_color || '',
    tile_image_url: row.tile_image_url || '',
  };
}

export function emptyMenuDraft(category = 'General', productionCenter = 'Kitchen', sortOrder = 0) {
  return menuRowToDraft({
    id: null,
    name: '',
    sku: '',
    category,
    unit: 'pcs',
    selling_price: 0,
    current_stock: 0,
    min_stock: 0,
    max_stock: 0,
    production_center: productionCenter,
    pos_sort: sortOrder,
    pos_active: true,
  });
}
