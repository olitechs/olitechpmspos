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
  const block = source.match(/const STATUS_TONES = \\{([\\s\\S]*?)\\n\\};/);
  assert.ok(block, 'STATUS_TONES map should exist');
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
    assert.match(block[1], new RegExp(tone + ':'));
  }
  assert.match(block[1], /var\\(--success-text\\)/);
  assert.match(block[1], /var\\(--warning-text\\)/);
  assert.match(block[1], /var\\(--danger\\)/);
  assert.match(block[1], /var\\(--info\\)/);
  assert.doesNotMatch(block[1], /(?:emerald|amber|red|blue)-(?:50|800|950|300)/);
});
