import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDurableQueue, classifyPrintError, normalizeIdempotencyKey } from './queue.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-queue-'));
const base64 = (text = 'OliTechs receipt') => Buffer.from(text).toString('base64');

function openQueue(dir, options = {}) {
  return createDurableQueue({ dir, ...options });
}

test('a repeated idempotency key never becomes a second print job', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);

  const first = queue.enqueue({ idempotencyKey: 'receipt-1', payloadBase64: base64() });
  assert.equal(first.duplicate, false);
  queue.markAttempt(first.job.id);
  queue.markPrinted(first.job.id);

  const second = queue.enqueue({ idempotencyKey: 'receipt-1', payloadBase64: base64() });
  assert.equal(second.duplicate, true);
  assert.equal(second.job.status, 'printed');
  assert.equal(queue.counts().printed, 1);
  assert.equal(queue.counts().total, 1, 'the duplicate must not create a second record');
  queue.close();
});

test('a job interrupted mid-print is recovered as uncertain, not silently resent', () => {
  const dir = tmpDir();
  const first = openQueue(dir);
  const { job } = first.enqueue({ idempotencyKey: 'kot-9', payloadBase64: base64() });
  first.markAttempt(job.id);
  first.close();

  const restarted = openQueue(dir);
  const recovered = restarted.get(job.id);
  assert.equal(recovered.status, 'uncertain');
  assert.equal(recovered.error.code, 'AGENT_RESTARTED_DURING_PRINT');
  assert.equal(restarted.recoveredCount, 1);
  assert.equal(restarted.nextQueued(), null, 'an uncertain job must never be printed automatically');
  assert.equal(restarted.enqueue({ idempotencyKey: 'kot-9', payloadBase64: base64() }).duplicate, true);
  restarted.close();
});

test('a printed job keeps its record and drops the print data', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);
  const { job } = queue.enqueue({ idempotencyKey: 'bill-2', payloadBase64: base64() });
  queue.markAttempt(job.id);
  queue.markPrinted(job.id);

  const printed = queue.get(job.id);
  assert.equal(printed.status, 'printed');
  assert.equal(printed.hasPayload, false, 'receipt bytes should not be kept after printing');
  assert.ok(printed.printedAt);
  queue.close();

  const reopened = openQueue(dir);
  assert.equal(reopened.get(job.id).status, 'printed');
  assert.equal(reopened.get(job.id).hasPayload, false);
  reopened.close();
});

test('a failed job is reused by its key so a retry does not duplicate it', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);
  const { job } = queue.enqueue({ idempotencyKey: 'refund-3', payloadBase64: base64() });
  queue.markAttempt(job.id);
  queue.markFailed(job.id, { code: 'ECONNREFUSED', message: 'Printer refused the connection.' });

  const retry = queue.enqueue({ idempotencyKey: 'refund-3', payloadBase64: base64('again') });
  assert.equal(retry.duplicate, false);
  assert.equal(retry.reactivated, true);
  assert.equal(retry.job.id, job.id, 'one document keeps one queue record');
  assert.equal(retry.job.status, 'queued');
  assert.equal(retry.job.attempts, 0);
  assert.equal(queue.counts().total, 1);
  queue.close();
});

test('a torn journal line does not lose the jobs written before it', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);
  const first = queue.enqueue({ idempotencyKey: 'a', payloadBase64: base64() });
  const second = queue.enqueue({ idempotencyKey: 'b', payloadBase64: base64() });
  queue.close();

  // Exactly what a power cut in the middle of an append looks like.
  fs.appendFileSync(path.join(dir, 'journal.ndjson'), '{"t":"accepted","job":{"id":"torn"');

  const reopened = openQueue(dir);
  assert.equal(reopened.size, 2);
  assert.ok(reopened.get(first.job.id));
  assert.ok(reopened.get(second.job.id));
  assert.equal(reopened.enqueue({ idempotencyKey: 'a', payloadBase64: base64() }).duplicate, true);
  reopened.close();
});

test('queued jobs are drained oldest first and respect the retry backoff', () => {
  const dir = tmpDir();
  let clock = 1_000;
  const now = () => clock;
  const queue = openQueue(dir, { now });

  const first = queue.enqueue({ idempotencyKey: 'one', payloadBase64: base64() });
  clock += 10;
  const second = queue.enqueue({ idempotencyKey: 'two', payloadBase64: base64() });
  clock += 10;

  assert.equal(queue.nextQueued().id, first.job.id);
  queue.scheduleRetry(first.job.id, 5_000);
  assert.equal(queue.nextQueued().id, second.job.id, 'a backed-off job is skipped while it waits');

  clock += 5_000;
  assert.equal(queue.nextQueued().id, first.job.id, 'it comes back once the delay has passed');
  queue.close();
});

test('a deliberate reprint refuses a job that already printed', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);
  const { job } = queue.enqueue({ idempotencyKey: 'receipt-7', payloadBase64: base64() });
  queue.markAttempt(job.id);
  queue.markPrinted(job.id);

  assert.throws(() => queue.requeue(job.id), (error) => error.code === 'PRINT_JOB_ALREADY_PRINTED');
  assert.throws(() => queue.requeue('missing-job'), (error) => error.code === 'PRINT_JOB_NOT_FOUND');
  queue.close();
});

test('staff can deliberately reprint an uncertain job', () => {
  const dir = tmpDir();
  const queue = openQueue(dir);
  const { job } = queue.enqueue({ idempotencyKey: 'shift-1', payloadBase64: base64() });
  queue.markAttempt(job.id);
  queue.markUncertain(job.id, { code: 'ETIMEDOUT', message: 'Timed out after connecting.' });

  const requeued = queue.requeue(job.id);
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.attempts, 0);
  assert.ok(requeued.payloadBase64, 'the data must still be there so a human can reprint it');
  assert.equal(queue.counts().uncertain, 0);
  queue.close();
});

test('stuck jobs are failed instead of looking pending forever', () => {
  const dir = tmpDir();
  const queue = openQueue(dir, { maxAttempts: 2 });
  const { job } = queue.enqueue({ idempotencyKey: 'report-1', payloadBase64: base64() });
  queue.markAttempt(job.id);
  queue.markAttempt(job.id);
  queue.scheduleRetry(job.id, 0);

  assert.equal(queue.nextQueued({ attemptLimit: 2 }), null);
  assert.equal(queue.failExhausted({ attemptLimit: 2 }), 1);
  const failed = queue.get(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'PRINT_ATTEMPTS_EXHAUSTED');
  queue.close();
});

test('pruning drops old finished jobs but keeps anything that needs attention', () => {
  const dir = tmpDir();
  let clock = 10_000;
  const queue = openQueue(dir, { retentionMs: 1_000, now: () => clock });

  const old = queue.enqueue({ idempotencyKey: 'old', payloadBase64: base64() });
  queue.markAttempt(old.job.id);
  queue.markPrinted(old.job.id);
  clock += 5_000;
  const pending = queue.enqueue({ idempotencyKey: 'pending', payloadBase64: base64() });
  queue.markAttempt(pending.job.id);
  queue.markUncertain(pending.job.id, { code: 'ETIMEDOUT' });

  assert.equal(queue.prune(), 1);
  assert.equal(queue.get(old.job.id), null);
  assert.equal(queue.get(pending.job.id).status, 'uncertain');
  queue.close();
});

test('classification separates a safe retry from a possible duplicate', () => {
  assert.equal(classifyPrintError({ code: 'ECONNRESET', delivered: true }), 'uncertain');
  assert.equal(classifyPrintError({ code: 'ECONNREFUSED', delivered: false }), 'failed');
  assert.equal(classifyPrintError({ code: 'ETIMEDOUT', delivered: false }), 'failed');
  assert.equal(classifyPrintError({ code: 'ETIMEDOUT' }), 'uncertain');
  assert.equal(classifyPrintError({ code: 'WINDOWS_PRINTER_NOT_FOUND' }), 'failed');
  assert.equal(classifyPrintError(new Error('printer exploded')), 'failed');
});

test('idempotency keys are trimmed and bounded', () => {
  assert.equal(normalizeIdempotencyKey('   '), null);
  assert.equal(normalizeIdempotencyKey(null), null);
  assert.equal(normalizeIdempotencyKey('  receipt-1  '), 'receipt-1');
  assert.equal(normalizeIdempotencyKey('k'.repeat(500)).length, 200);
});
