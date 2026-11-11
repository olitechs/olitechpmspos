import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

// The queue only prevents duplicate prints if the app keeps sending the job id
// and the agent keeps reading it. These are cheap guards against a refactor
// quietly disabling that link.
test('the app sends its print job id to the agent as an idempotency key', async () => {
  const printService = await read('../../src/services/printService.js');

  assert.match(printService, /const agentOptions = \{ idempotencyKey: job\?\.id \|\| null \};/);
  assert.match(printService, /'X-Idempotency-Key': idempotencyKey/);
  assert.match(printService, /directTcpPrint\(printer, propertyId, text, 'print', finalThermalBase64, agentOptions\)/);
  assert.match(printService, /directWindowsPrint\(printer, propertyId, text, 'print', finalThermalBase64, agentOptions\)/);
});

test('the agent reads that key and journals an attempt before printing', async () => {
  const server = await read('./server.mjs');

  assert.match(server, /req\.headers\['x-idempotency-key'\]/);
  assert.match(server, /body\?\.idempotencyKey/);

  const attempt = server.indexOf('printQueue.markAttempt(job.id)');
  const delivery = server.indexOf('await deliverQueuedJob(job)');
  assert.ok(attempt > 0, 'the attempt must be journaled');
  assert.ok(delivery > attempt, 'the journal write must happen before bytes reach the printer');

  assert.match(server, /req\.method === 'GET' && route === '\/queue'/);
  assert.match(server, /req\.method === 'POST' && route === '\/queue\/retry'/);
  assert.match(server, /PRINT_OUTCOME_UNCERTAIN/);
});
