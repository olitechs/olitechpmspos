import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentryReporter } from './sentry.mjs';

test('disabled when the DSN is absent', async () => {
  const reporter = createSentryReporter({ enabled: false, sdk: {} });
  assert.equal(reporter.enabled, false);
  assert.equal(reporter.captureException(new Error('ignored')), false);
  assert.equal(await reporter.flush(), true);
});

test('uses the official SDK captureException API with safe tags', async () => {
  const calls = [];
  const sdk = {
    captureException: (...args) => { calls.push(args); },
    flush: async (timeout) => timeout === 1800,
  };
  const reporter = createSentryReporter({ enabled: true, sdk });
  assert.equal(reporter.captureException(new Error('Guest Jane Doe, card 4111111111111111'), {
    operation: 'print-job',
    guest: 'Jane Doe',
    invalid: 'contains spaces',
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].tags.operation, 'print-job');
  assert.equal(calls[0][1].tags.guest, undefined);
  assert.equal(calls[0][1].tags.invalid, undefined);
  assert.equal(await reporter.flush(1800), true);
});

test('SDK errors are isolated from Print Agent operations', async () => {
  const reporter = createSentryReporter({
    enabled: true,
    sdk: {
      captureException() { throw new Error('transport failed'); },
      async flush() { throw new Error('flush failed'); },
    },
  });
  assert.equal(reporter.captureException(new Error('failure')), false);
  assert.equal(await reporter.flush(), false);
});
