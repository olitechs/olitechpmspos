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

test('POS menu prices remain readable over custom tile colours and photos', () => {
  assert.ok(order.includes('bg-[var(--surface)] px-2 py-1 text-sm font-extrabold tabular-nums text-[var(--text)]'));
  assert.match(order, /repeat\(auto-fill,minmax\(116px,1fr\)\)/);
});

test('product editor supports photo upload, preview and bounded scrolling', () => {
  assert.match(manager, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(manager, /Product photo/);
  assert.match(manager, /max-h-\[90dvh\] overflow-y-auto/);
  assert.match(inventory, /uploadPosMenuItemImage/);
  assert.match(inventory, /5 \* 1024 \* 1024/);
  assert.match(inventory, /from\('property-logos'\)/);
});
