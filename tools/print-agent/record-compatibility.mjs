#!/usr/bin/env node
/**
 * Records and reports real-hardware validation for the print agent.
 *
 *   npm run print-agent:compatibility status
 *   npm run print-agent:compatibility report -- --out docs/print-agent/COMPATIBILITY-STATUS.md
 *   npm run print-agent:compatibility record -- path/to/record.json
 *
 * `record` refuses an incomplete or unsafe record and prints exactly why. It
 * never invents a result: a record only enters the log if it came from a person
 * who ran every required check.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  EVIDENCE_VERSION,
  MATRIX,
  appendEvidenceLog,
  findMatrixEntry,
  normalizeEvidenceLog,
  renderStatusMarkdown,
  summarizeCompatibility,
} from './compatibility.mjs';

const EVIDENCE_PATH = fileURLToPath(new URL('./compatibility-evidence.json', import.meta.url));

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${label}: ${error.message}`);
    process.exit(2);
  }
};

const loadLog = () => normalizeEvidenceLog(readJson(EVIDENCE_PATH, 'compatibility-evidence.json'));

const printStatus = (log) => {
  const summary = summarizeCompatibility(MATRIX, log.records);
  const { totals } = summary;
  console.log(renderStatusMarkdown({ matrix: MATRIX, records: log.records }));
  console.log(`Models: ${totals.models} · validated ${totals.validated} · conditional ${totals.conditional} · failed ${totals.failed} · no evidence ${totals.noEvidence}`);
  console.log(summary.goLiveReady
    ? 'Go-live: ready — every supported model has a validated site record.'
    : `Go-live: blocked — ${summary.gaps.length} supported model${summary.gaps.length === 1 ? '' : 's'} without validated evidence.`);
  return summary;
};

const [command = 'status', ...rest] = process.argv.slice(2);
const flag = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : null;
};

if (command === 'status') {
  printStatus(loadLog());
  process.exit(0);
}

if (command === 'report') {
  const out = flag('--out');
  const markdown = renderStatusMarkdown({
    matrix: MATRIX,
    records: loadLog().records,
    generatedAt: new Date().toISOString().slice(0, 10),
  });
  if (out) {
    writeFileSync(out, markdown);
    console.log(`Wrote ${out}`);
  } else {
    process.stdout.write(markdown);
  }
  process.exit(0);
}

if (command === 'record') {
  const inputPath = rest.find((value) => !value.startsWith('--'));
  if (!inputPath) {
    console.error('Usage: npm run print-agent:compatibility record -- path/to/record.json');
    console.error('Create the record from the checks in docs/print-agent/PRINTER-COMPATIBILITY-MATRIX.md.');
    process.exit(2);
  }
  const candidate = readJson(inputPath, 'the evidence record');
  try {
    const log = loadLog();
    const next = appendEvidenceLog(log, candidate);
    if (rest.includes('--dry-run')) {
      console.log('Record is valid. Nothing was written (--dry-run).');
    } else {
      writeFileSync(EVIDENCE_PATH, `${JSON.stringify({ version: EVIDENCE_VERSION, records: next.records }, null, 2)}\n`);
      console.log(`Recorded ${candidate.id} for ${findMatrixEntry(candidate.modelId)?.model || candidate.modelId}.`);
    }
    const saved = next.records.find((record) => record.id === candidate.id);
    console.log(`Status: ${saved?.status || 'unknown'}`);
    if (saved?.status !== 'validated') {
      console.log('This printer is not validated. Fix the failing required checks, or record it as conditional on purpose.');
      for (const check of CHECKS.filter((item) => item.required && (candidate.checks || {})[item.id] !== 'pass')) {
        console.log(` - ${check.id}: ${(candidate.checks || {})[check.id] || 'not-tested'} (${check.label})`);
      }
      process.exitCode = 3;
    }
  } catch (error) {
    console.error(`${error.code || 'ERROR'}: ${error.message}`);
    if (error.field) console.error(`Field: ${error.field}`);
    process.exit(1);
  }
  process.exit(process.exitCode || 0);
}

console.error(`Unknown command "${command}". Use status, report or record.`);
process.exit(2);
