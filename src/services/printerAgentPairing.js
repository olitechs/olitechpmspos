import { normalizeAgentBaseUrl } from './printerHealthCore.js';

/**
 * Pairs the print agent on this computer with the signed-in property.
 *
 * The flow is deliberately short for staff: ask the database for a code, then
 * hand that code to the local agent. The agent's long-lived secret never comes
 * back to the browser — the browser is only a courier for a ten-minute code.
 */

export const PAIRING_RPC = 'fn_create_print_agent_pairing';
export const LIST_RPC = 'fn_list_print_agent_credentials';
export const REVOKE_RPC = 'fn_revoke_print_agent_credential';

const firstRow = (data) => (Array.isArray(data) ? data[0] : (data && typeof data === 'object' ? data : null));

export async function createPairingCode({ client, propertyId, agentName = 'POS computer' }) {
  if (!client) throw new Error('Pairing needs a database connection.');
  if (!propertyId) throw new Error('Open Printer Settings from the property you are pairing.');

  const { data, error } = await client.rpc(PAIRING_RPC, {
    p_property_id: propertyId,
    p_name: String(agentName || 'POS computer').slice(0, 100),
  });
  if (error) throw error;

  const row = firstRow(data);
  if (!row?.code) throw new Error('OliTechs did not return a pairing code. Try again.');
  return { code: String(row.code), credentialId: row.credential_id || null, expiresAt: row.expires_at || null };
}

export async function sendPairingCode({ agentUrl, code, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  const normalized = String(code || '').trim();
  if (!normalized) return { ok: false, message: 'A pairing code is required.' };

  const base = normalizeAgentBaseUrl(agentUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: normalized }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok) {
      return { ok: true, agentName: body.agentName || 'this computer', propertyId: body.propertyId || null };
    }
    return {
      ok: false,
      code: body?.code || `HTTP_${response.status}`,
      message: body?.message || 'This computer could not be paired. Ask a manager for a new code.',
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'PAIRING_TIMEOUT' : 'AGENT_UNREACHABLE',
      message: error?.name === 'AbortError'
        ? 'The print agent did not answer in time. Check it is running on this computer.'
        : 'The print agent is not reachable on this computer, so it cannot be paired.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One call for the UI: ask for a code, then hand it to the local agent. */
export async function pairWorkstation({ client, propertyId, agentUrl, agentName = 'POS computer', fetchImpl } = {}) {
  const pairing = await createPairingCode({ client, propertyId, agentName });
  const result = await sendPairingCode({ agentUrl, code: pairing.code, fetchImpl });
  return { ...result, code: pairing.code };
}

export async function listPairedWorkstations({ client, propertyId } = {}) {
  if (!client || !propertyId) return [];
  const { data, error } = await client.rpc(LIST_RPC, { p_property_id: propertyId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Cuts a workstation off. The RPC only allows owners/admins/managers and scopes
 * the update to this property; the agent's token hash is cleared immediately.
 * Jobs it was mid-way through become "needs checking" rather than silently lost.
 */
export async function revokePairedWorkstation({ client, propertyId, credentialId } = {}) {
  if (!client || !propertyId || !credentialId) throw new Error('Choose a workstation to unpair.');
  const { error } = await client.rpc(REVOKE_RPC, { p_property_id: propertyId, p_credential_id: credentialId });
  if (error) throw error;
  return { ok: true };
}
