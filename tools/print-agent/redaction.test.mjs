import test from 'node:test';
import assert from 'node:assert/strict';
import { redactValue, isSensitiveKey, REDACTED } from './logger.mjs';

test('workstation secrets are redacted under any field name', () => {
  const secret = 'a'.repeat(64);
  const clean = redactValue({
    p_token: secret,
    tokenHash: 'abc',
    agentSecret: secret,
    pairingCode: 'ABCD2345',
    credentialSecret: secret,
    idempotencyKey: 'receipt-1',
    credentialId: 'cred-1',
    code: 'ETIMEDOUT',
  });

  assert.equal(clean.p_token, REDACTED);
  assert.equal(clean.tokenHash, REDACTED);
  assert.equal(clean.agentSecret, REDACTED);
  assert.equal(clean.pairingCode, REDACTED);
  assert.equal(clean.credentialSecret, REDACTED);
  assert.equal(clean.idempotencyKey, 'receipt-1', 'a job key is not a secret and stays debuggable');
  assert.equal(clean.credentialId, 'cred-1', 'an identifier is not a secret');
  assert.equal(clean.code, 'ETIMEDOUT');
});

test('nested credentials cannot slip through', () => {
  const clean = redactValue({ request: { headers: { authorization: 'Bearer abc', 'x-agent-token': 'abc' } } });
  assert.equal(clean.request.headers.authorization, REDACTED);
  assert.equal(clean.request.headers['x-agent-token'], REDACTED);
});

test('sensitive key detection normalises separators', () => {
  assert.equal(isSensitiveKey('p_token'), true);
  assert.equal(isSensitiveKey('PRINT_AGENT_TOKEN'), true);
  assert.equal(isSensitiveKey('agent-secret'), true);
  assert.equal(isSensitiveKey('tokenFile'), false, 'a file path is not itself a secret');
  assert.equal(isSensitiveKey('printerName'), false);
  assert.equal(isSensitiveKey('host'), false);
});
