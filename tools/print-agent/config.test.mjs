import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, resolveDataDir, isLoopbackHost, AGENT_VERSION } from './config.mjs';

const env = (overrides = {}) => ({ ...overrides });

test('defaults bind to loopback on port 8631 in console mode', () => {
  const config = loadConfig(env());
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8631);
  assert.equal(config.mode, 'console');
  assert.equal(config.version, AGENT_VERSION);
  assert.equal(config.hostWarning, null);
  assert.equal(config.lockFile, path.join(config.dataDir, 'agent.lock'));
  assert.equal(config.logDir, path.join(config.dataDir, 'logs'));
});

test('a non-loopback bind is forced back to loopback unless explicitly allowed', () => {
  const config = loadConfig(env({ PRINT_AGENT_HOST: '0.0.0.0' }));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.requestedHost, '0.0.0.0');
  assert.match(config.hostWarning, /stays on 127\.0\.0\.1/);
});

test('an explicit non-loopback opt-in keeps the address and still warns', () => {
  const config = loadConfig(env({ PRINT_AGENT_HOST: '192.168.1.10', PRINT_AGENT_ALLOW_NON_LOOPBACK: '1' }));
  assert.equal(config.host, '192.168.1.10');
  assert.match(config.hostWarning, /non-loopback address/);
});

test('an invalid port is rejected with a stable error code', () => {
  assert.throws(() => loadConfig(env({ PRINT_AGENT_PORT: 'eighty' })), (error) => error.code === 'PRINT_AGENT_PORT_INVALID');
  assert.throws(() => loadConfig(env({ PRINT_AGENT_PORT: '70000' })), (error) => error.code === 'PRINT_AGENT_PORT_INVALID');
  assert.equal(loadConfig(env({ PRINT_AGENT_PORT: '9100' })).port, 9100);
});

test('service mode and data directory come from the environment', () => {
  const config = loadConfig(env({ PRINT_AGENT_MODE: 'service', PRINT_AGENT_DATA_DIR: '/var/tmp/olitechs-test' }));
  assert.equal(config.mode, 'service');
  assert.equal(config.dataDir, path.resolve('/var/tmp/olitechs-test'));
  assert.equal(config.logDir, path.join(path.resolve('/var/tmp/olitechs-test'), 'logs'));
});

test('Windows resolves its writable state under ProgramData', () => {
  assert.equal(
    resolveDataDir({ ProgramData: 'C:\\ProgramData' }, 'win32'),
    path.join('C:\\ProgramData', 'OliTechs', 'PrintAgent'),
  );
});

test('allowed origins include the production app plus valid extras only', () => {
  const config = loadConfig(env({ PRINT_AGENT_ALLOWED_ORIGINS: 'https://pms.example.com,not-a-url,' }));
  assert.ok(config.allowedOrigins.includes('https://olitechpmspos.vercel.app'));
  assert.ok(config.allowedOrigins.includes('https://pms.example.com'));
  assert.deepEqual(config.ignoredOrigins, ['not-a-url']);
});

test('startup discovery can be disabled', () => {
  assert.equal(loadConfig(env()).discoverOnStart, true);
  assert.equal(loadConfig(env({ PRINT_AGENT_DISCOVER_ON_START: 'false' })).discoverOnStart, false);
});

test('shutdown and log settings are clamped to safe ranges', () => {
  const config = loadConfig(env({
    PRINT_AGENT_SHUTDOWN_TIMEOUT_MS: '1',
    PRINT_AGENT_LOG_MAX_BYTES: '1',
    PRINT_AGENT_LOG_MAX_FILES: '500',
  }));
  assert.equal(config.shutdownTimeoutMs, 1000);
  assert.equal(config.logMaxBytes, 10_000);
  assert.equal(config.logMaxFiles, 50);
});

test('loopback detection covers the supported spellings', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', ' LOCALHOST ']) {
    assert.equal(isLoopbackHost(host), true, `${host} should be loopback`);
  }
  assert.equal(isLoopbackHost('192.168.1.10'), false);
});
