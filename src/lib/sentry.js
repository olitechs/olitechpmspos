const VITE_ENV = import.meta.env || {};
const DEFAULT_DSN = VITE_ENV.VITE_SENTRY_DSN || '';
const DEFAULT_ENVIRONMENT = VITE_ENV.MODE || 'production';
const DEFAULT_RELEASE = VITE_ENV.VITE_SENTRY_RELEASE || undefined;

function parseDsn(value) {
  try {
    const url = new URL(String(value || ''));
    const projectId = url.pathname.split('/').filter(Boolean).at(-1);
    if (!['https:', 'http:'].includes(url.protocol) || !url.username || !projectId) return null;
    return { key: decodeURIComponent(url.username), host: url.host, projectId, path: url.pathname.split('/').filter(Boolean).slice(0, -1).join('/') };
  } catch { return null; }
}

function safeLabel(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64) || 'application';
}

function safeErrorType(error) {
  const allowed = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError']);
  return allowed.has(error?.name) ? error.name : 'Error';
}

function stackFrames(error) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return String(error?.stack || '').split('\n').slice(1).flatMap((line) => {
    const chrome = line.match(/^\s*at (?:(.*?) \()?((?:https?:\/\/|\/)[^()]+?):(\d+):(\d+)\)?$/);
    const firefox = line.match(/^(.*?)@((?:https?:\/\/)[^@]+):(\d+):(\d+)$/);
    const match = chrome || firefox;
    if (!match) return [];
    let filename = match[2];
    try {
      const url = new URL(filename, origin || 'https://localhost');
      url.search = ''; url.hash = ''; filename = url.href;
    } catch { filename = filename.split(/[?#]/, 1)[0]; }
    return [{ filename: 'app://frontend', function: '<anonymous>', lineno: Number(match[3]), colno: Number(match[4]), in_app: true }];
  }).slice(0, 30);
}

export function createBrowserSentryReporter({
  dsn = DEFAULT_DSN, environment = DEFAULT_ENVIRONMENT, release = DEFAULT_RELEASE,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const parsed = parseDsn(dsn);
  if (!parsed) return { enabled: false, captureException: () => false };
  const endpoint = `https://${parsed.host}/${parsed.path ? `${parsed.path}/` : ''}api/${parsed.projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(parsed.key)}&sentry_client=olitechs-browser/1.0`;

  const captureException = (error, tags = {}) => {
    const eventId = globalThis.crypto.randomUUID().replace(/-/g, '');
    const safeTags = Object.fromEntries(Object.entries(tags).filter(([key, value]) =>
      /^[a-zA-Z0-9_.-]{1,32}$/.test(key) && typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(value)
    ).slice(0, 8));
    const frames = stackFrames(error);
    const event = {
      event_id: eventId, timestamp: Date.now() / 1000, platform: 'javascript', level: 'error',
      environment: safeLabel(environment), ...(release ? { release: safeLabel(release) } : {}),
      ...(Object.keys(safeTags).length ? { tags: safeTags } : {}),
      exception: { values: [{
        type: safeErrorType(error),
        value: 'Unhandled application error (details withheld to protect customer data).',
        ...(frames.length ? { stacktrace: { frames: frames.reverse() } } : {}),
      }] },
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }), JSON.stringify(event),
    ].join('\n');
    try {
      return fetchImpl(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' },
        body: envelope, keepalive: true, mode: 'cors', credentials: 'omit',
      }).then(() => true).catch(() => false);
    } catch { return false; }
  };
  return { enabled: true, captureException };
}

let reporter;
let initialized = false;
export function initSentry() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  reporter = createBrowserSentryReporter();
  if (!reporter.enabled) return;
  window.addEventListener('error', (event) => reporter.captureException(event.error || new Error('Window error'), { source: 'window' }));
  window.addEventListener('unhandledrejection', (event) => reporter.captureException(
    event.reason instanceof Error ? event.reason : new Error('Unhandled promise rejection'), { source: 'promise' },
  ));
}
export function captureException(error, tags = {}) {
  if (!reporter) reporter = createBrowserSentryReporter();
  return reporter.captureException(error, tags);
}
