import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  EVIDENCE_VERSION,
  MATRIX,
  PAPER_WIDTHS,
  REQUIRED_CHECKS,
  TRANSPORTS,
  appendEvidenceLog,
  assertNoSecrets,
  evidenceStatus,
  findMatrixEntry,
  normalizeEvidenceLog,
  renderStatusMarkdown,
  summarizeCompatibility,
  validateEvidence,
} from './compatibility.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const NOW = Date.parse('2026-11-11T12:00:00.000Z');

const allPass = () => Object.fromEntries(CHECKS.map((check) => [check.id, 'pass']));

const record = (overrides = {}) => ({
  id: 'acme-hotel-kitchen-2026-11',
  modelId: 'epson-tm-t20iii',
  site: 'Acme Hotel — main restaurant',
  workstation: 'POS-01',
  transport: 'network_ip',
  paperWidth: '80mm',
  agentVersion: '2.2.0',
  windowsVersion: 'Windows 11 24H2',
  recordedAt: '2026-11-11T09:30:00.000Z',
  checks: allPass(),
  notes: 'Reprint and restart recovery both confirmed with the printer unplugged.',
  reportFiles: ['acme-receipt.jpg'],
  ...overrides,
});

const emptyLog = () => ({ version: EVIDENCE_VERSION, records: [] });

test('every matrix entry is complete and internally consistent', () => {
  const ids = new Set();
  const models = new Set();
  for (const entry of MATRIX) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]+$/, `bad matrix id: ${entry.id}`);
    assert.ok(!ids.has(entry.id), `duplicate matrix id: ${entry.id}`);
    assert.ok(!models.has(entry.model), `duplicate model name: ${entry.model}`);
    ids.add(entry.id);
    models.add(entry.model);
    assert.ok(entry.model.trim().length > 3);
    assert.ok(entry.note.length > 20, `${entry.model} needs a note explaining its behaviour`);
    assert.ok(entry.transports.length > 0);
    for (const transport of entry.transports) assert.ok(TRANSPORTS.includes(transport), `${entry.model}: ${transport}`);
    for (const paper of entry.paper) assert.ok(PAPER_WIDTHS.includes(paper), `${entry.model}: ${paper}`);
    assert.ok(['supported', 'conditional', 'unsupported'].includes(entry.expectation));
  }
  assert.ok(MATRIX.some((entry) => entry.expectation === 'unsupported'), 'the matrix must say what does not work');
});

test('the shipped evidence log is empty: nothing has been validated yet', () => {
  const log = JSON.parse(read('tools/print-agent/compatibility-evidence.json'));
  assert.equal(log.version, EVIDENCE_VERSION);
  assert.deepEqual(log.records, [], 'real hardware evidence must never be invented in the repository');
});

test('a complete record with every check passing is validated', () => {
  const valid = validateEvidence(record(), { now: NOW });
  assert.equal(valid.status, 'validated');
  assert.equal(valid.id, 'acme-hotel-kitchen-2026-11');
});

test('a failed required check makes the record failed, not conditional', () => {
  const valid = validateEvidence(record({ checks: { ...allPass(), reprint: 'fail' } }), { now: NOW });
  assert.equal(valid.status, 'failed');
});

test('a failed optional check is conditional, never validated', () => {
  const valid = validateEvidence(record({ checks: { ...allPass(), cash_drawer: 'fail' } }), { now: NOW });
  assert.equal(valid.status, 'conditional');
  assert.equal(evidenceStatus(record({ checks: { ...allPass(), cash_drawer: 'not-tested' } })), 'conditional');
});

test('a record missing a required check is rejected with the exact field', () => {
  const checks = { ...allPass() };
  delete checks.offline_recovery;
  assert.throws(
    () => validateEvidence(record({ checks }), { now: NOW }),
    (error) => error.code === 'INVALID_EVIDENCE' && error.field === 'checks.offline_recovery' && /cannot count as validation/.test(error.message),
  );
});

test('unknown transports, models and check names are rejected', () => {
  assert.throws(() => validateEvidence(record({ transport: 'carrier-pigeon' }), { now: NOW }), /Unknown transport/);
  assert.throws(() => validateEvidence(record({ modelId: 'mystery-printer' }), { now: NOW }), /not in the compatibility matrix/);
  assert.throws(() => validateEvidence(record({ checks: { ...allPass(), coin_slot: 'pass' } }), { now: NOW }), /Unknown check/);
  assert.throws(() => validateEvidence(record({ paperWidth: '110mm' }), { now: NOW }), /Unknown paper width/);
});

test('a transport the matrix does not document for that model is refused', () => {
  assert.throws(
    () => validateEvidence(record({ modelId: 'star-tsp143iv', transport: 'network_ip' }), { now: NOW }),
    /not documented on network_ip/,
  );
});

test('a future or unparseable date is refused', () => {
  assert.throws(() => validateEvidence(record({ recordedAt: 'sometime last week' }), { now: NOW }), /ISO date/);
  assert.throws(() => validateEvidence(record({ recordedAt: '2027-01-01T00:00:00.000Z' }), { now: NOW }), /future/);
});

test('credentials, receipt contents and raw print data cannot be pasted into a record', () => {
  assert.throws(() => assertNoSecrets({ ...record(), password: 'hunter2' }), /must never contain credentials/);
  assert.throws(() => assertNoSecrets({ ...record(), notes: { pairingCode: 'ABC123' } }), /must never contain credentials/);
  assert.throws(() => validateEvidence(record({ notes: 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' })), /looks like a credential/);
  assert.throws(() => validateEvidence(record({ content_html: '<div>Guest name</div>' })), /must never contain credentials/);
  assert.doesNotThrow(() => validateEvidence(record(), { now: NOW }));
});

test('appending is pure and duplicate ids are refused', () => {
  const log = emptyLog();
  const next = appendEvidenceLog(log, record(), { now: NOW });
  assert.equal(log.records.length, 0, 'the original log must not be mutated');
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0].status, 'validated');
  assert.throws(() => appendEvidenceLog(next, record(), { now: NOW }), (error) => error.code === 'DUPLICATE_ID');
});

test('the log itself refuses a bad version, bad records and duplicate ids', () => {
  assert.throws(() => normalizeEvidenceLog({ version: 99, records: [] }), /version must be 1/);
  assert.throws(
    () => normalizeEvidenceLog({ version: EVIDENCE_VERSION, records: [record(), record()] }, { now: NOW }),
    /Duplicate record id/,
  );
  const distinct = normalizeEvidenceLog({
    version: EVIDENCE_VERSION,
    records: [record(), record({ id: 'acme-hotel-bar-2026-11' })],
  }, { now: NOW });
  assert.equal(distinct.records.length, 2);
});

test('a matrix with no records is blocked and lists every supported model as a gap', () => {
  const summary = summarizeCompatibility(MATRIX, []);
  assert.equal(summary.totals.noEvidence, MATRIX.length);
  assert.equal(summary.goLiveReady, false);
  assert.deepEqual(summary.gaps, MATRIX.filter((entry) => entry.expectation === 'supported').map((entry) => entry.id));
});

test('one validated printer does not make the whole matrix go-live ready', () => {
  const summary = summarizeCompatibility(MATRIX, [validateEvidence(record(), { now: NOW })]);
  assert.equal(summary.byModel['epson-tm-t20iii'].evidence, 'validated');
  assert.equal(summary.totals.validated, 1);
  assert.ok(summary.gaps.includes('xprinter-xp-80c'));
  assert.equal(summary.goLiveReady, false);

  const allSupported = MATRIX
    .filter((entry) => entry.expectation === 'supported')
    .map((entry, index) => validateEvidence(record({
      id: `site-${index}-${entry.id}`,
      modelId: entry.id,
      transport: entry.transports[0],
      paperWidth: entry.paper[0],
    }), { now: NOW }));
  const ready = summarizeCompatibility(MATRIX, allSupported);
  assert.equal(ready.gaps.length, 0);
  assert.equal(ready.goLiveReady, true);
});

test('a conditional or failed record does not close the gap', () => {
  const conditional = validateEvidence(record({ id: 'cond-1', checks: { ...allPass(), cash_drawer: 'fail' } }), { now: NOW });
  const failed = validateEvidence(record({ id: 'fail-1', modelId: 'xprinter-xp-80c', checks: { ...allPass(), receipt: 'fail' } }), { now: NOW });
  const summary = summarizeCompatibility(MATRIX, [conditional, failed]);
  assert.equal(summary.byModel['epson-tm-t20iii'].evidence, 'conditional');
  assert.equal(summary.byModel['xprinter-xp-80c'].evidence, 'failed');
  assert.equal(summary.byModel['xprinter-xp-80c'].failingChecks.includes('receipt'), true);
  assert.ok(summary.gaps.includes('epson-tm-t20iii'));
});

test('the rendered status report includes every model and says when there is no evidence', () => {
  const markdown = renderStatusMarkdown({ matrix: MATRIX, records: [], generatedAt: '2026-11-11' });
  for (const entry of MATRIX) assert.ok(markdown.includes(entry.model), `${entry.model} missing from report`);
  assert.match(markdown, /no real hardware has been validated/i);
  assert.match(markdown, /no-evidence/);
  assert.match(markdown, /Go-live gaps/);
  assert.match(markdown, /cannot go live/i);
});

test('the human matrix document lists every model in the data', () => {
  const doc = read('docs/print-agent/PRINTER-COMPATIBILITY-MATRIX.md');
  for (const entry of MATRIX) {
    assert.ok(doc.includes(entry.model), `${entry.model} is in the matrix data but missing from the document`);
  }
  assert.match(doc, /required check/i);
  assert.match(doc, /compatibility-evidence\.json/);
});

test('the status CLI works and reports the unvalidated state honestly', () => {
  const cli = fileURLToPath(new URL('./record-compatibility.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, 'status'], { encoding: 'utf8' });
  assert.match(output, /validated 0/);
  assert.match(output, /no evidence 9/);
  assert.match(output, /Go-live: blocked/);
  assert.match(output, /Epson TM-T20III/);
});

test('the compatibility tooling is wired into the project scripts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['print-agent:compatibility'], /record-compatibility\.mjs/);
  assert.match(pkg.scripts['test:print-agent'], /compatibility\.test\.mjs/);

  const checklist = read('tools/print-agent/WINDOWS-ACCEPTANCE-CHECKLIST.md');
  assert.match(checklist, /Part 15/);
  assert.ok(findMatrixEntry('epson-tm-t20iii'));
  assert.equal(findMatrixEntry('not-a-printer'), null);
  assert.ok(REQUIRED_CHECKS.includes('restart_recovery'));
});
