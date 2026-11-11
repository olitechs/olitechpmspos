import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./print-agent-v2.js', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 15000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(intervalMs);
  }
  return null;
}

function readLock(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'agent.lock'), 'utf8'));
  } catch (_) {
    return null;
  }
}

test('one request produces a support file on disk without credentials', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-diag-agent-'));
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PRINT_AGENT_DATA_DIR: dataDir,
      PRINT_AGENT_PORT: '0',
      PRINT_AGENT_MODE: 'service',
      PRINT_AGENT_DISCOVER_ON_START: 'false',
      PRINT_AGENT_LOG_LEVEL: 'debug',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stderrText = '';
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });

  const lock = await waitFor(() => readLock(dataDir));
  assert.ok(lock, `agent should start. stderr: ${child.stderrText}`);
  const base = `http://127.0.0.1:${lock.port}`;
  await waitFor(async () => {
    try { return (await fetch(`${base}/health`)).ok; } catch (_) { return false; }
  });

  // Seed a credential-bearing log line the way a buggy log call might.
  const logFile = path.join(dataDir, 'logs', 'agent.log');
  fs.appendFileSync(logFile, `${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'test', p_token: 'SEEDED-TOKEN-VALUE', pairingCode: 'ZZZZ9999' })}\n`);

  const response = await fetch(`${base}/diagnostics`, { method: 'POST' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.fileName, /^OliTechs-PrintAgent-Diagnostics-.*\.json$/);
  assert.ok(body.bytes > 200);

  const saved = JSON.parse(fs.readFileSync(body.file, 'utf8'));
  assert.equal(saved.agent.version, body.bundle.agent.version);
  assert.equal(saved.agent.mode, 'service');
  assert.ok(saved.queue, 'queue state is included even when empty');
  assert.equal(saved.paired.paired, false);
  assert.ok(saved.logs.records.length >= 1, 'the agent log tail is included');

  const text = JSON.stringify(saved);
  assert.equal(text.includes('SEEDED-TOKEN-VALUE'), false, 'a workstation token must never reach a support file');
  assert.equal(text.includes('ZZZZ9999'), false, 'a pairing code must never reach a support file');

  const diagnosticsDir = path.join(dataDir, 'diagnostics');
  assert.ok(fs.existsSync(diagnosticsDir));
  assert.equal(fs.readdirSync(diagnosticsDir).length, 1);

  // A second request must not overwrite the first record of an incident.
  await delay(5);
  const second = await (await fetch(`${base}/diagnostics`, { method: 'POST' })).json();
  assert.notEqual(second.fileName, body.fileName);
  assert.equal(fs.readdirSync(diagnosticsDir).length, 2);
});
