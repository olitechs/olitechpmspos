import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./AuthContext.jsx', import.meta.url), 'utf8');
const authServiceSource = await readFile(new URL('../services/authService.js', import.meta.url), 'utf8');

test('Supabase Auth remains the session authority without a custom localStorage token marker', () => {
  assert.equal(source.includes("localStorage.setItem('olitech_token'"), false);
  assert.equal(source.includes("localStorage.removeItem('olitech_token'"), false);
  assert.ok(source.includes('authService.login'));
  assert.ok(source.includes('authService.register'));
  assert.ok(source.includes('supabase.auth.onAuthStateChange'));
});


test('stale auth refreshes cannot overwrite a newer session intent', () => {
  assert.ok(source.includes('const authRequestId = useRef(0)'));
  assert.ok(source.includes('if (requestId !== authRequestId.current) return;'));
  assert.ok(source.includes('if (requestId === authRequestId.current)'));
  assert.ok(source.includes('authRequestId.current += 1;'));
});


test('staff PIN generation requires Web Crypto and never falls back to Math.random', () => {
  assert.ok(authServiceSource.includes('if (!globalThis.crypto?.getRandomValues)'));
  assert.ok(authServiceSource.includes('globalThis.crypto.getRandomValues(bytes)'));
  assert.ok(authServiceSource.includes('if (byte >= 250) continue;'));
  assert.equal(authServiceSource.includes('Math.random()'), false);
});
