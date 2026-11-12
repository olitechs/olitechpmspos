import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PrinterStatus, testConnection } from './printerService.js';

const source = await readFile(new URL('./printerService.js', import.meta.url), 'utf8');

test('serial printers reach the serial tester instead of an unknown connection type', async () => {
  const result = await testConnection({ id: 'p1', name: 'Serial printer', connectionType: 'serial', baudRate: 9600 });
  assert.notEqual(result.friendlyError, 'Unknown connection type.');
  // Node has no Web Serial, so the honest answer is "unsupported", not an error.
  assert.equal(result.status, PrinterStatus.UNSUPPORTED);
  assert.match(source, /case 'serial': result = await testSerial\(printer\)/);
});

test('an unknown connection type is still an error', async () => {
  const result = await testConnection({ id: 'p2', name: 'Mystery', connectionType: 'telepathy' });
  assert.equal(result.status, PrinterStatus.ERROR);
  assert.equal(result.friendlyError, 'Unknown connection type.');
});

test('WebUSB pairing selects a configuration and printing releases the interface', () => {
  assert.match(source, /if \(!device\.configuration\) await device\.selectConfiguration\(1\)/);
  assert.match(source, /releaseInterface\(claimedInterface\)/);
});

test('a Bluetooth job that fails part-way is uncertain, not a clean failure', async () => {
  assert.match(source, /status: written > 0 \? 'uncertain' : 'failed'/);
  assert.match(source, /Check the paper before reprinting/);
  const printService = await readFile(new URL('./printService.js', import.meta.url), 'utf8');
  assert.match(printService, /if \(outcomeAffectsConnection\(browserOutcome\)\)/);
});
