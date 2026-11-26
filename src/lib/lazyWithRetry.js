import { lazy } from 'react';

const RETRY_KEY_PREFIX = 'olitechs:lazy-import-retry:';
// A stale deployment can leave an old marker in sessionStorage indefinitely.
// Keep the loop guard, but allow another recovery attempt after a short cooldown.
const RETRY_COOLDOWN_MS = 30_000;

export function createRetryingImporter(
  importer,
  moduleId,
  browser = typeof window !== 'undefined' ? window : null,
  now = () => Date.now(),
) {
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
        const previousAttempt = Number(storage.getItem(retryKey));
        const retryIsRecent = Number.isFinite(previousAttempt)
          && previousAttempt > 0
          && now() - previousAttempt < RETRY_COOLDOWN_MS;

        // A recent failure means the page has already reloaded and the chunk
        // is still unavailable. Show the ErrorBoundary instead of looping.
        // An old marker is stale and must not block recovery from a later deploy.
        if (retryIsRecent) throw error;

        storage.setItem(retryKey, String(now()));
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
