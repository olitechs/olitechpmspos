import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitLinesByPrinterGroup, pickOrderPrinter } from './printRoutingCore.js';

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

test('production POS and kitchen printing route by department, not by the retired feature flag', () => {
  const pos = read('../components/pos/POSContainer.jsx');
  const kitchen = read('../components/modules/KitchenDisplay.jsx');
  const service = read('./printService.js');

  for (const source of [pos, kitchen]) {
    assert.doesNotMatch(source, /isPrinterGroupRoutingEnabled|printRoutedOrder/);
    assert.match(source, /printOrderByCategory/);
  }
  assert.match(service, /planDepartmentTickets\(order\.items \|\| \[\]/);
  assert.match(service, /printersForDepartment\(ticket\.department, printers\)/);
  assert.match(service, /printer_groups/);
  assert.doesNotMatch(service, /from\('print_jobs'\)/);
});

test('printer assignment embedding explicitly selects the property-scoped foreign key', () => {
  const service = read('./printService.js');
  assert.match(
    service,
    /from\(['"]printer_assignments['"]\)\.select\(['"]\*,\s*property_printers!printer_assignments_property_printer_fk\(\*\)['"]\)/,
    'the embed must name the composite property/printer FK to avoid PostgREST relationship ambiguity'
  );
});


test('Windows print-agent test aliases use the normalized route to send the test receipt', () => {
  const agent = read('../../tools/print-agent/server.mjs');
  assert.match(agent, /escPosPayload\(body\.text,\s*route\s*===\s*['"]\/windows-test['"],/);
  assert.doesNotMatch(agent, /escPosPayload\(body\.text, url\.pathname === ['"]\/windows-test['"]\)/);
});
