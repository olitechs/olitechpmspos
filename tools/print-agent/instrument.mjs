import * as Sentry from '@sentry/node';

const SAFE_ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'AbortError',
]);
const safeTag = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(value);

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  release: process.env.SENTRY_RELEASE || undefined,
  sendDefaultPii: false,
  maxBreadcrumbs: 0,
  beforeSend(event) {
    // Preserve only operational metadata. Exception messages and request/user
    // context can contain guest, payment, receipt or printer information.
    delete event.user;
    delete event.request;
    delete event.extra;
    delete event.contexts;
    delete event.message;
    event.breadcrumbs = [];
    const tags = Object.fromEntries(Object.entries(event.tags || {})
      .filter(([key, value]) => /^[a-zA-Z0-9_.-]{1,32}$/.test(key) && safeTag(value))
      .slice(0, 8));
    event.tags = { component: 'print-agent', ...tags };
    for (const exception of event.exception?.values || []) {
      exception.type = SAFE_ERROR_TYPES.has(exception.type) ? exception.type : 'Error';
      exception.value = 'Unexpected Print Agent failure (details withheld to protect customer and printer data).';
      for (const frame of exception.stacktrace?.frames || []) {
        frame.filename = 'app://print-agent';
        frame.function = '<anonymous>';
        delete frame.vars;
        delete frame.abs_path;
        delete frame.module;
        delete frame.package;
        delete frame.in_app;
      }
    }
    return event;
  },
});

export { Sentry };
