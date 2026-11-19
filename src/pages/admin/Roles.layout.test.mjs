import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const roles = readFileSync(new URL('./Roles.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../components/layout/AppShell.jsx', import.meta.url), 'utf8');

test('employee editor remains reachable and scrollable on short and narrow viewports', () => {
  assert.match(roles, /fixed inset-0[^"]*overflow-y-auto/);
  assert.match(roles, /max-h-\[calc\(100dvh-1rem\)\]/);
  assert.match(roles, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(roles, /flex shrink-0 justify-end/);
});

test('employee editor keeps its save actions visible outside the scrolling form body', () => {
  assert.match(roles, /overflow-y-auto overscroll-contain p-5/);
  assert.match(roles, /shrink-0 justify-end gap-2 border-t/);
  assert.match(roles, /Save Staff/);
});

test('sidebar collapse control is accessible and sidebar navigation can scroll independently', () => {
  assert.match(shell, /aria-controls="app-shell-sidebar-navigation"/);
  assert.match(shell, /aria-expanded=\{!collapsed\}/);
  assert.match(shell, /id="app-shell-sidebar-navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain/);
});
