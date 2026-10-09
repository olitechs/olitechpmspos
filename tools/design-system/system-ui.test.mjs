import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/components/ui/system.jsx', import.meta.url), 'utf8');

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
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
    assert.match(block[1], new RegExp(tone + ':'));
  }
  assert.match(block[1], /var\(--success-text\)/);
  assert.match(block[1], /var\(--warning-text\)/);
  assert.match(block[1], /var\(--danger\)/);
  assert.match(block[1], /var\(--info\)/);
  assert.doesNotMatch(block[1], /(?:emerald|amber|red|blue)-(?:50|800|950|300)/);
});

const sidebar = readFileSync(new URL('../../src/components/shell/Sidebar.jsx', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('shared primitives retain responsive overflow and stacking safeguards', () => {
  assert.match(source, /sm:flex-row sm:items-start sm:justify-between/, 'page header should stack on narrow screens');
  assert.match(source, /flex-col gap-2 sm:flex-row sm:flex-wrap/, 'filter controls should stack on narrow screens');
  assert.match(source, /w-full overflow-x-auto/, 'data tables should scroll horizontally instead of forcing page width');
  assert.match(source, /overflow-x-auto border-b/, 'tabs should remain usable when they do not fit');
  assert.match(source, /min-w-0 flex-1/, 'flex content should be allowed to shrink without overflow');
});

test('sidebar has accessible mobile open/close controls and a scrollable navigation region', () => {
  assert.match(sidebar, /aria-label="OliTechs dashboard navigation"/);
  assert.match(sidebar, /aria-label="Open navigation"/);
  assert.match(sidebar, /aria-label="Close navigation"/);
  assert.match(sidebar, /md:translate-x-0/, 'sidebar should return to its desktop position at the medium breakpoint');
  assert.match(sidebar, /-translate-x-\[calc\(100%\+16px\)\]/, 'closed mobile sidebar should sit off canvas');
  assert.match(sidebar, /min-h-0 flex-1 overflow-y-auto/, 'long navigation should scroll independently');
  assert.match(sidebar, /aria-label="Search navigation"/, 'navigation search should be labelled for assistive technology');
});

test('theme foundation includes light/dark semantic tokens and reduced-motion handling', () => {
  assert.match(theme, /:root\s*\{[\s\S]*?--bg:/);
  assert.match(theme, /\[data-theme="dark"\]/);
  assert.match(theme, /\.dark\s*\{/);
  assert.match(theme, /prefers-reduced-motion:\s*reduce/);
  for (const token of ['--surface', '--surface-2', '--border', '--text', '--muted', '--focus']) {
    assert.match(theme, new RegExp(token + ':'));
  }
});
