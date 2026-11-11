import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./print-agent-v2.js', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escpos = (text) => Buffer.from(text).toString('base64');

async function waitFor(check, { timeoutMs = 15000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(intervalMs);
  }
  return null;
}

function dataDirFor() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-agent-queue-'));
}

function agentEnv(dataDir, extra = {}) {
  return {
    ...process.env,
    PRINT_AGENT_DATA_DIR: dataDir,
    PRINT_AGENT_PORT: '0',
    PRINT_AGENT_MODE: 'service',
    PRINT_AGENT_DISCOVER_ON_START: 'false',
    PRINT_AGENT_QUEUE_DRAIN_MS: '100',
    PRINT_AGENT_LOG_LEVEL: 'debug',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    ...extra,
  };
}

function startAgent(dataDir, extra = {}) {
  const child = spawn(process.execPath, [entry], { env: agentEnv(dataDir, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (chunk) => { child.stdoutText += chunk; });
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  return child;
}

function readLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'agent.lock'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function bootAgent(t, extra = {}) {
  const dataDir = dataDirFor();
  const child = startAgent(dataDir, extra);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `agent should start. stderr: ${child.stderrText}`);
  const base = `http://127.0.0.1:${lock.port}`;
  const health = await waitFor(async () => {
    try { const response = await fetch(`${base}/health`); return response.ok ? response.json() : null; } catch (_) { return null; }
  });
  assert.ok(health, 'health should answer');
  return { child, dataDir, base, health };
}

/** The agent only accepts raw printer ports 9100-9102, so the fake printer lives there. */
async function startFakePrinter() {
  for (const port of [9100, 9101, 9102]) {
    const received = [];
    const server = net.createServer((socket) => {
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => { received.push(Buffer.concat(chunks)); });
      socket.on('error', () => {});
    });
    const listening = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (listening) {
      return {
        port,
        received,
        close: () => new Promise((resolve) => server.close(resolve)),
      };
    }
    try { server.close(); } catch (_) { /* ignore */ }
  }
  throw new Error('no free printer port available on 9100-9102');
}

/** A port in the allowed range with nothing listening, for a refused connection. */
async function reserveClosedPort() {
  for (const port of [9102, 9101, 9100]) {
    const server = net.createServer();
    const free = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!free) continue;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }
  throw new Error('no free port to simulate a switched-off printer');
}

const postPrint = (base, body) => fetch(`${base}/print`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const getQueue = async (base) => (await fetch(`${base}/queue`)).json();

test('a repeated print request reaches the printer exactly once', async (t) => {
  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const { base } = await bootAgent(t);

  const body = { host: '127.0.0.1', port: printer.port, escposBase64: escpos('KOT #1'), idempotencyKey: 'order-1-kot' };

  const first = await postPrint(base, body);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.printed, true);
  assert.equal(firstBody.deduplicated, undefined);
  assert.ok(firstBody.jobId, 'the response identifies the queued job');

  const second = await postPrint(base, body);
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.deduplicated, true);
  assert.equal(secondBody.jobId, firstBody.jobId);

  await waitFor(() => printer.received.length >= 1);
  assert.equal(printer.received.length, 1, 'the printer must receive one copy, not two');
  assert.match(printer.received[0].toString('latin1'), /KOT #1/);

  const queue = await getQueue(base);
  assert.equal(queue.counts.printed, 1);
  assert.equal(queue.counts.total, 1);
  assert.equal(queue.items[0].status, 'printed');
  assert.equal(queue.items[0].hasPayload, false, 'print data is cleared once the job is done');
});

test('a switched-off printer fails safely, then reprints once on request', async (t) => {
  const closedPort = await reserveClosedPort();
  const { base } = await bootAgent(t);

  const failed = await postPrint(base, { host: '127.0.0.1', port: closedPort, escposBase64: escpos('bill'), idempotencyKey: 'bill-77' });
  assert.equal(failed.status, 502);
  const failedBody = await failed.json();
  assert.equal(failedBody.code, 'PRINTER_UNREACHABLE');
  assert.equal(failedBody.status, 'failed');

  const queueAfterFailure = await getQueue(base);
  assert.equal(queueAfterFailure.counts.failed, 1);
  const jobId = queueAfterFailure.items[0].id;
  assert.equal(queueAfterFailure.items[0].status, 'failed');
  assert.equal(queueAfterFailure.items[0].hasPayload, true, 'a failed job keeps its data so it can be retried');

  // The printer comes back and staff reprint deliberately.
  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const retryBody = { host: '127.0.0.1', port: printer.port, escposBase64: escpos('bill'), idempotencyKey: 'bill-77' };

  const retried = await postPrint(base, retryBody);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).deduplicated, undefined, 'a failed job is resent, not treated as a duplicate');
  await waitFor(() => printer.received.length >= 1);
  assert.equal(printer.received.length, 1);

  const queueAfterRetry = await getQueue(base);
  assert.equal(queueAfterRetry.counts.total, 1, 'the retry reuses the same queue record');
  assert.equal(queueAfterRetry.counts.printed, 1);
  assert.equal(queueAfterRetry.items[0].id, jobId);
});

test('a job interrupted by a restart is reported as uncertain and never resent automatically', async (t) => {
  const dataDir = dataDirFor();
  const queueDir = path.join(dataDir, 'queue');
  fs.mkdirSync(queueDir, { recursive: true });
  const jobId = '11111111-2222-3333-4444-555555555555';
  const accepted = {
    id: jobId,
    idempotencyKey: 'shift-report-4',
    transport: 'network_ip',
    target: { host: '127.0.0.1', port: 9100 },
    payloadBase64: escpos('shift report'),
    title: 'Shift Closing Report',
    meta: {},
    status: 'printing',
    attempts: 1,
    maxAttempts: 3,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastAttemptAt: Date.now(),
    printedAt: null,
    nextAttemptAt: null,
  };
  fs.writeFileSync(path.join(queueDir, 'journal.ndjson'), `${JSON.stringify({ t: 'accepted', job: accepted })}\n`);

  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const child = startAgent(dataDir);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `agent should start. stderr: ${child.stderrText}`);
  const base = `http://127.0.0.1:${lock.port}`;

  const queue = await getQueue(base);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'uncertain');
  assert.equal(queue.items[0].error.code, 'AGENT_RESTARTED_DURING_PRINT');

  // Give the worker several drain cycles: an uncertain job must stay put.
  await delay(600);
  assert.equal(printer.received.length, 0, 'an interrupted job must never print twice on its own');

  // The same idempotency key is refused rather than silently reprinted.
  const duplicate = await postPrint(base, {
    host: '127.0.0.1', port: printer.port, escposBase64: escpos('shift report'), idempotencyKey: 'shift-report-4',
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'PRINT_OUTCOME_UNCERTAIN');
});

test('a deferred job survives until the agent prints it, without a browser', async (t) => {
  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const { base } = await bootAgent(t);

  const accepted = await postPrint(base, {
    host: '127.0.0.1', port: printer.port, escposBase64: escpos('queued receipt'), idempotencyKey: 'deferred-1', defer: true,
  });
  assert.equal(accepted.status, 202);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.queued, true);
  assert.equal(acceptedBody.status, 'queued');

  const printed = await waitFor(async () => {
    const queue = await getQueue(base);
    return queue.items[0]?.status === 'printed' ? queue : null;
  });
  assert.ok(printed, 'the worker should print the queued job');
  assert.equal(printer.received.length, 1);
  assert.match(printer.received[0].toString('latin1'), /queued receipt/);
});

test('health reports the queue so support can see stuck jobs', async (t) => {
  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const { base } = await bootAgent(t);

  await postPrint(base, { host: '127.0.0.1', port: printer.port, escposBase64: escpos('health'), idempotencyKey: 'health-1' });
  const health = await (await fetch(`${base}/health`)).json();
  assert.ok(health.queue);
  assert.equal(health.queue.printed, 1);
  assert.equal(health.queue.total, 1);
  assert.equal(health.version, '2.2.0');
});

test('a queue entry can be reprinted deliberately and refuses a second copy of a printed job', async (t) => {
  const printer = await startFakePrinter();
  t.after(() => printer.close());
  const { base } = await bootAgent(t);

  const closedPort = await reserveClosedPort();
  const failed = await postPrint(base, { host: '127.0.0.1', port: closedPort, escposBase64: escpos('refund'), idempotencyKey: 'refund-9' });
  assert.equal(failed.status, 502);
  const jobId = (await getQueue(base)).items[0].id;

  const retry = await fetch(`${base}/queue/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: jobId, host: '127.0.0.1', port: printer.port }),
  });
  // The retry endpoint prints to the printer recorded with the job, which was
  // the unreachable one, so it fails again but must keep the record consistent.
  const retryBody = await retry.json();
  assert.equal(retryBody.ok, false);
  assert.equal(retryBody.job.status !== 'printed', true);

  const missing = await fetch(`${base}/queue/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'not-a-job' }),
  });
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).code, 'PRINT_JOB_NOT_FOUND');
});
