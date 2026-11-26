// Pure routing/decision logic for the local print agent. No React, no Supabase:
// every network call is injected so the failure diagnosis is testable without a
// printer, a browser or a database.
//
// A cashier sees "[LOCAL_AGENT_UNAVAILABLE] Start the agent" for two very
// different problems: the service really is down, or it is running but refuses
// the browser's origin (the CORS response is then unreadable to the page). The
// no-cors health probe tells them apart so the message tells staff what to fix.

export const DEFAULT_LOCAL_AGENT_URL = 'http://127.0.0.1:8631';
export const AGENT_UNAVAILABLE_CODE = 'LOCAL_AGENT_UNAVAILABLE';
export const AGENT_ORIGIN_BLOCKED_CODE = 'LOCAL_AGENT_ORIGIN_NOT_ALLOWED';

/** Accept a configured agent URL and reduce it to a bare http(s) origin. */
export function normalizeAgentBase(value, fallback = DEFAULT_LOCAL_AGENT_URL) {
  let base = String(value ?? '').trim();
  if (!base) return fallback;
  // Reject other schemes explicitly; prepending http:// to ftp:// would turn a
  // typo into a plausible-looking but wrong loopback address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base) && !/^https?:\/\//i.test(base)) return fallback;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  try {
    const parsed = new URL(base);
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback;
    base = parsed.origin;
  } catch (_) {
    return fallback;
  }
  return base.replace(/\/+$/, '') || fallback;
}

/**
 * Try the printer's saved agent URL first, then the standard loopback agent.
 * A stale or mistyped saved URL must not make a healthy local agent look dead.
 */
export function agentBaseCandidates(value) {
  const bases = [];
  const add = (base) => {
    if (base && !bases.includes(base)) bases.push(base);
  };
  add(normalizeAgentBase(value, null));
  add(DEFAULT_LOCAL_AGENT_URL);
  add('http://localhost:8631');
  return bases;
}

export function localAgentUnavailableMessage({ origin = '', originReachable = false } = {}) {
  if (originReachable) {
    const target = origin ? ` ${origin}` : ' this website';
    return `The local print agent is running but has not allowed${target}. Add this website's exact address to the agent's allowed origins under Settings → Printers, then retry.`;
  }
  return 'The local print agent could not be reached. Start the OliTechs Print Agent on this workstation and make sure this website is allowed under Settings → Printers.';
}

/**
 * A no-cors GET /health is readable even when the CORS-protected /print route
 * is blocked. An opaque response means the agent answered; a thrown fetch means
 * it did not. This never changes agent state and leaves /health public.
 */
export async function probeAgentReachable(base, { fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  if (typeof fetchImpl !== 'function' || !base) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(`${base}/health`, {
      mode: 'no-cors',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return Boolean(response && (response.type === 'opaque' || response.ok === true));
  } catch (_) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Code/message pair used when every agent candidate failed. */
export function describeAgentFailure({ origin = '', originReachable = false } = {}) {
  return {
    ok: false,
    code: originReachable ? AGENT_ORIGIN_BLOCKED_CODE : AGENT_UNAVAILABLE_CODE,
    message: localAgentUnavailableMessage({ origin, originReachable }),
  };
}
