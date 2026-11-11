import os from 'node:os';
import path from 'node:path';

// Bumped when the agent's behaviour or configuration surface changes. The
// service, the dashboard and diagnostics all report this same value.
export const AGENT_VERSION = '2.2.0';
export const SERVICE_ID = 'OliTechsPrintAgent';
export const SERVICE_DISPLAY_NAME = 'OliTechs Print Agent';
export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze(['https://olitechpmspos.vercel.app']);
export const DEFAULT_PORT = 8631;

export class PrintAgentConfigError extends Error {
  constructor(message, code = 'PRINT_AGENT_CONFIG_INVALID') {
    super(message);
    this.name = 'PrintAgentConfigError';
    this.code = code;
  }
}

const numberFrom = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(value)));

const isTruthyFlag = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

const isFalsyFlag = (value) => ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.includes(String(host ?? '').trim().toLowerCase());
}

/**
 * The service runs outside any user session, so its writable state must live in
 * a machine-wide location instead of the checkout or a user profile.
 */
export function resolveDataDir(env = process.env, platform = process.platform) {
  const explicit = String(env.PRINT_AGENT_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);
  if (platform === 'win32') {
    const programData = String(env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData').trim();
    return path.join(programData, 'OliTechs', 'PrintAgent');
  }
  return path.join(os.homedir(), '.olitechs-print-agent');
}

function resolveAllowedOrigins(env) {
  const configured = String(env.PRINT_AGENT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowed = [...DEFAULT_ALLOWED_ORIGINS];
  const ignored = [];
  for (const origin of configured) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin.replace(/\/$/, '')) {
        ignored.push(origin);
        continue;
      }
      allowed.push(parsed.origin);
    } catch (_) {
      // A typo must not stop a hotel from printing; report it instead.
      ignored.push(origin);
    }
  }
  return { allowedOrigins: [...new Set(allowed)], ignoredOrigins: ignored };
}

/**
 * Resolves every runtime setting the agent needs. Kept pure so a service start,
 * a console start and the tests all resolve the same configuration.
 */
export function loadConfig(env = process.env, { platform = process.platform } = {}) {
  const dataDir = resolveDataDir(env, platform);

  const requestedHost = String(env.PRINT_AGENT_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const allowNonLoopback = isTruthyFlag(env.PRINT_AGENT_ALLOW_NON_LOOPBACK);
  const loopback = isLoopbackHost(requestedHost);
  const host = loopback ? requestedHost : (allowNonLoopback ? requestedHost : '127.0.0.1');

  let hostWarning = null;
  if (!loopback && !allowNonLoopback) {
    hostWarning = 'PRINT_AGENT_HOST is not a loopback address, so the agent stays on 127.0.0.1. Set PRINT_AGENT_ALLOW_NON_LOOPBACK=1 only if you accept that any device on the network can submit print jobs.';
  } else if (!loopback) {
    hostWarning = 'The print agent is bound to a non-loopback address. Any device on this network can submit print jobs.';
  }

  const rawPort = env.PRINT_AGENT_PORT;
  const port = rawPort === undefined || String(rawPort).trim() === '' ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new PrintAgentConfigError(`PRINT_AGENT_PORT must be a whole number between 0 and 65535 (received "${rawPort}").`, 'PRINT_AGENT_PORT_INVALID');
  }

  const { allowedOrigins, ignoredOrigins } = resolveAllowedOrigins(env);
  const mode = isFalsyFlag(env.PRINT_AGENT_MODE) ? 'console' : (String(env.PRINT_AGENT_MODE || 'console').trim() || 'console');
  const supabaseUrl = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const supabaseKey = String(env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();

  return {
    version: AGENT_VERSION,
    mode,
    host,
    requestedHost,
    hostWarning,
    port,
    allowedOrigins,
    ignoredOrigins,
    dataDir,
    logDir: path.join(dataDir, 'logs'),
    lockFile: path.join(dataDir, 'agent.lock'),
    // The durable queue lives with the rest of the service state so an upgrade
    // and a restart both find the jobs that were accepted before the stop.
    queueDir: path.join(dataDir, 'queue'),
    // Paired workstation secret. Written 0600 by the pairing flow, read at start.
    tokenFile: path.join(dataDir, 'agent-credential.json'),
    queueMaxAttempts: clamp(numberFrom(env.PRINT_AGENT_QUEUE_MAX_ATTEMPTS, 3), 1, 10),
    queueRetentionMs: clamp(numberFrom(env.PRINT_AGENT_QUEUE_RETENTION_DAYS, 7), 1, 90) * 86400000,
    queueMaxRecords: clamp(numberFrom(env.PRINT_AGENT_QUEUE_MAX_RECORDS, 500), 50, 5000),
    queueDrainMs: clamp(numberFrom(env.PRINT_AGENT_QUEUE_DRAIN_MS, 1500), 100, 60000),
    // Opt-in until Phase 7 gives workstations their own credential: claiming
    // needs a service-role key, which the installer deliberately does not ask for.
    claimJobs: isTruthyFlag(env.PRINT_AGENT_CLAIM_JOBS),
    claimIntervalMs: clamp(numberFrom(env.PRINT_AGENT_CLAIM_INTERVAL_MS, 15000), 2000, 300000),
    claimBatchSize: clamp(numberFrom(env.PRINT_AGENT_CLAIM_BATCH_SIZE, 3), 1, 10),
    claimLeaseSeconds: clamp(numberFrom(env.PRINT_AGENT_CLAIM_LEASE_SECONDS, 120), 30, 900),
    propertyId: String(env.PRINT_AGENT_PROPERTY_ID || '').trim() || null,
    discoverOnStart: !isFalsyFlag(env.PRINT_AGENT_DISCOVER_ON_START),
    shutdownTimeoutMs: clamp(numberFrom(env.PRINT_AGENT_SHUTDOWN_TIMEOUT_MS, 10000), 1000, 60000),
    logMaxBytes: clamp(numberFrom(env.PRINT_AGENT_LOG_MAX_BYTES, 2_000_000), 10_000, 50_000_000),
    logMaxFiles: clamp(numberFrom(env.PRINT_AGENT_LOG_MAX_FILES, 5), 1, 50),
    logLevel: String(env.PRINT_AGENT_LOG_LEVEL || 'info').trim().toLowerCase() || 'info',
    agentId: String(env.PRINT_AGENT_ID || '').trim(),
    workspaceId: String(env.WORKSPACE_ID || '').trim(),
    supabase: supabaseUrl && supabaseKey ? { url: supabaseUrl, key: supabaseKey } : null,
  };
}
