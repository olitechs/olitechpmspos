import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const floor = read('./FloorPlan.jsx');
const order = read('./OrderTaking.jsx');
const manager = read('./MenuManager.jsx');
const inventory = read('../../services/inventoryService.js');

test('round floor tables use a centered, bounded content layout', () => {
  assert.match(floor, /shape === 'circle'[\s\S]*?items-center justify-center[\s\S]*?line-clamp-2/);
  assert.match(floor, /height:geometry\.height/);
});

test('POS menu tiles match the compact photo-first menu layout', () => {
  assert.ok(order.includes('repeat(auto-fill,minmax(112px,1fr))'));
  assert.ok(order.includes('h-[142px]'));
  assert.ok(order.includes('h-[88px]'));
  assert.ok(order.includes('object-contain'));
  assert.ok(order.includes('const hasPhoto = Boolean(item.tile_image_url)'));
  assert.ok(order.includes("backgroundColor: item.tile_color || 'var(--surface)'"));
  assert.ok(order.includes('text-[var(--danger-text)]'));
  assert.ok(order.includes('line-clamp-2'));
  assert.ok(order.includes('onClick={() => addItem(item)}'));
});
test('product editor supports photo upload, preview and bounded scrolling', () => {
  assert.match(manager, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(manager, /Product photo/);
  assert.ok(manager.includes('max-h-[90dvh]'));
  assert.ok(manager.includes('overflow-y-auto'));
  assert.match(inventory, /uploadPosMenuItemImage/);
  assert.match(inventory, /5 \* 1024 \* 1024/);
  assert.match(inventory, /from\('property-logos'\)/);
});
