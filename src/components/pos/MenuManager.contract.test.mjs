import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const menu = read('./MenuManager.jsx');
const service = read('../../services/inventoryService.js');
const orderTaking = read('./OrderTaking.jsx');
const editor = read('./MenuVisualEditor.jsx');

const flat = (text) => text.replace(/\s+/g, ' ');
const flatMenu = flat(menu);
const flatService = flat(service);
const flatOrder = flat(orderTaking);

test('the manager loads inactive rows and the full product record', () => {
  assert.match(flatMenu, /inventoryService\.listPosMenuAdmin\(propertyId\)/);
  assert.match(flatMenu, /inventoryService\.listPosCategoriesAdmin\(propertyId\)/);
  assert.match(flatService, /listPosMenuAdmin\(propertyId\)/);
  for (const column of ['max_stock', 'pos_active', 'tile_color', 'tile_text_color', 'tile_image_url']) {
    assert.ok(flatService.includes(column), `listPosMenuAdmin must select ${column}`);
  }
});

test('saving a product preserves max stock and the POS visibility flag', () => {
  assert.ok(flatMenu.includes('maxStock: toNumber(editing.max_stock)'), 'max stock must be sent to avoid resetting it to zero');
  assert.ok(flatMenu.includes('active: editing.pos_active !== false'), 'visibility must come from the draft, never a hardcoded true');
  assert.ok(!flatMenu.includes('active:true'), 'a hardcoded active flag would silently re-enable hidden products');
  assert.ok(flatMenu.includes('sellingPrice'), 'selling price should be normalised before the RPC');
});

test('the product editor cannot double-submit and always resolves its loading state', () => {
  assert.ok(flatMenu.includes('if (saving) return;'), 'duplicate saves must be blocked');
  assert.match(flatMenu, /setSaving\(true\)/);
  assert.match(flatMenu, /finally \{ setSaving\(false\); \}/);
});

test('a save or cancel closes the editor and refreshes the list', () => {
  const saveBlock = flatMenu.slice(flatMenu.indexOf('const saveProduct'), flatMenu.indexOf('const uploadProductPhoto'));
  assert.ok(saveBlock.includes('setEditing(null)'), 'a successful save must close the editor');
  assert.ok(saveBlock.includes('await reload()'), 'a successful save must refresh the visible list');
  assert.ok(flatMenu.includes('onClick={() => setEditing(null)}'), 'the cancel and close controls must clear the draft');
});

test('the scroll container is pinned: panel max-height with a scrolling body', () => {
  assert.ok(flatMenu.includes('modal-panel'), 'the editor must use the shared modal frame');
  assert.ok(flatMenu.includes('modal-body'), 'the editor body must be the only scroll region');
  assert.ok(flatMenu.includes('modal-footer'), 'the footer actions must stay pinned');
});

test('price and stock controls are hidden from cashiers and storekeepers', () => {
  assert.ok(flatMenu.includes('canEditPriceAndStock(user)'));
  assert.ok(flatMenu.includes('canEditCatalogue ? ('), 'the catalogue form must be gated by the role check');
  assert.ok(flatMenu.includes('Prices and stock are managed in Store or by a manager'), 'appearance-only roles get a read-only summary');
  assert.ok(flatMenu.includes('Selling price (KES)'));
  assert.ok(flatMenu.includes('Maximum stock'));
});

test('cashier, storekeeper and store manager are routed to the visual-only editor', () => {
  // The visual permission model from PR 194: these roles never see price or stock.
  assert.match(flatMenu, /\['cashier', 'store_manager', 'storekeeper'\]/);
  assert.ok(flatMenu.includes('if (visualOnly) return <MenuVisualEditor'), 'the visual editor must short-circuit the manager view');
  assert.ok(editor.includes('Upload photo'));
  assert.ok(editor.includes('Save colours'));
  assert.ok(!editor.includes('selling_price'), 'the visual editor must not expose prices');
  assert.ok(!editor.includes('current_stock'), 'the visual editor must not expose stock');
});

test('the appearance fallback is gated and never runs the manager catalogue RPC', () => {
  const appearanceBranch = flatMenu.slice(flatMenu.indexOf('if (!canEditCatalogue) {'), flatMenu.indexOf('const name = String('));
  assert.ok(appearanceBranch.length > 0, 'the appearance-only branch must exist');
  assert.ok(appearanceBranch.includes('updatePosMenuItemVisuals'), 'appearance saves go through the restricted visuals RPC');
  assert.ok(!appearanceBranch.includes('upsertPosMenuItem'), 'the manager-gated RPC must never run for appearance-only roles');
  assert.ok(!appearanceBranch.includes(".from('products').update"), 'appearance must not bypass the visuals RPC with a table write');
  assert.ok(appearanceBranch.includes('setEditing(null)'), 'the appearance editor must close on success');
});

test('the categories tab is only offered to roles the database allows to manage categories', () => {
  assert.ok(flatMenu.includes('canManageMenuCategories(user)'));
  assert.ok(flatMenu.includes('canManageCategories'), 'the tab list is gated');
  assert.ok(flatMenu.includes("{ value: 'products', label: 'Products' }"), 'products stay available to every menu role');
});

test('ordering is persisted per row and never rewrites prices or visuals', () => {
  assert.ok(flatService.includes('reorderPosCategories(propertyId, ordered = [])'));
  assert.ok(flatService.includes('reorderPosMenuItems(propertyId, ordered = [])'));
  const categoryUpdate = flatService.slice(flatService.indexOf('reorderPosCategories(propertyId'), flatService.indexOf('updatePosMenuItemVisuals'));
  assert.ok(categoryUpdate.includes('sort_order: Number(sortOrder) || 0'), 'category reorder must only write sort_order');
  const itemUpdate = flatService.slice(flatService.indexOf('reorderPosMenuItems(propertyId'), flatService.indexOf('async createProduct'));
  assert.ok(itemUpdate.includes('pos_sort: Number(sortOrder) || 0'), 'product reorder must only write pos_sort');
});

test('visual updates use the restricted RPC from PR 194', () => {
  assert.match(flatService, /async updatePosMenuItemVisuals\(\{ propertyId, id, tile_color, tile_text_color, tile_image_url \}\)/);
  assert.ok(flatService.includes("supabase.rpc('fn_update_pos_menu_item_visuals'"));
  assert.ok(flatService.includes('p_property_id: propertyId'));
  assert.ok(flatService.includes('p_product_id: id'));
  assert.ok(!flatService.includes(".from('products').update({ tile_color"), 'visuals must not be written directly to the table');
});

test('managers can upload product photos through the shared upload helper', () => {
  assert.ok(flatService.includes('async uploadPosMenuItemImage(propertyId, file)'));
  assert.ok(flatMenu.includes('inventoryService.uploadPosMenuItemImage(propertyId, file)'));
  assert.ok(flatMenu.includes('Upload photo'), 'the product editor exposes a photo upload action');
  assert.ok(flatMenu.includes('accept=') && flatMenu.includes('image/png,image/jpeg,image/webp'));
});

test('stale responses cannot overwrite a newer reload', () => {
  assert.ok(flatMenu.includes('requestRef'), 'a request token is required');
  assert.ok(flatMenu.includes('if (requestRef.current !== requestId) return;'));
});

test('Escape closes the editor before the whole manager', () => {
  const escapeBlock = flatMenu.slice(flatMenu.indexOf("event.key !== 'Escape'"), flatMenu.indexOf("document.addEventListener('keydown', onKey)"));
  assert.ok(escapeBlock.includes('if (editing) setEditing(null);'));
  assert.ok(escapeBlock.includes('else onClose?.();'));
});

test('menu edits use the local event and postgres realtime, not a duplicate broadcast channel', () => {
  assert.ok(flatMenu.includes("window.dispatchEvent(new Event('olitech:menu-updated'))"));
  assert.ok(flatOrder.includes('inventoryService.subscribePosMenu(propertyId, refresh)'), 'the till must subscribe to menu changes');
  assert.ok(flatOrder.includes('unsubscribe()'), 'the subscription must be cleaned up');
  assert.ok(!menu.includes('notifyPosMenuChanged'), 'the duplicate broadcast module must not be used');
  assert.ok(!menu.includes('posMenuChannel'), 'the duplicate broadcast module must not be imported');
});

test('renaming or disabling a category stays consistent with its products', () => {
  assert.ok(flatService.includes('A category with that name already exists.'), 'duplicate names must be rejected before the update');
  assert.ok(flatService.includes("update({ pos_category: patch.name })"), 'renaming must move products to the new name');
  assert.ok(flatService.includes(".eq('pos_category', previousName)"), 'the cascade must target the old name only');
  assert.ok(flatOrder.includes('disabledCategoryNames.has(product.category'), 'disabled categories must hide their products from the POS');
  assert.ok(flatOrder.includes('legacy data'), 'products in an unconfigured category must stay visible');
  assert.ok(flatOrder.includes('listPosCategoriesAdmin(propertyId)'), 'the till needs the full catalogue to tell disabled from unconfigured');
});
