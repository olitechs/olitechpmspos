import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitLinesByPrinterGroup, planPrinterJobs, pickOrderPrinter } from './printRoutingCore.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('printer routing splits each order line by its configured category group', () => {
  const groups = [
    { id: 'kitchen', name: 'Kitchen', productionCenter: 'Kitchen', categoryIds: ['food'] },
    { id: 'bar', name: 'Bar', productionCenter: 'Bar', categoryIds: ['drinks'] },
  ];
  const categories = [{ id: 'food', name: 'Food' }, { id: 'drinks', name: 'Drinks' }];
  const { buckets, unrouted } = splitLinesByPrinterGroup([
    { name: 'Burger', categoryId: 'food', qty: 1 },
    { name: 'Juice', category: 'drinks', qty: 2 },
    { name: 'Unknown', categoryId: 'missing', qty: 1 },
  ], { groups, categories });
  assert.deepEqual(buckets.map(bucket => [bucket.group.id, bucket.lines.map(line => line.name)]), [
    ['kitchen', ['Burger']],
    ['bar', ['Juice']],
  ]);
  assert.deepEqual(unrouted.map(line => line.name), ['Unknown']);
});

test('a line assigned to multiple groups is routed to each configured production group', () => {
  const { buckets, unrouted } = splitLinesByPrinterGroup(
    [{ name: 'Special', categoryId: 'special' }],
    { groups: [
      { id: 'kitchen', categoryIds: ['special'] },
      { id: 'expo', categoryIds: ['special'] },
    ], categories: [] }
  );
  assert.deepEqual(buckets.map(bucket => bucket.group.id), ['kitchen', 'expo']);
  assert.equal(unrouted.length, 0);
});

test('printer selection requires the order purpose, a ready printer, and matching center', () => {
  const printers = [
    { id: 'offline', purposes: ['order'], center: 'Kitchen' },
    { id: 'receipt', purposes: ['receipt'], center: 'Kitchen' },
    { id: 'bar', purposes: ['order'], center: 'Bar' },
    { id: 'kitchen', purposes: ['order'], center: 'Kitchen' },
  ];
  const selected = pickOrderPrinter('Kitchen', printers, printer => printer.id === 'kitchen');
  assert.equal(selected.id, 'kitchen');
  assert.equal(pickOrderPrinter('Dessert', printers, () => true), null);
});

test('KOT/BOT dispatch preflights routing and writes a single atomic batch of kitchen jobs', () => {
  const service = read('./printRoutingService.js');
  assert.match(service, /if \(unrouted\.length\)/);
  assert.match(service, /const missing = plans\.filter\(plan => !plan\.printers\.length\)/);
  assert.match(service, /from\('print_jobs'\)\.insert\(rows\)\.select\(\)/);
  assert.doesNotMatch(service, /is_receipt/);
});

test('POS group-routing failures do not silently fall back to the legacy printer assignment path', () => {
  const pos = read('../components/pos/POSContainer.jsx');
  assert.match(pos, /if \(isPrinterGroupRoutingEnabled\(\)\)/);
  assert.doesNotMatch(pos, /catch\(\(\) => printOrder\(\)\)/);
});
