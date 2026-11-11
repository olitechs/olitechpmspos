import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPairingCode,
  sendPairingCode,
  pairWorkstation,
  listPairedWorkstations,
  revokePairedWorkstation,
  PAIRING_RPC,
} from './printerAgentPairing.js';

const jsonResponse = (body, { status = 200 } = {}) => ({ ok: status < 300, status, json: async () => body });

function fakeClient({ data = [{ credential_id: 'cred-1', code: 'ABCD2345', expires_at: '2026-11-11T10:10:00Z' }], error = null } = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return { data, error };
    },
  };
}

test('a manager gets a short code for this property', async () => {
  const client = fakeClient();
  const pairing = await createPairingCode({ client, propertyId: 'prop-1', agentName: 'Front desk PC' });
  assert.equal(pairing.code, 'ABCD2345');
  assert.equal(client.calls[0].name, PAIRING_RPC);
  assert.deepEqual(client.calls[0].args, { p_property_id: 'prop-1', p_name: 'Front desk PC' });
});

test('pairing without a property is refused before any database call', async () => {
  const client = fakeClient();
  await assert.rejects(() => createPairingCode({ client, propertyId: '' }), /property/i);
  assert.equal(client.calls.length, 0);
});

test('a database error is surfaced, not swallowed', async () => {
  const client = fakeClient({ data: null, error: new Error('Only a manager can pair a print workstation.') });
  await assert.rejects(() => createPairingCode({ client, propertyId: 'prop-1' }), /Only a manager/);
});

test('the code is handed to the local agent and the secret stays there', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return jsonResponse({ ok: true, paired: true, agentName: 'Front desk PC', propertyId: 'prop-1' });
  };

  const result = await sendPairingCode({ agentUrl: '127.0.0.1:8631/', code: 'ABCD2345', fetchImpl });
  assert.equal(request.url, '127.0.0.1:8631/pair');
  assert.equal(JSON.parse(request.init.body).code, 'ABCD2345');
  assert.equal(result.ok, true);
  assert.equal(result.agentName, 'Front desk PC');
  assert.equal(result.secret, undefined, 'a workstation secret must never reach the browser');
});

test('an agent that is not running says so in plain language', async () => {
  const result = await sendPairingCode({
    agentUrl: 'http://127.0.0.1:8631',
    code: 'ABCD2345',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AGENT_UNREACHABLE');
  assert.match(result.message, /not reachable/);
});

test('a rejected code keeps the database message', async () => {
  const result = await sendPairingCode({
    agentUrl: 'http://127.0.0.1:8631',
    code: 'ZZZZ9999',
    fetchImpl: async () => jsonResponse({ ok: false, code: 'PAIRING_REJECTED', message: 'That pairing code is not valid or has expired.' }, { status: 400 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAIRING_REJECTED');
  assert.match(result.message, /expired/);
});

test('one call pairs the computer end to end', async () => {
  const client = fakeClient();
  const result = await pairWorkstation({
    client,
    propertyId: 'prop-1',
    agentUrl: 'http://127.0.0.1:8631',
    agentName: 'Bar PC',
    fetchImpl: async () => jsonResponse({ ok: true, agentName: 'Bar PC', propertyId: 'prop-1' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'ABCD2345');
  assert.equal(client.calls[0].args.p_name, 'Bar PC');
});

test('workstations can be listed and unpaired', async () => {
  const client = fakeClient({ data: [{ id: 'cred-1', name: 'Front desk PC', revoked_at: null }] });
  const rows = await listPairedWorkstations({ client, propertyId: 'prop-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Front desk PC');

  const revoked = await revokePairedWorkstation({ client, propertyId: 'prop-1', credentialId: 'cred-1' });
  assert.equal(revoked.ok, true);
  assert.equal(client.calls.at(-1).args.p_credential_id, 'cred-1');
});
