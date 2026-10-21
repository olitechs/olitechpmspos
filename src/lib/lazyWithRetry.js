import { lazy } from 'react';

const RETRY_KEY_PREFIX = 'olitechs:lazy-import-retry:';

export function createRetryingImporter(importer, moduleId, browser = typeof window !== 'undefined' ? window : null) {
  const retryKey = RETRY_KEY_PREFIX + moduleId;

  return () => Promise.resolve()
    .then(importer)
    .then((module) => {
      // A successful import proves the current deployment has the module.
      // Clear a previous retry marker so a future deployment can recover too.
      try {
        browser?.sessionStorage?.removeItem(retryKey);
      } catch {
        // Storage can be disabled by browser policy; module loading still works.
      }
      return module;
    })
    .catch((error) => {
      if (!browser) throw error;

      try {
        const storage = browser.sessionStorage;
        // Only one automatic reload per module per tab session. If the same
        // chunk is still missing after reload, let the ErrorBoundary show it
        // instead of creating an infinite reload loop.
        if (storage.getItem(retryKey) === '1') throw error;
        storage.setItem(retryKey, '1');
        browser.location.reload();
      } catch {
        // If session storage is unavailable, fail safely rather than risk
        // repeated reloads. The module-level ErrorBoundary shows recovery UI.
      }

      throw error;
    });
}

export function lazyWithRetry(importer, moduleId) {
  return lazy(createRetryingImporter(importer, moduleId));
}
