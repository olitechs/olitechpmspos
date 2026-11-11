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
