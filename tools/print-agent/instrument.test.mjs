import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSentryEvent } from './instrument.mjs';

test('SDK beforeSend removes customer data and sanitizes stack metadata', () => {
  const event = {
    message: 'Jane Doe paid with card 4111111111111111',
    user: { email: 'jane@example.com' },
    request: { url: 'https://hotel.example/?token=secret', headers: { authorization: 'secret' } },
    extra: { receipt: 'guest receipt' },
    contexts: { runtime: { name: 'node' } },
    breadcrumbs: [{ message: 'Jane checked in' }],
    tags: { component: 'print-agent', operation: 'print-job', guest: 'Jane Doe' },
    exception: { values: [{
      type: 'Error',
      value: 'Jane Doe card 4111111111111111',
      stacktrace: { frames: [{
        filename: 'C:\\hotel\\agent\\server.mjs',
        function: 'printGuestReceipt',
        vars: { guest: 'Jane Doe' },
        abs_path: 'C:\\hotel\\agent\\server.mjs',
      }] },
    }] },
  };
  const sanitized = sanitizeSentryEvent(event);
  const serialized = JSON.stringify(sanitized);
  for (const secret of ['Jane Doe', '4111111111111111', 'jane@example.com', 'secret', 'guest receipt']) {
    assert.equal(serialized.includes(secret), false, `event must not contain ${secret}`);
  }
  assert.equal(sanitized.tags.operation, 'print-job');
  assert.equal(sanitized.tags.guest, undefined);
  assert.equal(sanitized.exception.values[0].value.includes('details withheld'), true);
  assert.equal(sanitized.exception.values[0].stacktrace.frames[0].filename, 'app://print-agent');
  assert.equal(sanitized.exception.values[0].stacktrace.frames[0].vars, undefined);
});
