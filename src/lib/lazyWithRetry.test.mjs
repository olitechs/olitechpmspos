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

const RETRY_KEY = 'olitechs:lazy-import-retry:rooms';
const failedImport = (message = 'Failed to fetch dynamically imported module') => () => Promise.reject(new Error(message));

test('failed lazy import records a timestamp and reloads to pick up the current deployment', async () => {
  const browser = createBrowser();
  const load = createRetryingImporter(failedImport(), 'rooms', browser, () => 100_000);
  await assert.rejects(load(), /Failed to fetch dynamically imported module/);
  assert.equal(browser.reloads, 1);
  assert.equal(browser.sessionStorage.getItem(RETRY_KEY), '100000');
});

test('a repeated failure within the cooldown does not create an infinite reload loop', async () => {
  const browser = createBrowser();
  const load = createRetryingImporter(failedImport('chunk still missing'), 'rooms', browser, () => 100_000);
  await assert.rejects(load(), /chunk still missing/);
  await assert.rejects(load(), /chunk still missing/);
  assert.equal(browser.reloads, 1);
});

test('an old retry marker does not block recovery after a later deployment', async () => {
  const browser = createBrowser();
  browser.sessionStorage.setItem(RETRY_KEY, '1000');
  const load = createRetryingImporter(failedImport('stale chunk'), 'rooms', browser, () => 100_000);
  await assert.rejects(load(), /stale chunk/);
  assert.equal(browser.reloads, 1);
  assert.equal(browser.sessionStorage.getItem(RETRY_KEY), '100000');
});

test('successful import clears the retry marker for future deployments', async () => {
  const browser = createBrowser();
  browser.sessionStorage.setItem(RETRY_KEY, '1');
  const module = { default: function Rooms() {} };
  const load = createRetryingImporter(() => Promise.resolve(module), 'rooms', browser);
  assert.equal(await load(), module);
  assert.equal(browser.sessionStorage.getItem(RETRY_KEY), null);
  assert.equal(browser.reloads, 0);
});

test('server-side or non-browser failure is propagated without reload', async () => {
  const load = createRetryingImporter(failedImport('offline'), 'rooms', null);
  await assert.rejects(load(), /offline/);
});
