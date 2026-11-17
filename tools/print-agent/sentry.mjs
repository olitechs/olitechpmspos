import { randomUUID } from 'node:crypto';

function parseDsn(value) {
  try {
    const url = new URL(String(value || ''));
    const parts = url.pathname.split('/').filter(Boolean);
    const projectId = parts.pop();
    if (!['https:', 'http:'].includes(url.protocol) || !url.username || !projectId) return null;
    return { key: decodeURIComponent(url.username), host: url.host, projectId, path: parts.join('/') };
  } catch { return null; }
}
const safeLabel = (value, fallback = 'Error') => String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64) || fallback;
const safeErrorType = (error) => ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError'].includes(error?.name) ? error.name : 'Error';
function stackFrames(error) {
  return String(error?.stack || '').split('\n').slice(1, 31).flatMap((line) => {
    const match = line.match(/^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!match) return [];
    return [{ filename: 'app://print-agent', function: '<anonymous>', lineno: Number(match[3]), colno: Number(match[4]), in_app: true }];
  }).reverse();
}

export function createSentryReporter({
  dsn = process.env.SENTRY_DSN,
  environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  release = process.env.SENTRY_RELEASE || undefined,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const parsed = parseDsn(dsn);
  if (!parsed) return { enabled: false, captureException: async () => false, flush: async () => true };
  const endpoint = `https://${parsed.host}/${parsed.path ? `${parsed.path}/` : ''}api/${parsed.projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(parsed.key)}&sentry_client=olitechs-print-agent/1.0`;
  const pending = new Set();
  const captureException = (error, tags = {}) => {
    const eventId = randomUUID().replace(/-/g, '');
    const safeTags = Object.fromEntries(Object.entries(tags).filter(([key, value]) =>
      /^[a-zA-Z0-9_.-]{1,32}$/.test(key) && typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(value)
    ).slice(0, 8));
    const frames = stackFrames(error);
    const event = {
      event_id: eventId, timestamp: Date.now() / 1000, platform: 'node', level: 'error',
      environment: safeLabel(environment, 'production'), ...(release ? { release: safeLabel(release) } : {}),
      tags: { component: 'print-agent', ...safeTags },
      exception: { values: [{
        type: safeErrorType(error),
        value: 'Unexpected Print Agent failure (details withheld to protect customer and printer data).',
        ...(frames.length ? { stacktrace: { frames } } : {}),
      }] },
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }), JSON.stringify(event),
    ].join('\n');
    const request = Promise.resolve().then(() => fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' },
      body: envelope, signal: AbortSignal.timeout(2500),
    })).then(() => true).catch(() => false).finally(() => pending.delete(request));
    pending.add(request);
    return request;
  };
  const flush = async (timeoutMs = 2500) => {
    if (!pending.size) return true;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([Promise.allSettled([...pending]), timeout]);
    clearTimeout(timer);
    return pending.size === 0;
  };
  return { enabled: true, captureException, flush };
}
export const sentry = createSentryReporter();
