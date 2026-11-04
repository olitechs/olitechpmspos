import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Print Agent supports Private Network Access only after origin validation', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');

  const originGuard = source.indexOf('if (!isAllowedOrigin(origin))');
  const preflight = source.indexOf("if (req.method === 'OPTIONS')");
  assert.ok(originGuard >= 0 && preflight > originGuard, 'origin validation must run before preflight handling');

  assert.match(source, /access-control-request-private-network/);
  assert.match(source, /'Access-Control-Allow-Private-Network': 'true'/);
  assert.match(source, /privateNetworkRequested\s*\?/);
  assert.match(source, /TRUSTED_ORIGINS/);
});

test('Print Agent keeps loopback binding and restricts raw printer endpoints', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');

  assert.match(source, /PRINT_AGENT_HOST \|\| '127\.0\.0\.1'/);
  assert.match(source, /const ALLOWED_PORTS = new Set\(\[9100, 9101, 9102\]\)/);
  assert.match(source, /function validEndpoint\(host, port\)/);
  assert.match(source, /if \(!validEndpoint\(host, port\)\)/);
});
