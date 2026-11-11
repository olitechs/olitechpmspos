import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './ratelimit.mjs';

test('normal use is never blocked', () => {
  let clock = 0;
  const limiter = createRateLimiter({ limits: { print: 3 }, now: () => clock });
  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true);
  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true);
  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true);
});

test('a runaway retry loop is stopped with a retry hint', () => {
  let clock = 1_000;
  const limiter = createRateLimiter({ limits: { print: 2 }, windowMs: 10_000, now: () => clock });

  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true);
  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true);
  const blocked = limiter.check('127.0.0.1', 'print');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 10);

  clock += 10_000;
  assert.equal(limiter.check('127.0.0.1', 'print').allowed, true, 'the window resets');
});

test('classes have their own budget and clients do not share one', () => {
  const clock = 500;
  const limiter = createRateLimiter({ limits: { print: 1, discover: 1 }, now: () => clock });

  assert.equal(limiter.check('a', 'print').allowed, true);
  assert.equal(limiter.check('a', 'print').allowed, false);
  assert.equal(limiter.check('a', 'discover').allowed, true, 'printing a lot must not block discovery');
  assert.equal(limiter.check('b', 'print').allowed, true, 'a second client has its own budget');
});

test('the bucket table cannot grow without bound', () => {
  const clock = 0;
  const limiter = createRateLimiter({ limits: { default: 5 }, now: () => clock, maxKeys: 3 });
  for (let index = 0; index < 50; index += 1) limiter.check(`client-${index}`);
  assert.ok(limiter.size <= 4, `expected a bounded table, saw ${limiter.size}`);
});

test('an exhausted window recovers on reset', () => {
  const limiter = createRateLimiter({ limits: { print: 1 }, now: () => 0 });
  limiter.check('x', 'print');
  assert.equal(limiter.check('x', 'print').allowed, false);
  limiter.reset();
  assert.equal(limiter.check('x', 'print').allowed, true);
});
