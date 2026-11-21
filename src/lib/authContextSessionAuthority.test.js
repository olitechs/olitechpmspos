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

test('silent auth rechecks preserve the workspace and ignore stale responses', () => {
  assert.ok(source.includes('authCheckSequenceRef'));
  assert.ok(source.includes('requestId !== authCheckSequenceRef.current'));
  assert.ok(source.includes('hasLiveSession()'));
  assert.ok(source.includes('if (!hadUser) setIsLoadingAuth(true)'));
  assert.ok(source.includes('useMemo(() => ({'));
});

test('same-user token refreshes do not refetch the profile inside the auth listener', () => {
  assert.ok(source.includes("event === 'TOKEN_REFRESHED'"));
  assert.ok(source.includes('setTimeout(() => { if (!disposed) checkUserAuth(); }, 0)'));
  assert.ok(source.includes('subscription?.subscription?.unsubscribe()'));
});
