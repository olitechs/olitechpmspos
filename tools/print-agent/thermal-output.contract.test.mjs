import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('print agent uses shared configurable finalizer and waits for the TCP write to drain', async () => {
  const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("import { buildEscPosPayload } from '../../src/services/escposJob.js'"));
  assert.ok(source.includes('Buffer.from(buildEscPosPayload(body, settings), \'latin1\')'));
  assert.ok(source.includes('socket.write(payload, (error) => {'));
  assert.ok(source.includes("socket.once('drain'"));
  assert.ok(source.includes("socket.once('close'"));
  assert.ok(source.includes('closed before the complete job drained'));
  assert.ok(source.includes('socket.end();'));
  assert.ok(source.includes('const printerWriteQueues = new Map()'));
  assert.ok(source.includes('writeTcpNow(host, port, payload)'));
  assert.ok(!source.includes('socket.end(payload)'));
  assert.ok(!source.includes('setTimeout(() => finish(null), 1800)'));
});

test('legacy Supabase print proxy delegates its ending to the shared finalizer', async () => {
  const source = await readFile(new URL('../../supabase/functions/print-proxy/index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("import { finishPrintJob } from '../../../src/services/escposJob.js'"));
  assert.ok(source.includes('encoder.encode(finishPrintJob(printSettings))'));
  assert.ok(!source.includes('0x1d, 0x56, 0x00'));
  assert.ok(!source.includes('escPos.cut'));
});
