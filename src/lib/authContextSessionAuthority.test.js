import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AuthContext.jsx', import.meta.url), 'utf8');

test('Supabase Auth remains the session authority without a custom localStorage token marker', () => {
  assert.doesNotMatch(source, /localStorage\\.(?:setItem|removeItem)\\(\\s*['"]olitech_token['"]/);
  assert.match(source, /authService\\.login/);
  assert.match(source, /authService\\.register/);
  assert.match(source, /supabase\\.auth\\.onAuthStateChange/);
});
