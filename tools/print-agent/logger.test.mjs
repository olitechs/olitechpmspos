import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, redactValue, REDACTED } from './logger.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'olitechs-logs-'));

const readRecords = (file) => fs.readFileSync(file, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

test('writes one JSON record per call with a timestamp, level and fields', () => {
  const dir = tempDir();
  const logger = createLogger({ dir, now: () => new Date('2026-11-11T10:00:00.000Z') });
  logger.info('print agent listening', { port: 8631 });

  const records = readRecords(logger.file);
  assert.equal(records.length, 1);
  assert.equal(records[0].ts, '2026-11-11T10:00:00.000Z');
  assert.equal(records[0].level, 'info');
  assert.equal(records[0].msg, 'print agent listening');
  assert.equal(records[0].port, 8631);
});

test('child loggers keep their bindings on every record', () => {
  const dir = tempDir();
  const logger = createLogger({ dir });
  const jobLogger = logger.child({ jobId: 'job-1' });
  jobLogger.warn('printer did not answer', { printer: 'Kitchen' });

  const [record] = readRecords(logger.file);
  assert.equal(record.jobId, 'job-1');
  assert.equal(record.printer, 'Kitchen');
  assert.equal(record.level, 'warn');
});

test('sensitive keys are redacted at the top level and nested', () => {
  const dir = tempDir();
  const logger = createLogger({ dir });
  logger.info('request handled', {
    propertyId: 'prop-1',
    token: 'super-secret-token',
    service_role_key: 'eyJhbGciOi...',
    escposBase64: 'G0AbAA==',
    contentHtml: '<div>Guest: Jane Doe</div>',
    nested: { password: 'hunter2', guest: 'Jane Doe', keep: 'visible' },
    list: [{ authorization: 'Bearer abc' }],
  });

  const [record] = readRecords(logger.file);
  assert.equal(record.propertyId, 'prop-1');
  assert.equal(record.token, REDACTED);
  assert.equal(record.service_role_key, REDACTED);
  assert.equal(record.escposBase64, REDACTED);
  assert.equal(record.contentHtml, REDACTED);
  assert.equal(record.nested.password, REDACTED);
  assert.equal(record.nested.guest, REDACTED);
  assert.equal(record.nested.keep, 'visible');
  assert.equal(record.list[0].authorization, REDACTED);
  assert.ok(!fs.readFileSync(logger.file, 'utf8').includes('hunter2'));
  assert.ok(!fs.readFileSync(logger.file, 'utf8').includes('Jane Doe'));
});

test('records below the configured level are dropped', () => {
  const dir = tempDir();
  const logger = createLogger({ dir, level: 'warn' });
  logger.debug('noise');
  logger.info('also noise');
  logger.error('real problem', { code: 'AGENT_PORT_IN_USE' });

  const records = readRecords(logger.file);
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'error');
});

test('rotates by size and keeps a bounded number of files', () => {
  const dir = tempDir();
  const logger = createLogger({ dir, maxBytes: 400, maxFiles: 3 });
  for (let index = 0; index < 40; index += 1) {
    logger.info('job processed', { index, note: 'x'.repeat(60) });
  }

  assert.ok(fs.existsSync(`${logger.file}.1`), 'the first rotation should exist');
  const files = fs.readdirSync(dir).filter((name) => name.startsWith('agent.log'));
  assert.ok(files.length <= 4, `expected at most 4 log files, found ${files.length}`);
  for (const name of files) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').filter(Boolean)) {
      assert.doesNotThrow(() => JSON.parse(line), `${name} should contain only complete JSON records`);
    }
  }
});

test('redactValue tolerates errors, deep trees and long strings', () => {
  const error = Object.assign(new Error('printer offline'), { code: 'WINDOWS_PRINTER_ERROR' });
  assert.deepEqual(redactValue(error), { name: 'Error', message: 'printer offline', code: 'WINDOWS_PRINTER_ERROR' });

  let deep = { value: 'bottom' };
  for (let depth = 0; depth < 12; depth += 1) deep = { nested: deep };
  assert.doesNotThrow(() => JSON.stringify(redactValue(deep)));

  const long = redactValue('y'.repeat(5000));
  assert.ok(long.length < 2100);
});
