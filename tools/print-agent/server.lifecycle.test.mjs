import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./print-agent-v2.js', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(intervalMs);
  }
  return null;
}

function agentEnv(dataDir) {
  return {
    ...process.env,
    PRINT_AGENT_DATA_DIR: dataDir,
    PRINT_AGENT_PORT: '0',
    PRINT_AGENT_MODE: 'service',
    PRINT_AGENT_DISCOVER_ON_START: 'false',
    PRINT_AGENT_LOG_LEVEL: 'debug',
    // Keep a developer's own Supabase settings out of the test run.
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  };
}

function startAgent(dataDir) {
  const child = spawn(process.execPath, [entry], {
    env: agentEnv(dataDir),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderrText = '';
  child.stdoutText = '';
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  child.stdout.on('data', (chunk) => { child.stdoutText += chunk; });
  return child;
}

function readLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'agent.lock'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function waitForExit(child, timeoutMs = 20000) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent did not exit within ${timeoutMs}ms`)), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('starts as a service, reports health and refuses untrusted browser origins', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-agent-'));
  const child = startAgent(dataDir);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });

  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `agent should write its instance lock. stderr: ${child.stderrText}`);
  assert.equal(lock.pid, child.pid);
  assert.ok(Number.isInteger(lock.port) && lock.port > 0, 'the lock records the real listening port');
  const base = `http://127.0.0.1:${lock.port}`;

  const health = await waitFor(async () => {
    try {
      const response = await fetch(`${base}/health`);
      return response.ok ? response.json() : null;
    } catch (_) {
      return null;
    }
  });
  assert.ok(health, 'health endpoint should answer');
  assert.equal(health.ok, true);
  assert.equal(health.service, 'OliTechs Local Print Agent');
  assert.equal(health.mode, 'service');
  assert.equal(health.host, '127.0.0.1');
  assert.equal(health.pid, child.pid);
  assert.match(health.version, /^\d+\.\d+\.\d+$/);
  assert.ok(health.uptimeSeconds >= 0);

  const blocked = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, 'ORIGIN_NOT_ALLOWED');

  const preflight = await fetch(`${base}/print`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://olitechpmspos.vercel.app',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

  const stopped = child.kill('SIGTERM');
  assert.equal(stopped, true);
  const exit = await waitForExit(child);
  assert.equal(exit.code, 0, 'a service stop should exit cleanly');
  assert.equal(readLock(dataDir), null, 'the instance lock must be released on shutdown');
});

test('refuses to run a second agent against the same installation', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-agent-'));
  const first = startAgent(dataDir);
  t.after(() => { if (first.exitCode === null) first.kill('SIGKILL'); });

  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `first agent should start. stderr: ${first.stderrText}`);

  const second = startAgent(dataDir);
  const exit = await waitForExit(second);
  assert.notEqual(exit.code, 0, 'the second instance must fail instead of sharing the printers');
  assert.match(second.stderrText, /already running/i);

  const stillHealthy = await fetch(`http://127.0.0.1:${lock.port}/health`).then((response) => response.json());
  assert.equal(stillHealthy.pid, first.pid, 'the original agent must keep serving');
});

test('an occupied port produces a clear error instead of a silent half-start', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-agent-'));
  const first = startAgent(dataDir);
  t.after(() => { if (first.exitCode === null) first.kill('SIGKILL'); });

  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `first agent should start. stderr: ${first.stderrText}`);

  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-agent-'));
  const conflicting = spawn(process.execPath, [entry], {
    env: { ...agentEnv(otherDir), PRINT_AGENT_PORT: String(lock.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrText = '';
  conflicting.stderr.on('data', (chunk) => { stderrText += chunk; });
  const exit = await waitForExit(conflicting);
  assert.notEqual(exit.code, 0);
  assert.match(stderrText, /already in use/i);
  assert.equal(fs.existsSync(path.join(otherDir, 'agent.lock')), false, 'a failed start must not leave a lock');
});
