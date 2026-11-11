import fs from 'node:fs';
import path from 'node:path';
import { redactValue } from './logger.mjs';

/**
 * Builds one support file that answers "why did this computer not print?".
 *
 * Everything here is an allow-list, not a dump: agent version and mode, pairing
 * state without the secret, queue counts and recent job outcomes without print
 * data, the service lock, free disk space, and the tail of the log with
 * credentials removed again on the way out.
 *
 * Deliberately absent: Supabase keys, the workstation secret, raw ESC/POS
 * payloads, receipt text and guest details. `redactValue` runs over the finished
 * bundle as a second line of defence.
 */

export const DIAGNOSTICS_FORMAT = 1;
export const MAX_LOG_RECORDS = 500;
const MAX_LOG_BYTES_PER_FILE = 512 * 1024;

/** Safe on every Windows filesystem: no colon, no spaces, sortable. */
export function diagnosticsFileName(now = new Date()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  return `OliTechs-PrintAgent-Diagnostics-${stamp}.json`;
}

function readFileTail(file, maxBytes) {
  const { size } = fs.statSync(file);
  if (!size) return { text: '', partial: false, bytes: 0 };
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return { text: buffer.toString('utf8'), partial: start > 0, bytes: size };
  } finally {
    fs.closeSync(handle);
  }
}

const logRank = (name) => (name === 'agent.log' ? 0 : Number(name.split('.')[1] || 0) + 1);

/**
 * Reads the newest log records across the rotated files, in chronological order.
 * A torn or non-JSON line is counted, never thrown.
 */
export function readLogTail({ logDir, maxRecords = MAX_LOG_RECORDS, maxBytesPerFile = MAX_LOG_BYTES_PER_FILE } = {}) {
  const result = { records: [], unreadableLines: 0, truncated: false, files: [] };
  if (!logDir) return result;

  let names = [];
  try {
    names = fs.readdirSync(logDir).filter((name) => /^agent\.log(\.\d+)?$/.test(name));
  } catch (_) {
    return result;
  }
  if (!names.length) return result;

  names.sort((a, b) => logRank(a) - logRank(b)); // newest first

  const perFile = [];
  for (const name of names) {
    const file = path.join(logDir, name);
    let tail;
    try {
      tail = readFileTail(file, maxBytesPerFile);
    } catch (_) {
      continue;
    }
    result.files.push({ name, bytes: tail.bytes, sampledBytes: Math.min(tail.bytes, maxBytesPerFile) });

    const lines = tail.text.split('\n');
    // A tail that starts mid-file starts mid-line: drop that fragment.
    if (tail.partial && lines.length) lines.shift();

    const parsed = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(redactValue(JSON.parse(trimmed)));
      } catch (_) {
        result.unreadableLines += 1;
      }
    }
    perFile.push(parsed);
  }

  perFile.reverse(); // oldest file first
  const all = perFile.flat();
  result.truncated = all.length > maxRecords;
  result.records = result.truncated ? all.slice(all.length - maxRecords) : all;
  return result;
}

function readLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (_) {
    return null;
  }
}

function freeDiskBytes(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Math.round(stats.bavail * stats.bsize);
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} input
 * @param {object} input.config resolved agent configuration (never the raw env)
 * @param {object} [input.health] the /health body, including pairing state
 * @param {object} [input.queue] `{ counts, items }` from the durable queue
 */
export function createDiagnostics({ config, health = null, queue = null, now = new Date(), maxLogRecords = MAX_LOG_RECORDS } = {}) {
  if (!config) throw new Error('Diagnostics need the resolved agent configuration.');

  const logTail = readLogTail({ logDir: config.logDir, maxRecords: maxLogRecords });
  const lock = readLock(config.lockFile);

  const bundle = redactValue({
    format: DIAGNOSTICS_FORMAT,
    generatedAt: new Date(now).toISOString(),
    agent: {
      version: config.version,
      mode: config.mode,
      host: config.host,
      port: config.port,
      platform: process.platform,
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      discoverOnStart: Boolean(config.discoverOnStart),
    },
    paired: health?.paired || { paired: false },
    queue: queue
      ? { counts: queue.counts || null, recent: Array.isArray(queue.items) ? queue.items.slice(0, 50) : [] }
      : null,
    service: {
      dataDir: config.dataDir,
      logDir: config.logDir,
      lockFile: config.lockFile,
      running: Boolean(lock),
      lock,
      freeDiskBytes: freeDiskBytes(config.dataDir),
      logFiles: logTail.files,
    },
    logs: {
      records: logTail.records,
      unreadableLines: logTail.unreadableLines,
      truncated: logTail.truncated,
      maxRecords: maxLogRecords,
    },
    notes: [
      'Test pages are deliberately not recorded in the print queue.',
      'Print data is discarded once a job prints, so this file cannot reprint a receipt.',
      'Credentials, guest details, receipt text and raw ESC/POS bytes are removed before this file is written.',
    ],
  });

  const fileName = diagnosticsFileName(now);
  const dir = path.join(config.dataDir, 'diagnostics');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  const text = JSON.stringify(bundle, null, 2);
  fs.writeFileSync(file, text, 'utf8');

  return { bundle, fileName, file, bytes: Buffer.byteLength(text) };
}
