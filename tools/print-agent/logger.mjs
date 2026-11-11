import fs from 'node:fs';
import path from 'node:path';

// A service has no terminal, so every important event must end up in a file that
// a support engineer can read later. Records are one JSON object per line.
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
export const REDACTED = '[redacted]';

// Printing involves guest names, order contents and credentials. None of them
// belong in a log file, so sensitive keys are replaced before anything is written.
const SENSITIVE_KEY = /^(password|passwd|pass|secret|clientsecret|token|accesstoken|refreshtoken|authorization|cookie|apikey|api_key|key|signingkey|service_role_key|servicerolekey|supabasekey|supabase_key|escpos|escposbase64|content|contenthtml|payloadtext|guest|guestname|customer)$/i;

// Credentials arrive under many names (p_token, tokenHash, agentSecret,
// pairingCode). Matching suffixes means a new field name cannot quietly write a
// workstation secret into the log file.
const SENSITIVE_SUFFIX = /(token|tokenhash|secret|password|passwd|apikey|api_key|pairingcode|paircode|devicecode|credentialsecret)$/i;

const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 6;

const normalizeKey = (key) => String(key).replace(/[\s_-]/g, '');

export const isSensitiveKey = (key) => {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY.test(normalized) || SENSITIVE_SUFFIX.test(normalized);
};

export function redactValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code ?? undefined };
  }
  if (depth >= MAX_DEPTH) return '[depth-limit]';
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (typeof value === 'object') {
    const clean = {};
    for (const [key, entry] of Object.entries(value)) {
      clean[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return clean;
  }
  return String(value);
}

function rotateLog(file, maxFiles) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1) return;
  for (let index = maxFiles; index >= 1; index -= 1) {
    const current = index === 1 ? file : `${file}.${index - 1}`;
    const next = `${file}.${index}`;
    if (!fs.existsSync(current)) continue;
    try {
      fs.rmSync(next, { force: true });
      fs.renameSync(current, next);
    } catch (_) {
      // Rotation is housekeeping: never lose the record being written because
      // an old log file is locked by an editor.
    }
  }
}

/**
 * Structured logger with size-based rotation.
 * `mirror` also prints to the console, which is what a manual run needs.
 */
export function createLogger({
  dir,
  file = 'agent.log',
  maxBytes = 2_000_000,
  maxFiles = 5,
  level = 'info',
  mirror = false,
  now = () => new Date(),
  base = {},
  console: consoleSink = console,
} = {}) {
  if (!dir) throw new Error('createLogger requires a log directory.');
  const context = {
    dir: path.resolve(dir),
    file: path.isAbsolute(file) ? file : path.join(path.resolve(dir), file),
    maxBytes,
    maxFiles,
    level: LEVELS[String(level).toLowerCase()] ? String(level).toLowerCase() : 'info',
    mirror,
    now,
    base,
    consoleSink,
  };

  const writeRecord = (recordLevel, message, fields = {}) => {
    if (LEVELS[recordLevel] < LEVELS[context.level]) return;
    const record = {
      ts: context.now().toISOString(),
      level: recordLevel,
      msg: String(message ?? ''),
      ...redactValue(context.base),
      ...redactValue(fields),
    };
    let line;
    try {
      line = JSON.stringify(record);
    } catch (_) {
      line = JSON.stringify({ ts: record.ts, level: recordLevel, msg: record.msg, logSerializeError: true });
    }
    try {
      fs.mkdirSync(context.dir, { recursive: true });
      const size = fs.existsSync(context.file) ? fs.statSync(context.file).size : 0;
      if (size > 0 && size + Buffer.byteLength(line) > context.maxBytes) {
        rotateLog(context.file, context.maxFiles);
      }
      fs.appendFileSync(context.file, `${line}\n`, 'utf8');
    } catch (error) {
      if (context.mirror) context.consoleSink.error(`[print-agent] log write failed: ${error?.message}`);
    }
    if (context.mirror) {
      const sink = context.consoleSink[recordLevel] || context.consoleSink.log;
      sink?.(`[${record.ts}] ${recordLevel.toUpperCase()} ${record.msg}`, Object.keys(fields).length ? redactValue(fields) : '');
    }
  };

  const logger = {
    dir: context.dir,
    file: context.file,
    level: context.level,
    debug: (message, fields) => writeRecord('debug', message, fields),
    info: (message, fields) => writeRecord('info', message, fields),
    warn: (message, fields) => writeRecord('warn', message, fields),
    error: (message, fields) => writeRecord('error', message, fields),
    child: (bindings = {}) => createLogger({
      dir: context.dir,
      file: context.file,
      maxBytes: context.maxBytes,
      maxFiles: context.maxFiles,
      level: context.level,
      mirror: context.mirror,
      now: context.now,
      base: { ...context.base, ...bindings },
      console: context.consoleSink,
    }),
  };
  return logger;
}

/** Used before configuration is known (imports, fatal startup errors). */
export function createConsoleLogger({ level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (recordLevel, sink) => (message, fields) => {
    if (LEVELS[recordLevel] < threshold) return;
    sink(`[print-agent] ${recordLevel.toUpperCase()} ${message}`, fields && Object.keys(fields).length ? redactValue(fields) : '');
  };
  return {
    dir: null,
    file: null,
    level,
    debug: emit('debug', console.log),
    info: emit('info', console.log),
    warn: emit('warn', console.warn),
    error: emit('error', console.error),
    child: () => createConsoleLogger({ level }),
  };
}
