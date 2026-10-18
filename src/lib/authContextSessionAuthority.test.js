import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AuthContext.jsx', import.meta.url), 'utf8');

test('Supabase Auth remains the session authority without a custom localStorage token marker', () => {
  assert.equal(source.includes("localStorage.setItem('olitech_token'"), false);
  assert.equal(source.includes("localStorage.removeItem('olitech_token'"), false);
  assert.ok(source.includes('authService.login'));
  assert.ok(source.includes('authService.register'));
  assert.ok(source.includes('supabase.auth.onAuthStateChange'));
});
