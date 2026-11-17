import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentryReporter } from './sentry.mjs';
const DSN = 'https://publickey@example.ingest.sentry.io/12345';
test('disabled when DSN is absent or invalid', async () => {
  const reporter = createSentryReporter({ dsn: '' });
  assert.equal(reporter.enabled, false);
  assert.equal(await reporter.captureException(new Error('test')), false);
  assert.equal(await reporter.flush(), true);
});
test('sends a Sentry envelope with safe event metadata', async () => {
  let request;
  const reporter = createSentryReporter({ dsn: DSN, environment: 'staging', release: '2.2.0', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true }; } });
  await reporter.captureException(Object.assign(new Error('Guest Jane Doe, card 4111111111111111'), { code: 'PRINTER_FAILED' }), { operation: 'startup' });
  assert.match(request.url, /api\/12345\/envelope/);
  assert.equal(request.options.headers['content-type'], 'application/x-sentry-envelope');
  const [, header, payload] = request.options.body.split('\n');
  assert.equal(JSON.parse(header).type, 'event');
  const event = JSON.parse(payload);
  assert.equal(event.platform, 'node'); assert.equal(event.environment, 'staging');
  assert.equal(event.release, '2.2.0'); assert.equal(event.tags.operation, 'startup');
  assert.doesNotMatch(request.options.body, /Jane Doe|4111111111111111|card/);
  assert.match(event.exception.values[0].value, /details withheld/);
});
test('transport errors never escape into the Print Agent', async () => {
  const reporter = createSentryReporter({ dsn: DSN, fetchImpl: async () => { throw new Error('network unavailable'); } });
  assert.equal(await reporter.captureException(new Error('failure')), false);
  assert.equal(await reporter.flush(), true);
});
test('rejects unsafe tag values', async () => {
  let body = '';
  const reporter = createSentryReporter({ dsn: DSN, fetchImpl: async (_url, options) => { body = options.body; } });
  await reporter.captureException(new Error('failure'), { guest: 'Jane Doe', operation: 'print-job' });
  const event = JSON.parse(body.split('\n')[2]);
  assert.equal(event.tags.guest, undefined); assert.equal(event.tags.operation, 'print-job');
});
