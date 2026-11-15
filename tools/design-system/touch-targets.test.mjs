import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const shell = read('../../src/components/layout/AppShell.jsx');
const shifts = read('../../src/components/pos/ShiftManagementPage.jsx');
const closeShift = read('../../src/components/pos/CloseShiftModal.jsx');
const css = read('../../src/index.css');

test('the shared 44px button minimum stays in place', () => {
  assert.ok(css.includes('button { min-height: 44px;'), 'the global touch-target minimum must not be removed');
});

test('navigation rows and the navigation filter meet the 44px touch target', () => {
  assert.ok(!shell.includes('min-h-9 '), 'navigation rows must not shrink below the 44px minimum');
  assert.ok(!shell.includes('className="h-9 w-full'), 'the navigation filter input must stay 44px tall');
  assert.ok(shell.includes('min-h-11'), 'navigation rows use a 44px minimum height');
  assert.ok(shell.includes('h-11 w-full'));
});

test('POS shift controls meet the 44px touch target', () => {
  for (const [name, source] of [['ShiftManagementPage', shifts], ['CloseShiftModal', closeShift]]) {
    assert.ok(!source.includes('min-h-9'), `${name} must not override the 44px minimum`);
    assert.ok(source.includes('min-h-11'), `${name} uses a 44px minimum height`);
  }
});
