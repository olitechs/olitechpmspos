import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20261119180000_pos_menu_visual_permissions_live_sync.sql');
const editor = read('./MenuVisualEditor.jsx');
const manager = read('./MenuManager.jsx');
const inventory = read('../../services/inventoryService.js');
const order = read('./OrderTaking.jsx');

test('cashier and storekeeper visual edits use a dedicated server permission', () => {
  assert.match(migration, /can_edit_pos_menu_visuals/);
  assert.match(migration, /fn_update_pos_menu_item_visuals/);
  assert.match(migration, /tile_color = p_tile_color[\s\S]*tile_text_color = p_tile_text_color[\s\S]*tile_image_url = p_tile_image_url/);
  assert.match(manager, /\['cashier', 'store_manager', 'storekeeper'\]/);
  assert.match(manager, /MenuVisualEditor/);
});

test('visual-only editor does not expose product price or stock inputs', () => {
  assert.match(editor, /Upload photo/);
  assert.match(editor, /Tile colour/);
  assert.match(editor, /Save colours/);
  assert.doesNotMatch(editor, /selling_price|current_stock|min_stock|max_stock/);
});

test('POS menu visual writes use the restricted RPC and live subscriptions refresh the menu', () => {
  assert.match(inventory, /fn_update_pos_menu_item_visuals/);
  assert.match(inventory, /subscribePosMenu/);
  assert.match(order, /subscribePosMenu\(propertyId, refresh\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.products/);
});
