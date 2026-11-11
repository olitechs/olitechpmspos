// Pure logic behind the printer setup wizard. No React, no I/O of its own:
// every network call takes an injected fetch so the flow stays testable.

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:8631';
export const WIZARD_STEPS = Object.freeze(['agent', 'printer', 'role', 'settings', 'test', 'done']);
export const SUPPORTED_AGENT_PORTS = Object.freeze([9100, 9101, 9102]);

export const PRINTER_ROLES = Object.freeze([
  {
    id: 'receipt',
    label: 'Receipt printer',
    description: 'Prints guest receipts and final bills at the till.',
    assignmentTypes: ['final_receipts'],
    printerType: 'receipt_80mm',
  },
  {
    id: 'kitchen',
    label: 'Kitchen printer',
    description: 'Prints food tickets and food cancellation slips.',
    assignmentTypes: ['food_orders', 'void_food_orders'],
    printerType: 'kitchen',
  },
  {
    id: 'bar',
    label: 'Bar printer',
    description: 'Prints drink tickets and drink cancellation slips.',
    assignmentTypes: ['drinks_orders', 'void_drinks_orders'],
    printerType: 'bar',
  },
  {
    id: 'front_desk',
    label: 'Front desk bills',
    description: 'Prints unsettled bills for reception and the floor.',
    assignmentTypes: ['unsettled_bills'],
    printerType: 'receipt_80mm',
  },
  {
    id: 'shift_reports',
    label: 'Shift reports',
    description: 'Prints shift closing reports for the cashier and manager.',
    assignmentTypes: ['shift_reports'],
    printerType: 'receipt_80mm',
  },
]);

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const clean = (value) => String(value ?? '').trim();

export function normalizeAgentBaseUrl(value = DEFAULT_AGENT_URL) {
  let base = clean(value) || DEFAULT_AGENT_URL;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/(?:api|print-agent)$/i, '');
  return base.replace(/\/+$/, '') || DEFAULT_AGENT_URL;
}

export function isSupportedIpv4(value) {
  return IPV4_RE.test(clean(value));
}

export function isSupportedAgentPort(value) {
  return SUPPORTED_AGENT_PORTS.includes(Number(value));
}

export function roleById(roleId) {
  return PRINTER_ROLES.find((role) => role.id === roleId) || null;
}

export function assignmentTypesForRole(roleId) {
  return roleById(roleId)?.assignmentTypes || [];
}

export function printerTypeForRole(roleId) {
  return roleById(roleId)?.printerType || 'receipt_80mm';
}

/**
 * Automatic agent detection. Never throws: a missing agent is an expected
 * state that the wizard explains rather than a crash.
 */
export async function detectAgent(agentUrl = DEFAULT_AGENT_URL, { fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = normalizeAgentBaseUrl(agentUrl);
  if (typeof fetchImpl !== 'function') {
    return { ok: false, baseUrl, code: 'FETCH_UNAVAILABLE', message: 'This browser cannot contact the local print agent.' };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { cache: 'no-store', signal: controller?.signal });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.ok) {
      return {
        ok: true,
        baseUrl,
        version: data.version || null,
        mode: data.mode || 'unknown',
        message: 'OliTechs Print Agent is running on this computer.',
      };
    }
    return {
      ok: false,
      baseUrl,
      code: data?.code || `HTTP_${response.status}`,
      message: 'The print agent answered but did not report a healthy state.',
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl,
      code: error?.name === 'AbortError' ? 'LOCAL_AGENT_TIMEOUT' : 'LOCAL_AGENT_UNAVAILABLE',
      message: error?.name === 'AbortError'
        ? 'The print agent did not answer in time.'
        : 'The print agent is not running on this computer.',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function windowsPrinterOption(printer = {}) {
  const name = clean(printer.Name || printer.name);
  return {
    id: `windows:${name}`,
    source: 'windows',
    name,
    detail: clean(printer.DriverName) || 'Installed in Windows',
    connection_type: 'windows_printer',
    windows_printer_name: name,
    port: 9100,
  };
}

function networkPrinterOption(printer = {}) {
  const host = clean(printer.host);
  const port = Number(printer.port || 9100);
  return {
    id: `lan:${host}:${port}`,
    source: 'lan',
    name: `Network printer ${host}`,
    detail: `${host}:${port}`,
    connection_type: 'network_ip',
    ip_address: host,
    port,
  };
}

async function getJson(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      return { ok: false, message: data?.message || `Request failed (${response.status}).` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error?.message || 'The print agent could not be reached.' };
  }
}

/**
 * Asks the agent for the printers it can actually drive. Windows-installed
 * printers come first because they need no network address from the user.
 */
export async function listAvailablePrinters(agentUrl = DEFAULT_AGENT_URL, { fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = normalizeAgentBaseUrl(agentUrl);
  const [windows, network] = await Promise.all([
    getJson(fetchImpl, `${baseUrl}/windows-printers`),
    getJson(fetchImpl, `${baseUrl}/discover`),
  ]);

  const printers = [];
  const warnings = [];

  if (windows.ok) {
    const rows = Array.isArray(windows.data.printers) ? windows.data.printers : [];
    for (const row of rows) {
      const option = windowsPrinterOption(row);
      if (option.name) printers.push(option);
    }
  } else {
    warnings.push('Windows-installed printers could not be listed.');
  }

  if (network.ok) {
    const rows = Array.isArray(network.data.printers) ? network.data.printers : [];
    for (const row of rows) {
      if (!isSupportedIpv4(row?.host)) continue;
      const option = networkPrinterOption(row);
      if (!printers.some((existing) => existing.id === option.id)) printers.push(option);
    }
  } else {
    warnings.push('The local network scan could not be completed.');
  }

  return { ok: windows.ok || network.ok, baseUrl, printers, warnings };
}

/** Manual entry for a printer the scan cannot see (static IP, different subnet). */
export function manualNetworkPrinter({ host, port = 9100 } = {}) {
  const address = clean(host);
  const tcpPort = Number(port || 9100);
  if (!isSupportedIpv4(address)) {
    return { ok: false, message: 'Enter the printer address as four numbers, for example 192.168.1.50.' };
  }
  if (!isSupportedAgentPort(tcpPort)) {
    return { ok: false, message: 'Use TCP port 9100, 9101 or 9102.' };
  }
  return { ok: true, printer: networkPrinterOption({ host: address, port: tcpPort }) };
}

/**
 * Builds the exact row saved to `property_printers`, so the wizard and the
 * advanced editor cannot drift apart.
 */
export function buildPrinterSetup({ printer, roleId, name, paperWidth = '80mm', agentUrl = DEFAULT_AGENT_URL } = {}) {
  if (!printer) return { ok: false, message: 'Choose a printer first.' };
  const displayName = clean(name) || printer.name;
  if (!displayName) return { ok: false, message: 'Give this printer a name, for example "Reception receipt".' };
  const connectionType = printer.connection_type;
  if (connectionType === 'network_ip' && !isSupportedIpv4(printer.ip_address)) {
    return { ok: false, message: 'The network printer address is not valid.' };
  }
  if (connectionType === 'windows_printer' && !clean(printer.windows_printer_name)) {
    return { ok: false, message: 'Choose a Windows-installed printer.' };
  }
  const role = roleById(roleId);
  if (!role) return { ok: false, message: 'Choose what this printer is used for.' };

  return {
    ok: true,
    assignmentTypes: [...role.assignmentTypes],
    payload: {
      name: displayName,
      type: printerTypeForRole(roleId),
      connection_type: connectionType,
      ip_address: connectionType === 'network_ip' ? clean(printer.ip_address) : null,
      port: connectionType === 'network_ip' ? Number(printer.port || 9100) : 9100,
      windows_printer_name: connectionType === 'windows_printer' ? clean(printer.windows_printer_name) : null,
      paper_width: paperWidth === '58mm' ? '58mm' : '80mm',
      agent_url: normalizeAgentBaseUrl(agentUrl),
      is_online: false,
      is_default: false,
      last_status: 'testing',
      last_error: null,
    },
  };
}

/**
 * Navigation rules. "Test" requires that a test was actually attempted, so a
 * printer is never confirmed without trying it once.
 */
export function canContinue(step, state = {}) {
  switch (step) {
    case 'agent':
      return Boolean(state.agent?.ok);
    case 'printer':
      return Boolean(state.selection);
    case 'role':
      return Boolean(state.roleId);
    case 'settings':
      return clean(state.name).length > 0;
    case 'test':
      return Boolean(state.testAttempted);
    default:
      return true;
  }
}

export function nextStep(step) {
  const index = WIZARD_STEPS.indexOf(step);
  return index < 0 || index >= WIZARD_STEPS.length - 1 ? step : WIZARD_STEPS[index + 1];
}

export function previousStep(step) {
  const index = WIZARD_STEPS.indexOf(step);
  return index <= 0 ? WIZARD_STEPS[0] : WIZARD_STEPS[index - 1];
}

export function describeAgentFailure(result = {}) {
  switch (result.code) {
    case 'LOCAL_AGENT_TIMEOUT':
      return 'The print agent is running but did not answer in time. Wait a few seconds and try again.';
    case 'LOCAL_AGENT_UNAVAILABLE':
      return 'The OliTechs Print Agent is not running on this computer. Ask your installer to run the OliTechs Print Agent installer, then press Try again.';
    case 'FETCH_UNAVAILABLE':
      return 'This browser cannot contact the local print agent. Open OliTech online (not as a downloaded file) and try again.';
    default:
      return result.message || 'The print agent did not report that it is ready.';
  }
}

/** Turns a raw print result into something a receptionist can act on. */
export function describeTestOutcome(result = {}) {
  if (result?.ok) {
    return {
      ok: true,
      title: 'Test page sent',
      detail: 'Check the printer: the test slip should come out now. Paper out, a closed lid or a loose cable can still stop it.',
    };
  }
  const code = result?.code || '';
  const message = result?.friendlyError || result?.message || '';
  if (code === 'LOCAL_AGENT_UNAVAILABLE') {
    return { ok: false, title: 'Print agent not running', detail: 'Start the OliTechs Print Agent and press Test again.' };
  }
  if (code === 'TIMEOUT' || /timed out/i.test(message)) {
    return { ok: false, title: 'Printer did not answer', detail: 'Check that the printer is switched on, has paper, and is on the same network. Then press Test again.' };
  }
  if (/not installed|unavailable|not found/i.test(message)) {
    return { ok: false, title: 'Printer is not available', detail: 'Make sure the printer is installed in Windows Printers & scanners and is switched on, then test again.' };
  }
  return {
    ok: false,
    title: 'Test page did not print',
    detail: message || 'Check the printer power, cable or network connection, then press Test again.',
  };
}

/**
 * Persists a wizard result through an injected Supabase-shaped client so the
 * flow is testable without a database, and so both guarantees below are real:
 *
 *  - a retry updates the row the wizard already created instead of inserting a
 *    second printer;
 *  - if routing fails, a newly created printer is removed again, because a
 *    printer that is listed but routes nothing looks configured and silently
 *    prints nothing.
 */
export async function savePrinterSetup({
  client,
  propertyId,
  setup,
  existingPrinterId = null,
  agentUrl = DEFAULT_AGENT_URL,
} = {}) {
  if (!client || typeof client.from !== 'function') {
    return { ok: false, message: 'Printing is not connected to the database in this session.' };
  }
  if (!propertyId) {
    return { ok: false, message: 'This login is not linked to a property, so the printer cannot be saved.' };
  }
  if (!setup?.ok) {
    return { ok: false, message: setup?.message || 'The printer details need attention before saving.' };
  }

  const row = {
    ...setup.payload,
    property_id: propertyId,
    agent_url: normalizeAgentBaseUrl(agentUrl),
  };

  let printer = null;
  if (existingPrinterId) {
    const updated = await client
      .from('property_printers')
      .update(row)
      .eq('id', existingPrinterId)
      .eq('property_id', propertyId)
      .select()
      .single();
    if (updated.error) return { ok: false, message: updated.error.message || 'The printer could not be saved.' };
    printer = updated.data;
  } else {
    const inserted = await client.from('property_printers').insert(row).select().single();
    if (inserted.error) return { ok: false, message: inserted.error.message || 'The printer could not be saved.' };
    printer = inserted.data;
  }
  if (!printer?.id) {
    return { ok: false, message: 'The printer was saved but the database did not return it. Reload this page.' };
  }

  const rollBack = async () => {
    if (existingPrinterId) return;
    try {
      await client.from('property_printers').delete().eq('id', printer.id).eq('property_id', propertyId);
    } catch (_) {
      // The routing error is the one the user needs to see.
    }
  };

  const cleared = await client
    .from('printer_assignments')
    .delete()
    .eq('printer_id', printer.id)
    .eq('property_id', propertyId);
  if (cleared?.error) {
    await rollBack();
    return { ok: false, message: cleared.error.message || 'The printer routing could not be updated.' };
  }

  if (setup.assignmentTypes.length) {
    const assigned = await client.from('printer_assignments').insert(
      setup.assignmentTypes.map((type) => ({ property_id: propertyId, printer_id: printer.id, assignment_type: type })),
    );
    if (assigned?.error) {
      await rollBack();
      return { ok: false, message: assigned.error.message || 'The printer was saved but its routing failed.' };
    }
  }

  return { ok: true, printer, assignmentTypes: [...setup.assignmentTypes] };
}
