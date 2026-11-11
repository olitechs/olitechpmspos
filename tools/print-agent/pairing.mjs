import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Workstation pairing.
 *
 * A manager asks the app for a short code, a person types it on the POS machine,
 * and that machine keeps a random secret in its data directory. The database
 * stores only md5(secret), so a copy of the database cannot be replayed against
 * the print API.
 *
 * The secret never appears in a log, an HTTP response or the browser.
 */

const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 128;

export const PAIR_RPC = 'fn_redeem_print_agent_pairing';

export function createAgentSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/** Accepts "abcd-2345", "abcd 2345" or "ABCD2345" as the same code. */
export function normalizePairingCode(value) {
  return String(value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function isValidSecret(secret) {
  const value = String(secret ?? '');
  return value.length >= MIN_SECRET_LENGTH && value.length <= MAX_SECRET_LENGTH && /^[a-z0-9]+$/i.test(value);
}

export function readAgentCredential(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isValidSecret(parsed.secret)) return null;
    if (!parsed.credentialId || !parsed.propertyId) return null;
    return {
      credentialId: String(parsed.credentialId),
      propertyId: String(parsed.propertyId),
      agentName: String(parsed.agentName || 'POS computer'),
      secret: String(parsed.secret),
      pairedAt: parsed.pairedAt || null,
    };
  } catch (_) {
    // A missing or unreadable file means "not paired", never a crash at startup.
    return null;
  }
}

/** Writes the credential atomically with owner-only permissions. */
export function saveAgentCredential(file, credential) {
  if (!file) throw new Error('A credential file path is required.');
  if (!credential?.secret || !isValidSecret(credential.secret)) {
    throw new Error('Refusing to store a malformed workstation credential.');
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(credential, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows maps this to ACLs */ }
  return file;
}

export function clearAgentCredential(file) {
  try { fs.rmSync(file, { force: true }); } catch (_) { /* nothing to do */ }
}

const firstRow = (data) => (Array.isArray(data) ? data[0] : (data && typeof data === 'object' ? data : null));

/**
 * Exchanges a pairing code for this workstation's credential.
 * Returns the stored shape, including the secret — callers must not log it.
 */
export async function redeemPairingCode({
  code,
  supabase,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  secretFactory = createAgentSecret,
} = {}) {
  const normalized = normalizePairingCode(code);
  if (normalized.length < 6) {
    const error = new Error('Enter the pairing code shown in OliTechs.');
    error.code = 'PAIRING_CODE_REQUIRED';
    throw error;
  }

  const base = String(supabase?.url || '').trim().replace(/\/+$/, '');
  const key = String(supabase?.key || '').trim();
  if (!base || !key) {
    const error = new Error('This workstation has no Supabase configuration, so it cannot be paired. Reinstall the print agent.');
    error.code = 'PAIRING_UNAVAILABLE';
    throw error;
  }

  const secret = secretFactory();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(`${base}/rest/v1/rpc/${PAIR_RPC}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_code: normalized, p_token: secret }),
      signal: controller.signal,
    });
    body = await response.json().catch(() => ({}));
  } catch (error) {
    const wrapped = new Error(
      error?.name === 'AbortError'
        ? 'Pairing timed out. Check this computer can reach the internet, then try again.'
        : 'Pairing could not reach OliTechs. Check this computer is online, then try again.',
    );
    wrapped.code = 'PAIRING_UNREACHABLE';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = new Error(
      body?.message
      || body?.hint
      || 'That pairing code is not valid or has expired. Ask a manager for a new code.',
    );
    error.code = 'PAIRING_REJECTED';
    throw error;
  }

  const row = firstRow(body);
  if (!row?.credential_id || !row?.property_id) {
    const error = new Error('OliTechs did not return a workstation credential. Ask a manager for a new code.');
    error.code = 'PAIRING_REJECTED';
    throw error;
  }

  return {
    credentialId: String(row.credential_id),
    propertyId: String(row.property_id),
    agentName: String(row.agent_name || 'POS computer'),
    secret,
    pairedAt: new Date().toISOString(),
  };
}

/** Redeem and persist in one step. Never logs or returns the secret. */
export async function pairAgent({ code, tokenFile, supabase, logger = null, fetchImpl = globalThis.fetch, secretFactory } = {}) {
  const credential = await redeemPairingCode({ code, supabase, fetchImpl, secretFactory });
  saveAgentCredential(tokenFile, credential);
  try {
    logger?.info?.('print agent paired', {
      agentName: credential.agentName,
      propertyId: credential.propertyId,
      credentialId: credential.credentialId,
    });
  } catch (_) { /* ignore */ }

  return {
    credentialId: credential.credentialId,
    propertyId: credential.propertyId,
    agentName: credential.agentName,
    secret: credential.secret,
    pairedAt: credential.pairedAt,
  };
}
