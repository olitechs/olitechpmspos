import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiagnostics, readLogTail, diagnosticsFileName, MAX_LOG_RECORDS } from './diagnostics.mjs';

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-diag-'));
  const logDir = path.join(root, 'logs');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return { root, logDir, dataDir };
}

function configFor({ logDir, dataDir }) {
  return {
    version: '2.2.0',
    mode: 'service',
    host: '127.0.0.1',
    port: 8631,
    dataDir,
    logDir,
    lockFile: path.join(dataDir, 'agent.lock'),
    discoverOnStart: false,
    // A real config also carries credentials; diagnostics must never include them.
    supabase: { url: 'https://example.supabase.co', key: 'SERVICE-ROLE-KEY-MUST-NOT-APPEAR' },
  };
}

function writeLog(logDir, name, records) {
  fs.writeFileSync(path.join(logDir, name), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

test('a support bundle shows the agent, queue and pairing without any secret', () => {
  const { logDir, dataDir } = workspace();
  writeLog(logDir, 'agent.log', [
    { ts: '2026-11-11T10:00:00.000Z', level: 'info', msg: 'print agent listening', host: '127.0.0.1', port: 8631 },
  ]);
  const config = configFor({ logDir, dataDir });

  const { bundle } = createDiagnostics({
    config,
    health: { ok: true, paired: { paired: true, agentName: 'Reception PC', propertyId: 'prop-1' } },
    queue: {
      counts: { queued: 0, printing: 0, printed: 3, failed: 1, uncertain: 1, total: 5 },
      items: [
        { id: 'job-1', status: 'uncertain', hasPayload: true, error: { code: 'ETIMEDOUT', message: 'Timed out after connecting.' }, target: { host: '192.168.2.117', port: 9100 } },
      ],
    },
    now: new Date('2026-11-11T12:34:56.789Z'),
  });

  assert.equal(bundle.format, 1);
  assert.equal(bundle.generatedAt, '2026-11-11T12:34:56.789Z');
  assert.equal(bundle.agent.version, '2.2.0');
  assert.equal(bundle.agent.mode, 'service');
  assert.equal(bundle.paired.paired, true);
  assert.equal(bundle.paired.agentName, 'Reception PC');
  assert.equal(bundle.queue.counts.uncertain, 1);
  assert.equal(bundle.queue.recent[0].id, 'job-1');
  assert.equal(bundle.logs.records.length, 1);

  const text = JSON.stringify(bundle);
  assert.equal(text.includes('SERVICE-ROLE-KEY-MUST-NOT-APPEAR'), false, 'a database key must never be bundled');
  assert.equal(text.includes('escposBase64'), false);
});

test('log credentials are redacted again on the way out', () => {
  const { logDir, dataDir } = workspace();
  writeLog(logDir, 'agent.log', [
    { ts: '2026-11-11T10:00:00.000Z', level: 'warn', msg: 'pairing failed', p_token: 'SECRET-TOKEN-VALUE', pairingCode: 'ABCD2345', agentSecret: 'ANOTHER-SECRET' },
    { ts: '2026-11-11T10:00:01.000Z', level: 'info', msg: 'queued job', idempotencyKey: 'fnb:job-1' },
  ]);

  const { bundle } = createDiagnostics({ config: configFor({ logDir, dataDir }) });
  const text = JSON.stringify(bundle);

  assert.equal(text.includes('SECRET-TOKEN-VALUE'), false);
  assert.equal(text.includes('ANOTHER-SECRET'), false);
  assert.equal(text.includes('ABCD2345'), false, 'a pairing code must not survive into a support file');
  assert.ok(text.includes('fnb:job-1'), 'the job key stays so support can trace a print');
});

test('rotated logs are merged in chronological order and capped', () => {
  const { logDir, dataDir } = workspace();
  writeLog(logDir, 'agent.log.1', [{ ts: '2026-11-11T09:00:00.000Z', msg: 'older' }]);
  writeLog(logDir, 'agent.log', [{ ts: '2026-11-11T10:00:00.000Z', msg: 'newer' }]);

  const tail = readLogTail({ logDir, maxRecords: 10 });
  assert.deepEqual(tail.records.map((record) => record.msg), ['older', 'newer']);
  assert.equal(tail.files.length, 2);

  const capped = readLogTail({ logDir, maxRecords: 1 });
  assert.equal(capped.records.length, 1);
  assert.equal(capped.records[0].msg, 'newer');
  assert.equal(capped.truncated, true);
  assert.ok(MAX_LOG_RECORDS >= 100);

  const bundle = createDiagnostics({ config: configFor({ logDir, dataDir }), maxLogRecords: 1 });
  assert.equal(bundle.bundle.logs.records.length, 1);
});

test('a missing or damaged log directory is reported, not thrown', () => {
  const { dataDir } = workspace();
  const config = configFor({ logDir: path.join(dataDir, 'does-not-exist'), dataDir });
  const { bundle } = createDiagnostics({ config });
  assert.deepEqual(bundle.logs.records, []);
  assert.equal(bundle.logs.unreadableLines, 0);

  const { logDir } = workspace();
  fs.writeFileSync(path.join(logDir, 'agent.log'), '{"msg":"fine"}\nnot json at all\n');
  const damaged = createDiagnostics({ config: configFor({ logDir, dataDir }) });
  assert.equal(damaged.bundle.logs.records.length, 1);
  assert.equal(damaged.bundle.logs.unreadableLines, 1);
});

test('the bundle is written next to the logs with a Windows-safe name', () => {
  const { logDir, dataDir } = workspace();
  const name = diagnosticsFileName(new Date('2026-11-11T12:34:56.789Z'));
  assert.equal(name, 'OliTechs-PrintAgent-Diagnostics-2026-11-11_12-34-56-789.json');
  assert.match(name, /^[A-Za-z0-9._-]+\.json$/);

  assert.match(name, /^OliTechs-PrintAgent-Diagnostics-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}\.json$/);
  const result = createDiagnostics({ config: configFor({ logDir, dataDir }) });
  assert.match(result.fileName, /^OliTechs-PrintAgent-Diagnostics-.*\.json$/);
  assert.ok(fs.existsSync(result.file), 'the file must be saved for support to collect');
  assert.equal(result.file, path.join(dataDir, 'diagnostics', result.fileName));
  const saved = JSON.parse(fs.readFileSync(result.file, 'utf8'));
  assert.equal(saved.format, 1);
  assert.ok(result.bytes > 100);
});

test('the service lock and free disk help diagnose a machine that will not start', () => {
  const { logDir, dataDir } = workspace();
  fs.writeFileSync(path.join(dataDir, 'agent.lock'), JSON.stringify({ pid: 4242, port: 8631, mode: 'service' }));

  const { bundle } = createDiagnostics({ config: configFor({ logDir, dataDir }) });
  assert.equal(bundle.service.running, true);
  assert.equal(bundle.service.lock.pid, 4242);
  assert.ok(bundle.service.freeDiskBytes === null || bundle.service.freeDiskBytes > 0);
});
