/**
 * Fixed-window rate limiter for the local print API.
 *
 * The agent listens on loopback, but any page the browser loads can attempt a
 * request to it, and a buggy retry loop can otherwise hammer a printer with
 * hundreds of copies. Limits are per client address and per route class, and are
 * deliberately generous enough that a real busy service never notices them.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMITS = Object.freeze({ print: 60, queue: 30, discover: 6, pair: 5, default: 120 });

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  limits = {},
  now = () => Date.now(),
  maxKeys = 2000,
} = {}) {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  const buckets = new Map();

  function prune(timestamp) {
    if (buckets.size <= maxKeys) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(key);
    }
    // Still too many live keys (a flood of spoofed addresses): drop the oldest.
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  function check(clientKey, routeClass = 'default') {
    const timestamp = now();
    const limit = Number(resolvedLimits[routeClass] ?? resolvedLimits.default);
    const key = `${routeClass}:${clientKey || 'local'}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= limit;
    prune(timestamp);

    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000)),
    };
  }

  return {
    check,
    get windowMs() { return windowMs; },
    get size() { return buckets.size; },
    reset() { buckets.clear(); },
  };
}
