import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_URL,
  normalizeAgentBaseUrl,
  summarizePrintHealth,
  statusLabel,
  fetchPrintHealth,
  retryPrintJob,
} from './printerHealthCore.js';

const jsonResponse = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const agentHealth = { ok: true, service: 'OliTechs Local Print Agent', version: '2.2.0', queue: { queued: 0, printed: 4, failed: 0, uncertain: 0, total: 4 } };

test('an agent that is not running is reported in plain language', () => {
  const summary = summarizePrintHealth({ agent: null, queue: null });
  assert.equal(summary.reachable, false);
  assert.equal(summary.tone, 'danger');
  assert.match(summary.headline, /not running/i);
  assert.equal(summary.counts, null);
  assert.deepEqual(summary.attention, []);
});

test('an uncertain job is described as possibly printed, not as failed', () => {
  const summary = summarizePrintHealth({
    agent: agentHealth,
    queue: {
      counts: { queued: 0, printed: 3, failed: 0, uncertain: 1, total: 4 },
      items: [{ id: 'job-1', status: 'uncertain', title: 'Shift Closing Report', error: { message: 'Timed out after connecting.' } }],
    },
  });
  assert.equal(summary.reachable, true);
  assert.equal(summary.tone, 'warning');
  assert.match(summary.headline, /1 print job may not have printed/);
  assert.match(summary.detail, /two copies/);
  assert.equal(summary.attention.length, 1);
  assert.equal(summary.attention[0].id, 'job-1');
});

test('failed jobs win over waiting jobs but uncertain stays the strongest warning', () => {
  const failed = summarizePrintHealth({
    agent: agentHealth,
    queue: { counts: { queued: 2, printed: 1, failed: 2, uncertain: 0, total: 5 }, items: [] },
  });
  assert.equal(failed.tone, 'danger');
  assert.match(failed.headline, /2 print jobs did not reach the printer/);

  const both = summarizePrintHealth({
    agent: agentHealth,
    queue: { counts: { queued: 2, printed: 1, failed: 2, uncertain: 1, total: 6 }, items: [] },
  });
  assert.equal(both.tone, 'warning');
  assert.match(both.headline, /may not have printed/);
});

test('a healthy agent with an empty queue is calm', () => {
  const summary = summarizePrintHealth({ agent: agentHealth, queue: { counts: agentHealth.queue, items: [] } });
  assert.equal(summary.tone, 'ok');
  assert.match(summary.headline, /running and the queue is clear/i);
  assert.equal(summary.attention.length, 0);
});

test('a waiting job is a warning, not a failure', () => {
  const summary = summarizePrintHealth({
    agent: agentHealth,
    queue: { counts: { queued: 1, printed: 0, failed: 0, uncertain: 0, total: 1 }, items: [] },
  });
  assert.equal(summary.tone, 'warning');
  assert.match(summary.headline, /waiting to print/);
});

test('the health fetch combines /health and /queue and tolerates an older agent', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/health')) return jsonResponse(agentHealth);
    if (url.endsWith('/queue')) return jsonResponse({ ok: false }, { status: 404 });
    return jsonResponse({}, { status: 404 });
  };

  const health = await fetchPrintHealth(DEFAULT_AGENT_URL, { fetchImpl });
  assert.equal(health.reachable, true);
  assert.equal(health.baseUrl, DEFAULT_AGENT_URL);
  assert.equal(health.queue, null);
  assert.equal(health.tone, 'ok');
  assert.deepEqual(calls, [`${DEFAULT_AGENT_URL}/health`, `${DEFAULT_AGENT_URL}/queue`]);
});

test('a wrong health response is an error, not a silent success', async () => {
  await assert.rejects(
    () => fetchPrintHealth('127.0.0.1:8631/', { fetchImpl: async () => jsonResponse({ ok: false, message: 'nope' }) }),
    /nope/,
  );
});

test('a reprint reports the agent message when it is refused', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8631/queue/retry');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).id, 'job-9');
    return jsonResponse({ ok: false, code: 'PRINT_JOB_ALREADY_PRINTED', message: 'That print job already printed.' }, { status: 409 });
  };

  const result = await retryPrintJob('http://127.0.0.1:8631', 'job-9', { fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRINT_JOB_ALREADY_PRINTED');
  assert.match(result.message, /already printed/);
});

test('a reprint without an id fails before touching the network', async () => {
  let called = false;
  const result = await retryPrintJob(DEFAULT_AGENT_URL, '', { fetchImpl: async () => { called = true; return jsonResponse({}); } });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test('agent URLs are normalised and statuses have plain labels', () => {
  assert.equal(normalizeAgentBaseUrl('localhost:8631/'), 'localhost:8631');
  assert.equal(normalizeAgentBaseUrl('http://127.0.0.1:8631/print-agent'), 'http://127.0.0.1:8631');
  assert.equal(normalizeAgentBaseUrl(''), DEFAULT_AGENT_URL);
  assert.equal(statusLabel('uncertain'), 'Needs checking');
  assert.equal(statusLabel('failed'), 'Did not print');
  assert.equal(statusLabel('queued'), 'Waiting');
});
