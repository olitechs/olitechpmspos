import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/ui/system.jsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../../src/components/shell/Sidebar.jsx', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const roomPlanner = readFileSync(new URL('../../src/components/pms/RoomPlanner.jsx', import.meta.url), 'utf8');

test('shared operational UI exports the Phase 1 primitives', () => {
  for (const component of [
    'PageHeader', 'Card', 'StatTile', 'StatusBadge', 'EmptyState', 'Skeleton',
    'FilterBar', 'DataTable', 'ConfirmDialog', 'Drawer', 'Tabs',
    'SegmentedControl', 'FormField',
  ]) {
    assert.match(source, new RegExp('export function ' + component + '\\b'), component + ' should be exported');
  }
});

test('status badges use semantic theme tokens instead of fixed palette colors', () => {
  const block = source.match(/const STATUS_TONES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'STATUS_TONES map should exist');
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) assert.match(block[1], new RegExp(tone + ':'));
  assert.match(block[1], /var\(--success-text\)/);
  assert.match(block[1], /var\(--warning-text\)/);
  assert.match(block[1], /var\(--danger-text\)/);
  assert.match(block[1], /var\(--primary\)/);
  assert.doesNotMatch(block[1], /(?:emerald|amber|red|blue)-(?:50|800|950|300)/);
});

test('shared primitives retain responsive overflow and stacking safeguards', () => {
  assert.match(source, /sm:flex-row sm:items-start sm:justify-between/);
  assert.match(source, /flex-col gap-2 sm:flex-row sm:flex-wrap/);
  assert.match(source, /w-full overflow-x-auto/);
  assert.match(source, /overflow-x-auto border-b/);
  assert.match(source, /min-w-0 flex-1/);
});

test('sidebar has accessible mobile open/close controls and a scrollable navigation region', () => {
  assert.match(sidebar, /aria-label="OliTechs dashboard navigation"/);
  assert.match(sidebar, /aria-label="Open navigation"/);
  assert.match(sidebar, /aria-label="Close navigation"/);
  assert.match(sidebar, /md:translate-x-0/);
  assert.match(sidebar, /-translate-x-\[calc\(100%\+16px\)\]/);
  assert.match(sidebar, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(sidebar, /aria-label="Search navigation"/);
});

test('theme foundation defines canonical light and dark palettes with reduced-motion handling', () => {
  for (const token of [
    '--canvas:#F4F7F8', '--surface:#FFFFFF', '--primary:#0F7C86',
    '--on-primary:#FFFFFF', '--text:#14232B', '--text-muted:#4F646D',
    '--table-free-bg:#74C365', '--table-occupied-bg:#FA003F', '--table-bill-bg:#FAFAFA',
  ]) assert.ok(theme.includes(token), 'missing light token ' + token);
  assert.ok(theme.includes(':root[data-theme="dark"]'));
  for (const token of [
    '--canvas:#10171A', '--surface:#172126', '--primary:#137682',
    '--on-primary:#F2F8F9', '--text:#E3EBED', '--text-muted:#9DB0B8',
  ]) assert.ok(theme.includes(token), 'missing dark token ' + token);
  assert.ok(theme.includes('color-scheme: light'));
  assert.ok(theme.includes('color-scheme:dark'));
  assert.ok(theme.includes('prefers-reduced-motion:reduce'));
  for (const token of ['--surface', '--surface-2', '--border', '--text', '--muted', '--focus']) {
    assert.match(theme, new RegExp(token + ':'));
  }
});

test('mobile sidebar exposes expanded state and closes with Escape', () => {
  assert.match(sidebar, /aria-expanded=\{mobileOpen\}/);
  assert.match(sidebar, /event\.key===\"Escape\"/);
});


test('Room Planner toolbar exposes the approved controls and responsive dimensions', () => {
  for (const label of ['Add Closures', 'New reservation', 'Today', 'Start date', 'End date', 'Select month']) {
    assert.ok(roomPlanner.includes(label), 'missing toolbar control: ' + label);
  }
  assert.match(roomPlanner, /width:141/);
  assert.match(roomPlanner, /width:131/);
  assert.match(roomPlanner, /width:267/);
  assert.match(roomPlanner, /width:130/);
  assert.match(roomPlanner, /height:38px/);
  assert.match(roomPlanner, /@media\(max-width:1099px\)/);
  assert.match(roomPlanner, /shiftVisibleRange\(-15\)/);
  assert.match(roomPlanner, /shiftVisibleRange\(15\)/);
  assert.match(roomPlanner, /dateKey\(subDays\(todayDate, 9\)\)/);
  assert.match(roomPlanner, /dateKey\(addDays\(todayDate, 19\)\)/);
  assert.match(roomPlanner, /onClick=\{addClosure\}/);
  assert.match(roomPlanner, /onClick=\{\(\) => openCreate/);
});
