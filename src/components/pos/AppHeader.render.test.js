import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AppHeader.jsx', import.meta.url), 'utf8');

test('POS header uses the official light-theme logo and semantic token foregrounds', () => {
  assert.match(source, /BrandLogo/);
  assert.match(source, /var\(--on-primary\)/);
  assert.match(source, /aria-label="POS workflow"/);
  assert.doesNotMatch(source, /ThemeToggle|dark:|#[0-9a-f]{3,8}/i);
});
