import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCAL_AGENT_URL,
  AGENT_UNAVAILABLE_CODE,
  AGENT_ORIGIN_BLOCKED_CODE,
  normalizeAgentBase,
  agentBaseCandidates,
  localAgentUnavailableMessage,
  probeAgentReachable,
  describeAgentFailure,
} from './printAgentRoutingCore.js';

test('a saved agent URL is reduced to a bare loopback origin', () => {
  assert.equal(normalizeAgentBase('localhost:8631/'), 'http://localhost:8631');
  assert.equal(normalizeAgentBase('http://127.0.0.1:8631/print-agent'), 'http://127.0.0.1:8631');
  assert.equal(normalizeAgentBase(''), DEFAULT_LOCAL_AGENT_URL);
  assert.equal(normalizeAgentBase('ftp://example.com', 'fallback'), 'fallback');
});

test('the standard loopback agent is tried even when the saved URL is wrong', () => {
  const candidates = agentBaseCandidates('https://stale.example');
  assert.deepEqual(candidates, ['https://stale.example', 'http://127.0.0.1:8631', 'http://localhost:8631']);
  assert.equal(agentBaseCandidates(null)[0], DEFAULT_LOCAL_AGENT_URL);
});

test('an unreachable agent gets an actionable start-and-allow message', () => {
  const failure = describeAgentFailure({ origin: 'https://olitechs.co.ke', originReachable: false });
  assert.equal(failure.code, AGENT_UNAVAILABLE_CODE);
  assert.match(failure.message, /Start the OliTechs Print Agent/);
  assert.match(failure.message, /Settings → Printers/);
});

test('a running agent that rejects the origin is not reported as stopped', () => {
  const failure = describeAgentFailure({ origin: 'https://olitechs.co.ke', originReachable: true });
  assert.equal(failure.code, AGENT_ORIGIN_BLOCKED_CODE);
  assert.match(failure.message, /https:\/\/olitechs\.co\.ke/);
  assert.match(failure.message, /allowed/);
  assert.doesNotMatch(localAgentUnavailableMessage({ originReachable: true }), /Start the OliTechs Print Agent/);
});

test('a no-cors health probe distinguishes an opaque answer from a dead agent', async () => {
  const calls = [];
  const opaque = await probeAgentReachable(DEFAULT_LOCAL_AGENT_URL, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { type: 'opaque', ok: false };
    },
  });
  assert.equal(opaque, true);
  assert.equal(calls[0].url, `${DEFAULT_LOCAL_AGENT_URL}/health`);
  assert.equal(calls[0].options.mode, 'no-cors');

  assert.equal(await probeAgentReachable(DEFAULT_LOCAL_AGENT_URL, {
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  }), false);
  assert.equal(await probeAgentReachable(DEFAULT_LOCAL_AGENT_URL, { fetchImpl: null }), false);
});

test('the probe never waits forever on a hanging agent', async () => {
  const result = await probeAgentReachable(DEFAULT_LOCAL_AGENT_URL, {
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });
  assert.equal(result, false);
});
