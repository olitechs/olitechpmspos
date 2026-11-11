import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRINTER_ROLES,
  WIZARD_STEPS,
  assignmentTypesForRole,
  buildPrinterSetup,
  canContinue,
  describeAgentFailure,
  describeTestOutcome,
  detectAgent,
  isSupportedIpv4,
  listAvailablePrinters,
  manualNetworkPrinter,
  nextStep,
  normalizeAgentBaseUrl,
  previousStep,
  printerTypeForRole,
  savePrinterSetup,
} from './printerSetupCore.js';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fakeFetch = (routes) => async (url) => {
  const path = new URL(url).pathname;
  const handler = routes[path];
  if (!handler) throw new Error(`unexpected request: ${path}`);
  return handler(url);
};

test('agent base URLs are normalised including legacy suffixes', () => {
  assert.equal(normalizeAgentBaseUrl(), 'http://127.0.0.1:8631');
  assert.equal(normalizeAgentBaseUrl('127.0.0.1:8631/'), 'http://127.0.0.1:8631');
  assert.equal(normalizeAgentBaseUrl('http://localhost:8631/api/'), 'http://localhost:8631');
  assert.equal(normalizeAgentBaseUrl('https://example.test/print-agent'), 'https://example.test');
});

test('agent detection reports a running agent with its version', async () => {
  const result = await detectAgent('http://127.0.0.1:8631', {
    fetchImpl: fakeFetch({ '/health': async () => jsonResponse({ ok: true, version: '2.1.0', mode: 'service' }) }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, '2.1.0');
  assert.equal(result.mode, 'service');
});

test('agent detection never throws when the agent is missing or unhealthy', async () => {
  const down = await detectAgent(undefined, { fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.equal(down.code, 'LOCAL_AGENT_UNAVAILABLE');
  assert.match(describeAgentFailure(down), /not running on this computer/i);

  const unhealthy = await detectAgent(undefined, {
    fetchImpl: fakeFetch({ '/health': async () => jsonResponse({ ok: false }, 500) }),
  });
  assert.equal(unhealthy.ok, false);
  assert.equal(unhealthy.code, 'HTTP_500');
});

test('discovery merges Windows printers and LAN printers with friendly labels', async () => {
  const result = await listAvailablePrinters('http://127.0.0.1:8631', {
    fetchImpl: fakeFetch({
      '/windows-printers': async () => jsonResponse({
        ok: true,
        printers: [{ Name: 'EPSON TM-T20III', DriverName: 'EPSON Advanced Printer Driver' }],
      }),
      '/discover': async () => jsonResponse({
        ok: true,
        printers: [{ host: '192.168.1.50', port: 9100 }, { host: 'not-an-ip', port: 9100 }],
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.printers.length, 2);
  assert.equal(result.printers[0].connection_type, 'windows_printer');
  assert.equal(result.printers[0].name, 'EPSON TM-T20III');
  assert.equal(result.printers[0].detail, 'EPSON Advanced Printer Driver');
  assert.equal(result.printers[1].name, 'Network printer 192.168.1.50');
  assert.equal(result.printers[1].port, 9100);
  assert.deepEqual(result.warnings, []);
});

test('discovery still returns printers when one source fails', async () => {
  const result = await listAvailablePrinters(undefined, {
    fetchImpl: fakeFetch({
      '/windows-printers': async () => { throw new Error('spooler unavailable'); },
      '/discover': async () => jsonResponse({ ok: true, printers: [{ host: '10.0.0.5', port: 9101 }] }),
    }),
  });
  assert.equal(result.printers.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Windows-installed printers/);
});

test('manual entry validates the address and port with plain messages', () => {
  assert.equal(manualNetworkPrinter({ host: '192.168.1.50' }).ok, true);
  const badAddress = manualNetworkPrinter({ host: 'printer.local' });
  assert.equal(badAddress.ok, false);
  assert.match(badAddress.message, /four numbers/);
  const badPort = manualNetworkPrinter({ host: '192.168.1.50', port: 515 });
  assert.equal(badPort.ok, false);
  assert.match(badPort.message, /9100/);
  assert.equal(isSupportedIpv4('10.1.2.3'), true);
  assert.equal(isSupportedIpv4('10.1.2'), false);
});

test('each role maps to the assignment types the POS actually reads', () => {
  assert.deepEqual(assignmentTypesForRole('receipt'), ['final_receipts']);
  assert.deepEqual(assignmentTypesForRole('kitchen'), ['food_orders', 'void_food_orders']);
  assert.deepEqual(assignmentTypesForRole('bar'), ['drinks_orders', 'void_drinks_orders']);
  assert.deepEqual(assignmentTypesForRole('front_desk'), ['unsettled_bills']);
  assert.deepEqual(assignmentTypesForRole('shift_reports'), ['shift_reports']);
  assert.deepEqual(assignmentTypesForRole('unknown'), []);
  assert.equal(printerTypeForRole('kitchen'), 'kitchen');
  assert.equal(printerTypeForRole('receipt'), 'receipt_80mm');
  for (const role of PRINTER_ROLES) assert.ok(role.label && role.description);
});

test('the saved printer row matches the property_printers contract', () => {
  const built = buildPrinterSetup({
    printer: {
      id: 'windows:EPSON TM-T20III',
      name: 'EPSON TM-T20III',
      connection_type: 'windows_printer',
      windows_printer_name: 'EPSON TM-T20III',
    },
    roleId: 'kitchen',
    name: '  Kitchen pass  ',
    paperWidth: '58mm',
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.assignmentTypes, ['food_orders', 'void_food_orders']);
  assert.equal(built.payload.name, 'Kitchen pass');
  assert.equal(built.payload.type, 'kitchen');
  assert.equal(built.payload.connection_type, 'windows_printer');
  assert.equal(built.payload.windows_printer_name, 'EPSON TM-T20III');
  assert.equal(built.payload.ip_address, null);
  assert.equal(built.payload.paper_width, '58mm');
  assert.equal(built.payload.last_status, 'testing');
  assert.equal(built.payload.is_online, false);
  assert.equal(built.payload.agent_url, 'http://127.0.0.1:8631');
});

test('network printers keep their validated IPv4 address and port', () => {
  const built = buildPrinterSetup({
    printer: { connection_type: 'network_ip', ip_address: '192.168.2.117', port: 9100, name: 'Network printer 192.168.2.117' },
    roleId: 'receipt',
    name: 'Reception receipt',
  });
  assert.equal(built.ok, true);
  assert.equal(built.payload.ip_address, '192.168.2.117');
  assert.equal(built.payload.port, 9100);
  assert.equal(built.payload.windows_printer_name, null);
  assert.equal(built.payload.paper_width, '80mm');
});

test('invalid setup is refused with a message a receptionist can act on', () => {
  assert.equal(buildPrinterSetup({}).ok, false);
  assert.match(buildPrinterSetup({ printer: { connection_type: 'network_ip', ip_address: 'abc' }, roleId: 'receipt', name: 'x' }).message, /not valid/);
  assert.match(buildPrinterSetup({ printer: { connection_type: 'windows_printer', windows_printer_name: '' }, roleId: 'receipt', name: 'x' }).message, /Windows-installed/);
  assert.match(buildPrinterSetup({ printer: { connection_type: 'windows_printer', windows_printer_name: 'P' }, roleId: 'receipt', name: '   ' }).message, /name/);
  assert.match(buildPrinterSetup({ printer: { connection_type: 'windows_printer', windows_printer_name: 'P' }, roleId: 'nope', name: 'x' }).message, /used for/);
});

test('the wizard cannot be advanced without the required answers', () => {
  assert.equal(canContinue('agent', {}), false);
  assert.equal(canContinue('agent', { agent: { ok: true } }), true);
  assert.equal(canContinue('printer', {}), false);
  assert.equal(canContinue('printer', { selection: { id: 'x' } }), true);
  assert.equal(canContinue('role', { roleId: 'kitchen' }), true);
  assert.equal(canContinue('settings', { name: '   ' }), false);
  assert.equal(canContinue('settings', { name: 'Receipt' }), true);
  assert.equal(canContinue('test', {}), false, 'a test must be attempted before confirming');
  assert.equal(canContinue('test', { testAttempted: true }), true);
});

test('steps move forward and back without running off the ends', () => {
  assert.equal(nextStep('agent'), 'printer');
  assert.equal(nextStep('settings'), 'test');
  assert.equal(nextStep('done'), 'done');
  assert.equal(previousStep('printer'), 'agent');
  assert.equal(previousStep('agent'), 'agent');
  assert.deepEqual([...WIZARD_STEPS], ['agent', 'printer', 'role', 'settings', 'test', 'done']);
});

test('print results become clear next actions', () => {
  assert.equal(describeTestOutcome({ ok: true }).ok, true);
  assert.match(describeTestOutcome({ ok: true }).detail, /Check the printer/);

  const timeout = describeTestOutcome({ ok: false, code: 'TIMEOUT' });
  assert.equal(timeout.title, 'Printer did not answer');
  assert.match(timeout.detail, /switched on/);

  const agentDown = describeTestOutcome({ ok: false, code: 'LOCAL_AGENT_UNAVAILABLE' });
  assert.equal(agentDown.title, 'Print agent not running');

  const notFound = describeTestOutcome({ ok: false, friendlyError: 'The selected Windows printer is not installed or is currently unavailable.' });
  assert.equal(notFound.title, 'Printer is not available');
});

/**
 * Minimal Supabase-shaped fake: records every call, lets a test force an error
 * on a specific table, and supports the chains the real client uses
 * (`insert().select().single()`, `insert()` awaited, `delete().eq().eq()`,
 * `update().eq().eq().select().single()`).
 */
function fakeSupabase({ errorOn = null, errorMessage = 'database error' } = {}) {
  const calls = [];
  const failure = (table, op) => (errorOn === `${table}.${op}` ? { data: null, error: { message: errorMessage } } : null);

  const client = {
    calls,
    from(table) {
      const chain = {
        eq() { return chain; },
        then(resolve, reject) { return Promise.resolve(failure(table, 'delete') || { data: null, error: null }).then(resolve, reject); },
        insert(payload) {
          calls.push({ table, op: 'insert', payload });
          const failed = failure(table, 'insert');
          const result = failed || { data: table === 'property_printers' ? { id: 'printer-1', ...payload } : null, error: null };
          const thenable = Promise.resolve(result);
          thenable.select = () => ({ single: async () => result });
          return thenable;
        },
        update(payload) {
          calls.push({ table, op: 'update', payload });
          const failed = failure(table, 'update');
          const result = failed || { data: { id: 'printer-existing', ...payload }, error: null };
          return { eq() { return this; }, select: () => ({ single: async () => result }) };
        },
        delete() {
          calls.push({ table, op: 'delete' });
          return chain;
        },
      };
      return chain;
    },
  };
  return client;
}

const windowsSetup = () => buildPrinterSetup({
  printer: {
    name: 'EPSON TM-T20III',
    connection_type: 'windows_printer',
    windows_printer_name: 'EPSON TM-T20III',
  },
  roleId: 'kitchen',
  name: 'Kitchen pass',
});

test('saving a printer writes the row and its routing', async () => {
  const client = fakeSupabase();
  const saved = await savePrinterSetup({ client, propertyId: 'property-1', setup: windowsSetup(), agentUrl: 'localhost:8631/' });

  assert.equal(saved.ok, true);
  assert.equal(saved.printer.id, 'printer-1');
  assert.deepEqual(saved.assignmentTypes, ['food_orders', 'void_food_orders']);

  const printerInsert = client.calls.find((call) => call.table === 'property_printers' && call.op === 'insert');
  assert.equal(printerInsert.payload.property_id, 'property-1');
  assert.equal(printerInsert.payload.agent_url, 'http://localhost:8631');
  assert.equal(printerInsert.payload.windows_printer_name, 'EPSON TM-T20III');

  const assignmentInsert = client.calls.find((call) => call.table === 'printer_assignments' && call.op === 'insert');
  assert.deepEqual(assignmentInsert.payload.map((row) => row.assignment_type), ['food_orders', 'void_food_orders']);
  assert.ok(assignmentInsert.payload.every((row) => row.printer_id === 'printer-1'));
});

test('a failed routing save removes the new printer instead of leaving it half configured', async () => {
  const client = fakeSupabase({ errorOn: 'printer_assignments.insert', errorMessage: 'routing write denied' });
  const saved = await savePrinterSetup({ client, propertyId: 'property-1', setup: windowsSetup() });

  assert.equal(saved.ok, false);
  assert.match(saved.message, /routing write denied/);
  const rollback = client.calls.filter((call) => call.table === 'property_printers' && call.op === 'delete');
  assert.equal(rollback.length, 1, 'the orphaned printer row must be deleted');
});

test('retrying updates the existing printer instead of duplicating it', async () => {
  const client = fakeSupabase();
  const saved = await savePrinterSetup({
    client,
    propertyId: 'property-1',
    setup: windowsSetup(),
    existingPrinterId: 'printer-existing',
  });

  assert.equal(saved.ok, true);
  assert.equal(client.calls.filter((call) => call.table === 'property_printers' && call.op === 'insert').length, 0);
  const update = client.calls.find((call) => call.table === 'property_printers' && call.op === 'update');
  assert.equal(update.payload.property_id, 'property-1');
  assert.equal(client.calls.filter((call) => call.table === 'printer_assignments' && call.op === 'delete').length, 1);
});

test('nothing is written without a property or valid setup', async () => {
  const client = fakeSupabase();
  const noProperty = await savePrinterSetup({ client, propertyId: null, setup: windowsSetup() });
  assert.equal(noProperty.ok, false);
  assert.match(noProperty.message, /property/i);

  const invalidSetup = await savePrinterSetup({ client, propertyId: 'property-1', setup: { ok: false, message: 'Choose a printer first.' } });
  assert.equal(invalidSetup.ok, false);
  assert.match(invalidSetup.message, /Choose a printer/);
  assert.equal(client.calls.length, 0);
});

test('a missing client fails clearly instead of crashing the wizard', async () => {
  const saved = await savePrinterSetup({ propertyId: 'property-1', setup: windowsSetup() });
  assert.equal(saved.ok, false);
  assert.match(saved.message, /not connected to the database/i);
});
