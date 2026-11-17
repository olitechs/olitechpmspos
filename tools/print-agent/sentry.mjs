import * as Sentry from '@sentry/node';

const SAFE_TAG = /^[a-zA-Z0-9_.-]{1,64}$/;
const SAFE_TAG_KEYS = new Set(['component', 'phase', 'source', 'operation']);

export function createSentryReporter({ sdk = Sentry, enabled = Boolean(process.env.SENTRY_DSN) } = {}) {
  if (!enabled) {
    return {
      enabled: false,
      captureException: () => false,
      flush: async () => true,
    };
  }

  return {
    enabled: true,
    captureException(error, tags = {}) {
      const safeTags = Object.fromEntries(Object.entries(tags).filter(([key, value]) =>
        SAFE_TAG_KEYS.has(key) && typeof value === 'string' && SAFE_TAG.test(value)
      ).slice(0, 8));
      try {
        sdk.captureException(error, { tags: safeTags });
        return true;
      } catch {
        // Monitoring must never interfere with printing or agent startup.
        return false;
      }
    },
    async flush(timeoutMs = 2000) {
      try {
        return await sdk.flush(timeoutMs);
      } catch {
        return false;
      }
    },
  };
}

export const sentry = createSentryReporter();
