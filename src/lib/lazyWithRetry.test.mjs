import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryingImporter } from './lazyWithRetry.js';

function createBrowser() {
  const values = new Map();
  let reloads = 0;
  return {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    location: { reload: () => { reloads += 1; } },
    get reloads() { return reloads; },
    values,
  };
}

test('failed lazy import triggers one reload to pick up the current deployment', async () => {
  const browser = createBrowser();
  const load = createRetryingImporter(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), 'rooms', browser);
  await assert.rejects(load(), /Failed to fetch dynamically imported module/);
  assert.equal(browser.reloads, 1);
  assert.equal(browser.sessionStorage.getItem('olitechs:lazy-import-retry:rooms'), '1');
});

test('repeated failure after reload does not create an infinite reload loop', async () => {
  const browser = createBrowser();
  const load = createRetryingImporter(() => Promise.reject(new Error('chunk still missing')), 'rooms', browser);
  await assert.rejects(load(), /chunk still missing/);
  await assert.rejects(load(), /chunk still missing/);
  assert.equal(browser.reloads, 1);
});

test('successful import clears the retry marker for future deployments', async () => {
  const browser = createBrowser();
  browser.sessionStorage.setItem('olitechs:lazy-import-retry:rooms', '1');
  const module = { default: function Rooms() {} };
  const load = createRetryingImporter(() => Promise.resolve(module), 'rooms', browser);
  assert.equal(await load(), module);
  assert.equal(browser.sessionStorage.getItem('olitechs:lazy-import-retry:rooms'), null);
  assert.equal(browser.reloads, 0);
});

test('server-side or non-browser failure is propagated without reload', async () => {
  const load = createRetryingImporter(() => Promise.reject(new Error('offline')), 'rooms', null);
  await assert.rejects(load(), /offline/);
});
