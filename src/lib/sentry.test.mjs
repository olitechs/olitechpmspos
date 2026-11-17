import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSentryReporter } from './sentry.js';
const DSN = 'https://publickey@example.ingest.sentry.io/12345';
test('browser reporter stays disabled without a valid DSN', () => {
  const reporter = createBrowserSentryReporter({ dsn: '' });
  assert.equal(reporter.enabled, false);
  assert.equal(reporter.captureException(new Error('ignored')), false);
});
test('browser reporter sends sanitized Sentry envelopes without customer messages', async () => {
  let request;
  const reporter = createBrowserSentryReporter({ dsn: DSN, environment: 'production', fetchImpl: async (url, options) => { request = { url, options }; } });
  await reporter.captureException(new Error('Guest Jane Doe and email jane@example.com'), { source: 'window' });
  assert.match(request.url, /api\/12345\/envelope/);
  const event = JSON.parse(request.options.body.split('\n')[2]);
  assert.equal(event.platform, 'javascript');
  assert.equal(event.environment, 'production');
  assert.equal(event.tags.source, 'window');
  assert.doesNotMatch(request.options.body, /Jane Doe|jane@example.com/);
});
