import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentSecret,
  isValidSecret,
  normalizePairingCode,
  readAgentCredential,
  saveAgentCredential,
  clearAgentCredential,
  redeemPairingCode,
  pairAgent,
  PAIR_RPC,
} from './pairing.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-pair-')), 'agent-credential.json');
const jsonResponse = (body, { status = 200 } = {}) => ({ ok: status < 300, status, json: async () => body });
const supabase = { url: 'https://example.supabase.co', key: 'anon-key' };

test('a pairing code is accepted however staff type it', () => {
  assert.equal(normalizePairingCode('abcd-2345'), 'ABCD2345');
  assert.equal(normalizePairingCode(' ABCD 2345 '), 'ABCD2345');
  assert.equal(normalizePairingCode(null), '');
});

test('secrets are long random strings and malformed ones are refused', () => {
  const secret = createAgentSecret();
  assert.equal(secret.length, 64);
  assert.notEqual(secret, createAgentSecret());
  assert.equal(isValidSecret(secret), true);
  assert.equal(isValidSecret('short'), false);
  assert.equal(isValidSecret('z'.repeat(200)), false);
  assert.equal(isValidSecret(secret.replace(/[a-f]/, '!')), false);
});

test('the credential is stored owner-only and read back intact', { skip: process.platform === 'win32' ? 'POSIX permission bits are not used on Windows' : false }, () => {
  const file = tmpFile();
  const secret = createAgentSecret();
  saveAgentCredential(file, { credentialId: 'cred-1', propertyId: 'prop-1', agentName: 'Front desk PC', secret, pairedAt: '2026-11-11T00:00:00.000Z' });

  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const loaded = readAgentCredential(file);
  assert.equal(loaded.secret, secret);
  assert.equal(loaded.credentialId, 'cred-1');
  assert.equal(loaded.propertyId, 'prop-1');
  assert.equal(loaded.agentName, 'Front desk PC');
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'the atomic temp file must not be left behind');
});

test('an unreadable or malformed credential file means "not paired", not a crash', () => {
  const file = tmpFile();
  assert.equal(readAgentCredential(file), null);
  fs.writeFileSync(file, '{not json');
  assert.equal(readAgentCredential(file), null);
  fs.writeFileSync(file, JSON.stringify({ credentialId: 'c', propertyId: 'p', secret: 'too-short' }));
  assert.equal(readAgentCredential(file), null);
});

test('saving refuses a malformed secret so a bad pairing cannot be persisted', () => {
  assert.throws(() => saveAgentCredential(tmpFile(), { credentialId: 'c', propertyId: 'p', secret: 'nope' }), /malformed/i);
});

test('a credential can be cleared when a workstation is retired', () => {
  const file = tmpFile();
  saveAgentCredential(file, { credentialId: 'c', propertyId: 'p', secret: createAgentSecret() });
  clearAgentCredential(file);
  assert.equal(fs.existsSync(file), false);
  assert.equal(readAgentCredential(file), null);
});

test('redeeming posts the code and keeps the returned property', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return jsonResponse([{ credential_id: 'cred-9', property_id: 'prop-9', agent_name: 'Reception PC' }]);
  };

  const credential = await redeemPairingCode({ code: 'abcd-2345', supabase, fetchImpl });
  assert.equal(request.url, `https://example.supabase.co/rest/v1/rpc/${PAIR_RPC}`);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.apikey, 'anon-key');
  const body = JSON.parse(request.init.body);
  assert.equal(body.p_code, 'ABCD2345');
  assert.equal(body.p_token, credential.secret);
  assert.ok(body.p_token.length >= 32);

  assert.equal(credential.credentialId, 'cred-9');
  assert.equal(credential.propertyId, 'prop-9');
  assert.equal(credential.agentName, 'Reception PC');
});

test('a rejected code surfaces the database message and stores nothing', async () => {
  await assert.rejects(
    () => redeemPairingCode({
      code: 'ABCD2345',
      supabase,
      fetchImpl: async () => jsonResponse({ message: 'That pairing code is not valid or has expired.' }, { status: 400 }),
    }),
    (error) => error.code === 'PAIRING_REJECTED' && /expired/.test(error.message),
  );
});

test('an unreachable server says so in plain language', async () => {
  await assert.rejects(
    () => redeemPairingCode({
      code: 'ABCD2345',
      supabase,
      fetchImpl: async () => { const error = new Error('fetch failed'); error.name = 'TypeError'; throw error; },
    }),
    (error) => error.code === 'PAIRING_UNREACHABLE' && /online/.test(error.message),
  );
});

test('an unconfigured workstation cannot attempt pairing', async () => {
  await assert.rejects(
    () => redeemPairingCode({ code: 'ABCD2345', supabase: null, fetchImpl: async () => jsonResponse([]) }),
    (error) => error.code === 'PAIRING_UNAVAILABLE',
  );
});

test('pairing persists the credential and never logs the secret', async () => {
  const file = tmpFile();
  const logs = [];
  const credential = await pairAgent({
    code: 'ABCD2345',
    tokenFile: file,
    supabase,
    logger: { info: (message, fields) => logs.push({ message, fields }) },
    fetchImpl: async () => jsonResponse([{ credential_id: 'cred-2', property_id: 'prop-2', agent_name: 'Bar PC' }]),
    secretFactory: () => 'a'.repeat(64),
  });

  assert.equal(credential.secret, 'a'.repeat(64));
  assert.equal(readAgentCredential(file).secret, 'a'.repeat(64));
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('a'.repeat(64)), false, 'the secret must never reach a log');
  assert.match(serialized, /Bar PC/);
});
