import { supabase } from '@/lib/supabaseClient';

// Printer connectivity + printing service.
//
// This is intentionally isolated from React components (per the project's
// existing services/ convention — see authService.js) so printer logic has
// one place to live instead of being scattered across Settings, POS and
// Kitchen screens.
//
// IMPORTANT — what is genuinely supported and why:
//
// This app is a pure browser SPA with no backend/Node/Electron process (see
// AGENTS.md). Browsers cannot open raw TCP sockets to an arbitrary
// IP:port — that's a security restriction, not a bug — so a *real* network
// printer (Ethernet/Wi-Fi, ESC/POS-over-TCP on e.g. port 9100) cannot be
// reached directly from this JS. The industry-standard fix is a small local
// "print agent" (a tiny local HTTP service, e.g. on localhost, that the
// browser can reach and that itself owns the raw socket to the printer).
//
//   - Network printers: genuinely tested/printed to ONLY if the printer is
//     configured with a Print Agent URL. Without one, we report
//     `UNSUPPORTED` honestly instead of faking a socket check.
//   - USB printers: real WebUSB (`navigator.usb`) — genuine device
//     permission/open/transfer calls.
//   - Bluetooth printers: real Web Bluetooth (`navigator.bluetooth`) —
//     genuine device permission/GATT calls.
//   - System/browser printers: real `window.print()` — this hands off to
//     the OS print dialog, which is honestly reported as "handled by the
//     system dialog", not as a verified specific physical device.
//
// None of these paths ever set a printer to CONNECTED without genuine
// evidence (see rule: never fake hardware connectivity).

export const PrinterStatus = Object.freeze({
	NOT_CONFIGURED: 'not_configured',
	CONNECTING: 'connecting',
	CONNECTED: 'connected',
	DISCONNECTED: 'disconnected',
	OFFLINE: 'offline',
	FAILED: 'failed',
	ERROR: 'error',
	UNSUPPORTED: 'unsupported',
});

export const PrintJobStatus = Object.freeze({
	PENDING: 'pending',
	PRINTING: 'printing',
	PRINTED: 'printed',
	FAILED: 'failed',
	RETRYING: 'retrying',
});

const DEFAULT_TIMEOUT_MS = 6000;

// Holds live, non-serializable device handles obtained via WebUSB/Web
// Bluetooth permission grants. Keyed by printer id. Kept out of React state
// on purpose — native device objects aren't meant to be stored/cloned there.
const deviceHandles = new Map();

// --- Validation -----------------------------------------------------------

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isValidIPv4(value) {
	return typeof value === 'string' && IPV4_RE.test(value.trim());
}

export function isValidPort(value) {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function validatePrinterConfig(printer) {
	const errors = {};
	if (!printer.name || !printer.name.trim()) {
		errors.name = 'Printer name is required.';
	}
	if (printer.connectionType === 'network') {
		if (!printer.host || !printer.host.trim()) {
			errors.host = 'IP address is required for a network printer.';
		} else if (!isValidIPv4(printer.host)) {
			errors.host = `"${printer.host}" is not a valid IPv4 address (e.g. 192.168.1.50).`;
		}
		if (!printer.port) {
			errors.port = 'Port is required for a network printer.';
		} else if (!isValidPort(printer.port)) {
			errors.port = 'Port must be a number between 1 and 65535.';
		}
		if (printer.agentUrl && !/^https?:\/\/.+/i.test(printer.agentUrl.trim())) {
			errors.agentUrl = 'Print agent URL must start with http:// or https://';
		}
	}
	return { valid: Object.keys(errors).length === 0, errors };
}

// --- Friendly error mapping -------------------------------------------------

// Converts raw technical errors (fetch/DOMException/etc.) into short,
// non-technical messages safe to show to reception/restaurant staff. Raw
// errors are still returned separately (see callers) for internal logging.
function toFriendlyError(rawError, context = {}) {
	const name = rawError?.name || '';
	const message = String(rawError?.message || rawError || '');

	if (name === 'AbortError' || /timeout/i.test(message)) {
		return 'Connection timed out. The printer did not respond in time.';
	}
	if (name === 'NotFoundError') {
		return 'No printer device was selected.';
	}
	if (name === 'SecurityError' || name === 'NotAllowedError') {
		return 'Permission to access the printer was denied.';
	}
	if (name === 'NetworkError' || /failed to fetch/i.test(message)) {
		return context.agent
			? 'Could not reach the local print agent. Confirm it is running.'
			: 'Printer refused the connection. Confirm the IP address and port.';
	}
	if (/ECONNREFUSED/i.test(message)) {
		return 'Printer refused the connection. Confirm the IP address and port.';
	}
	if (/disconnected/i.test(message)) {
		return 'The printer is no longer connected.';
	}
	return 'Printer connection failed. Please check the printer and try again.';
}

function withTimeout(promise, ms, controller) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			controller?.abort();
			const err = new Error('Connection timed out');
			err.name = 'AbortError';
			reject(err);
		}, ms);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); }
		);
	});
}

// --- Connection testing -----------------------------------------------------

async function testNetwork(printer, { timeoutMs }) {
	if (!printer.agentUrl) {
		return {
			status: PrinterStatus.UNSUPPORTED,
			friendlyError: 'Direct browser-to-network-printer testing isn\'t possible (browsers cannot open raw sockets). Add a Print Agent URL, or use a USB/Bluetooth/System printer instead.',
		};
	}
	const controller = new AbortController();
	try {
		const res = await withTimeout(
			fetch(`${printer.agentUrl.replace(/\/$/, '')}/test-connection`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ host: printer.host, port: Number(printer.port) }),
				signal: controller.signal,
			}),
			timeoutMs,
			controller
		);
		if (!res.ok) {
			return { status: PrinterStatus.FAILED, friendlyError: `Print agent reported an error (HTTP ${res.status}).`, rawError: `HTTP ${res.status}` };
		}
		const data = await res.json().catch(() => ({}));
		if (data.reachable) {
			return { status: PrinterStatus.CONNECTED };
		}
		return { status: PrinterStatus.OFFLINE, friendlyError: `Unable to reach ${printer.host}:${printer.port}. Check that the printer is powered on and connected to the network.` };
	} catch (err) {
		return { status: PrinterStatus.FAILED, friendlyError: toFriendlyError(err, { agent: true }), rawError: String(err?.message || err) };
	}
}

async function testUsb(printer) {
	if (!navigator.usb) {
		return { status: PrinterStatus.UNSUPPORTED, friendlyError: 'This browser does not support USB printer access (WebUSB).' };
	}
	try {
		const handle = deviceHandles.get(printer.id);
		if (!handle) {
			return { status: PrinterStatus.DISCONNECTED, friendlyError: 'No USB device paired yet. Click "Connect" to select the printer.' };
		}
		// Re-verify the browser still considers this device authorized/present.
		const known = await navigator.usb.getDevices();
		const stillPresent = known.some((d) => d === handle || (d.vendorId === handle.vendorId && d.productId === handle.productId && d.serialNumber === handle.serialNumber));
		if (!stillPresent) {
			deviceHandles.delete(printer.id);
			return { status: PrinterStatus.DISCONNECTED, friendlyError: 'The printer is no longer connected. Reconnect the USB cable and pair again.' };
		}
		return { status: PrinterStatus.CONNECTED };
	} catch (err) {
		return { status: PrinterStatus.ERROR, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

async function testSerial(printer) {
  if (!navigator.serial) {
    return { status: PrinterStatus.UNSUPPORTED, friendlyError: 'This browser does not support serial printer access (Web Serial).' };
  }
  try {
    const handle = deviceHandles.get(printer.id);
    if (!handle) {
      return { status: PrinterStatus.DISCONNECTED, friendlyError: 'No serial device paired yet. Click "Connect" to select the printer.' };
    }
    if (!handle.readable && !handle.writable) {
      return { status: PrinterStatus.DISCONNECTED, friendlyError: 'The serial printer is not open. Reconnect the printer.' };
    }
    return { status: PrinterStatus.CONNECTED };
  } catch (err) {
    return { status: PrinterStatus.ERROR, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
  }
}

async function testBluetooth(printer) {
	if (!navigator.bluetooth) {
		return { status: PrinterStatus.UNSUPPORTED, friendlyError: 'This browser does not support Bluetooth printer access (Web Bluetooth).' };
	}
	try {
		const handle = deviceHandles.get(printer.id);
		if (!handle) {
			return { status: PrinterStatus.DISCONNECTED, friendlyError: 'No Bluetooth device paired yet. Click "Pair" to select the printer.' };
		}
		const connected = !!handle.gatt?.connected;
		if (!connected) {
			try {
				await handle.gatt.connect();
			} catch (err) {
				return { status: PrinterStatus.OFFLINE, friendlyError: 'The paired Bluetooth printer is not responding. Confirm it is powered on and in range.', rawError: String(err?.message || err) };
			}
		}
		return { status: PrinterStatus.CONNECTED };
	} catch (err) {
		return { status: PrinterStatus.ERROR, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

async function testSystem() {
	return { status: PrinterStatus.UNSUPPORTED, friendlyError: 'Windows/browser printing is disabled. Configure a real Network IP thermal printer.' };
}

// Runs a real connectivity test for the printer's configured connection
// type. Resolves to { status, friendlyError?, rawError? }. Never throws.
export async function testConnection(printer, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
	const { valid, errors } = validatePrinterConfig(printer);
	if (!valid) {
		const firstError = Object.values(errors)[0];
		return { status: PrinterStatus.ERROR, friendlyError: firstError, checkedAt: Date.now() };
	}
	let result;
	try {
		switch (printer.connectionType) {
			case 'network': result = await testNetwork(printer, { timeoutMs }); break;
			case 'usb': result = await testUsb(printer); break;
			case 'bluetooth': result = await testBluetooth(printer); break;
			case 'system': result = await testSystem(); break;
			default: result = { status: PrinterStatus.ERROR, friendlyError: 'Unknown connection type.' };
		}
	} catch (err) {
		// Defensive catch-all — a printer failure must never crash the app.
		result = { status: PrinterStatus.ERROR, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
	return { ...result, checkedAt: Date.now() };
}

// --- Pairing (USB / Bluetooth) — must be called from a user gesture -------

export async function pairUsbDevice(printer) {
	if (!navigator.usb) {
		return { ok: false, friendlyError: 'This browser does not support USB printer access (WebUSB).' };
	}
	try {
		const device = await navigator.usb.requestDevice({ filters: [] });
		await device.open();
		deviceHandles.set(printer.id, device);
		return { ok: true };
	} catch (err) {
		return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

export async function pairSerialDevice(printer) {
  if (!navigator.serial) {
    return { ok: false, friendlyError: 'This browser does not support serial printer access (Web Serial).' };
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({
      baudRate: Number(printer.baudRate) || 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });
    deviceHandles.set(printer.id, port);
    return { ok: true };
  } catch (err) {
    return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
  }
}

export async function pairBluetoothDevice(printer) {
	if (!navigator.bluetooth) {
		return { ok: false, friendlyError: 'This browser does not support Bluetooth printer access (Web Bluetooth).' };
	}
	try {
		const device = await navigator.bluetooth.requestDevice({
			acceptAllDevices: true,
			optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'], // common thermal-printer service UUID
		});
		deviceHandles.set(printer.id, device);
		return { ok: true };
	} catch (err) {
		return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

export function forgetDevice(printerId) {
	deviceHandles.delete(printerId);
}

// --- Printing ---------------------------------------------------------------

async function sendToAgent(printer, text) {
  try {
    const { data, error } = await supabase.functions.invoke('print-proxy', {
      body: {
        action: 'print',
        printerId: printer.id || null,
        propertyId: printer.propertyId || null,
        host: printer.host,
        port: Number(printer.port || 9100),
        text,
      },
    });
    if (error) return { ok:false, friendlyError:error.message || 'The platform could not reach the printer.' };
    return data?.ok ? { ok:true, direct:true } : { ok:false, friendlyError:data?.message || 'The printer is offline or unreachable.' };
  } catch (err) {
    return { ok:false, friendlyError:toFriendlyError(err), rawError:String(err?.message || err) };
  }
}

async function sendToUsb(printer, text) {
	const handle = deviceHandles.get(printer.id);
	if (!handle) return { ok: false, friendlyError: 'No USB device paired. Connect the printer first.' };
	try {
		const iface = handle.configuration?.interfaces?.[0];
		const alt = iface?.alternates?.[0];
		const outEndpoint = alt?.endpoints?.find((e) => e.direction === 'out');
		if (!iface || !outEndpoint) {
			return { ok: false, friendlyError: 'This USB device does not expose a printable interface.' };
		}
		await handle.claimInterface(iface.interfaceNumber).catch(() => {});
		const data = new TextEncoder().encode(text);
		await handle.transferOut(outEndpoint.endpointNumber, data);
		return { ok: true };
	} catch (err) {
		return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

async function sendToSerial(printer, text) {
  const handle = deviceHandles.get(printer.id);
  if (!handle) return { ok: false, friendlyError: 'No serial device paired. Connect the printer first.' };
  try {
    if (!handle.writable) {
      await handle.open({
        baudRate: Number(printer.baudRate) || 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
    }
    const writer = handle.writable.getWriter();
    try {
      const data = new TextEncoder().encode(text);
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
  }
}

async function sendToBluetooth(printer, text) {
	const handle = deviceHandles.get(printer.id);
	if (!handle) return { ok: false, friendlyError: 'No Bluetooth device paired. Pair the printer first.' };
	try {
		if (!handle.gatt.connected) await handle.gatt.connect();
		const service = await handle.gatt.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
		const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
		const data = new TextEncoder().encode(text);
		// Thermal printers over BLE typically need chunked writes.
		const CHUNK = 180;
		for (let i = 0; i < data.length; i += CHUNK) {
			await characteristic.writeValueWithoutResponse(data.slice(i, i + CHUNK));
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

function sendToSystem() {
	return { ok: false, friendlyError: 'Windows/browser printing is disabled. Configure a real Network IP thermal printer.' };
}

function escapeHtml(str) {
	return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Sends `text` to `printer`. Requires the printer to already be CONNECTED
// (except `system`, which always opens the OS dialog). Never throws.
export async function sendPrintJob(printer, text, { title, thermal = false } = {}) {
	if (!printer) return { ok: false, friendlyError: 'No printer is configured for this purpose.' };
	try {
		if (printer.connectionType === 'system') return sendToSystem(text, title, { thermal });
		if (printer.status !== PrinterStatus.CONNECTED) {
			return { ok: false, friendlyError: `${printer.name} is not connected. Test the connection and try again.` };
		}
		switch (printer.connectionType) {
			case 'network': return await sendToAgent(printer, text);
			case 'usb': return await sendToUsb(printer, text);
			case 'bluetooth': return await sendToBluetooth(printer, text);
			case 'serial': return await sendToSerial(printer, text);
			default: return { ok: false, friendlyError: 'Unknown connection type.' };
		}
	} catch (err) {
		return { ok: false, friendlyError: toFriendlyError(err), rawError: String(err?.message || err) };
	}
}

export function buildTestPageText(printer) {
	const now = new Date();
	return [
		'OLITECHS PMS + POS',
		'',
		'      PRINTER TEST',
		'',
		`Printer: ${printer.name}`,
		'Status: Connected',
		'',
		`Date: ${now.toLocaleDateString('en-KE')}`,
		`Time: ${now.toLocaleTimeString('en-KE')}`,
		'',
		'--------------------------------',
		'Printer test successful.',
		'--------------------------------',
	].join('\n');
}
