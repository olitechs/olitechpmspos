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

test('POS menu tiles use a six-column responsive grid with readable price chips', () => {
  assert.ok(order.includes("repeat(auto-fit, minmax(max(112px, calc((100% - 50px) / 6)), 1fr))"));
  assert.ok(order.includes("maxWidth: '1190px'"));
  assert.ok(order.includes('h-[142px]'));
  assert.ok(order.includes('h-[64px]'));
  assert.ok(order.includes('min-h-[22px] w-full shrink-0'));
  assert.ok(order.includes('top-[52px] z-10 rounded bg-[var(--danger)]/95'));
  assert.ok(!order.includes('absolute inset-x-0 bottom-0 bg-[var(--danger)]/90'));
  assert.ok(order.includes('object-contain'));
  assert.ok(order.includes('const hasPhoto = Boolean(item.tile_image_url)'));
  assert.ok(order.includes("backgroundColor: item.tile_color || 'var(--primary)'"));
  assert.ok(order.includes("color: 'var(--on-primary)'"));
  assert.ok(order.includes("backgroundColor: menuCategoryStyles[cat]?.tile_color || 'var(--primary)'"));
  assert.ok(order.includes('color: \'var(--on-primary)\''));
  assert.ok(!order.includes('hover:-translate-y-0.5'));
  assert.ok(!order.includes('active:scale-[.98]'));
  assert.ok(!order.includes('hover:brightness-105'));
  assert.ok(!order.includes('transition-all hover:-translate-y'));
  assert.ok(!order.includes('categoryStyleFor(cat)'));
  assert.ok(order.includes('bg-[var(--surface)] px-1.5 py-0.5 text-center text-xs font-extrabold tabular-nums text-[var(--danger-text)]'));
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
