import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AppHeader.jsx', import.meta.url), 'utf8');

test('POS header imports every runtime component and theme token it renders', () => {
  assert.match(source, /import\s+ThemeToggle\s+from\s+['"]@\/components\/ui\/ThemeToggle['"]/);
  assert.match(source, /import\s*\{[^}]*\bTEAL_LIGHT\b[^}]*\}\s*from\s*['"]@\/data\/themePalette['"]/);
  assert.match(source, /<ThemeToggle\s+compact\s*\/>/);
  assert.match(source, /color:\s*TEAL_LIGHT/);
});
