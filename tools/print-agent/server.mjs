import http from 'node:http';
import net from 'node:net';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';

const HOST = process.env.PRINT_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.PRINT_AGENT_PORT || 8631);
const CONNECT_TIMEOUT_MS = Number(process.env.PRINT_AGENT_TIMEOUT_MS || 6000);
const ALLOWED_PORTS = new Set([9100, 9101, 9102]);
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const enc = new TextEncoder();

function validEndpoint(host, port) {
  return typeof host === 'string' && IPV4.test(host.trim()) &&
    Number.isInteger(port) && ALLOWED_PORTS.has(port);
}

function escPosPayload(text, test = false) {
  const clean = String(text ?? '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const body = test
    ? [
        'OLITECHS PMS + POS',
        '',
        '          PRINTER TEST',
        '',
        'Connection: LOCAL PRINT AGENT',
        `Date: ${new Date().toLocaleString('en-KE')}`,
        '',
        'Printer connection verified.',
        '',
      ].join('\n')
    : clean;

  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x00]),
    enc.encode(body + '\n\n\n'),
    Buffer.from([0x1d, 0x56, 0x00]),
  ]);
}

function writeTcp(host, port, payload) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      socket.write(payload, (err) => finish(err || null));
    });
    socket.once('timeout', () => {
      const err = new Error('Printer connection timed out');
      err.code = 'ETIMEDOUT';
      finish(err);
    });
    socket.once('error', finish);
    socket.connect(port, host);
  });
}

function runPowerShell(script, args = []) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      const err = new Error('Windows printer transport is only available on Windows.');
      err.code = 'WINDOWS_ONLY'; reject(err); return;
    }
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script,...args], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else { const err = new Error(stderr.trim() || stdout.trim() || 'Windows printer command failed.'); err.code = 'WINDOWS_PRINTER_ERROR'; reject(err); }
    });
  });
}


function isPrivateIPv4(host) {
  const parts = String(host || '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}


async function discoverNetworkPrinters() {
  const os = await import('node:os');
  const interfaces = os.networkInterfaces();
  const candidates = new Set();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIPv4(entry.address)) continue;
      const octets = entry.address.split('.').map(Number);
      if (octets.length !== 4) continue;
      // Discovery intentionally stays inside the workstation's /24 private LAN.
      for (let i = 1; i <= 254; i++) candidates.add(`${octets[0]}.${octets[1]}.${octets[2]}.${i}`);
    }
  }
  const hosts = [...candidates];
  const found = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < hosts.length) {
      const host = hosts[cursor++];
      for (const port of ALLOWED_PORTS) {
        try {
          await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            let done = false;
            const finish = (err) => { if (done) return; done = true; socket.destroy(); err ? reject(err) : resolve(); };
            socket.setTimeout(350);
            socket.once('connect', () => finish());
            socket.once('timeout', () => finish(new Error('timeout')));
            socket.once('error', finish);
            socket.connect(port, host);
          });
          found.push({ host, port, transport: 'network_ip', label: `${host}:${port}` });
          break;
        } catch (_) {}
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(24, Math.max(1, hosts.length)) }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

async function listWindowsPrinters() {
  const script = '$ErrorActionPreference="Stop"; Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,WorkOffline | ConvertTo-Json -Compress';
  const raw = await runPowerShell(script);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function windowsPrinterExists(name) {
  const target = String(name || '').trim();
  if (!target) return false;
  try {
    await runPowerShell('$ErrorActionPreference="Stop"; $p=Get-Printer -Name $args[0] -ErrorAction SilentlyContinue; if($null -eq $p){exit 2}; Write-Output "OK"', [target]);
    return true;
  } catch (_) { return false; }
}

async function printWindowsRaw(printerName, payload) {
  const name = String(printerName || '').trim();
  if (!name) { const e = new Error('Select the Windows-installed printer used by this POS computer.'); e.code='WINDOWS_PRINTER_NOT_CONFIGURED'; throw e; }
  if (!(await windowsPrinterExists(name))) { const e = new Error('The selected Windows printer is not installed or is currently unavailable.'); e.code='WINDOWS_PRINTER_NOT_FOUND'; throw e; }

  const base64 = Buffer.from(payload).toString('base64');
  const script = [
    '$ErrorActionPreference="Stop"',
    'Add-Type @\"
using System;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern int StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
\"@',
    '$printer=$args[0]; $data=[Convert]::FromBase64String($args[1]); $h=[IntPtr]::Zero',
    'if(-not [RawPrinter]::OpenPrinter($printer,[ref]$h,[IntPtr]::Zero)){throw "OpenPrinter failed"}',
    '$doc=New-Object RawPrinter+DOCINFO; $doc.pDocName="OliTechs PMS POS"; $doc.pDataType="RAW"',
    'try { if([RawPrinter]::StartDocPrinter($h,1,$doc)-eq 0){throw "StartDocPrinter failed"}; try { if([RawPrinter]::StartPagePrinter($h)-eq 0){throw "StartPagePrinter failed"}; try { $ptr=[Runtime.InteropServices.Marshal]::AllocHGlobal($data.Length); try { [Runtime.InteropServices.Marshal]::Copy($data,0,$ptr,$data.Length); $written=0; if(-not [RawPrinter]::WritePrinter($h,$ptr,$data.Length,[ref]$written)){throw "WritePrinter failed"}; if($written-ne $data.Length){throw "Spooler wrote $written of $($data.Length) bytes"} } finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)} } finally {[RawPrinter]::EndPagePrinter($h)|Out-Null} } finally {[RawPrinter]::EndDocPrinter($h)|Out-Null} } finally {[RawPrinter]::ClosePrinter($h)|Out-Null}',
    'Write-Output "OK"'
  ].join('\n');
  await runPowerShell(script, [name, base64]);
}

function json(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 512 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, { ok: true });

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'OliTechs Local Print Agent',
      version: '1.0.0',
      host: HOST,
      port: PORT,
    });
  }

  if (req.method === 'GET' && url.pathname === '/discover') {\n    try { return json(res, 200, { ok:true, printers:await discoverNetworkPrinters(), transport:'network_ip' }); }\n    catch(error) { return json(res, 500, { ok:false, code:error?.code||'NETWORK_DISCOVERY_FAILED', message:error?.message||'Unable to scan the local network.' }); }\n  }\n\n  if (req.method === 'GET' && url.pathname === '/windows-printers') {
    try { return json(res, 200, { ok:true, printers:await listWindowsPrinters(), transport:'windows_spooler' }); }
    catch(error) { return json(res, 500, { ok:false, code:error?.code||'WINDOWS_PRINTERS_UNAVAILABLE', message:error?.message||'Unable to enumerate Windows printers.' }); }
  }

  if (req.method !== 'POST' || !['/print','/test','/windows-print','/windows-test'].includes(url.pathname)) {
    return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'OliTechs print agent endpoint not found.' });
  }

  try {
    const body = await readBody(req);
    if (['/windows-print','/windows-test'].includes(url.pathname)) {
      const printerName = String(body.windowsPrinterName || '').trim();
      const payload = escPosPayload(body.text, url.pathname === '/windows-test');
      await printWindowsRaw(printerName, payload);
      return json(res, 200, { ok:true, status:'connected', printed:true, transport:'windows_spooler', printerName });
    }

    const host = String(body.host || '').trim();
    const port = Number(body.port || 9100);

    if (!validEndpoint(host, port)) {
      return json(res, 400, {
        ok: false,
        code: 'INVALID_ENDPOINT',
        message: 'Printer IP or port is invalid. Use an IPv4 address and TCP port 9100, 9101 or 9102.',
      });
    }

    const payload = escPosPayload(body.text, url.pathname === '/test');
    await writeTcp(host, port, payload);

    return json(res, 200, {
      ok: true,
      status: 'connected',
      printed: true,
      transport: 'local_agent',
      endpoint: `${host}:${port}`,
    });
  } catch (error) {
    const code = error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'PRINTER_UNREACHABLE';
    return json(res, 502, {
      ok: false,
      code,
      message: code === 'TIMEOUT'
        ? 'Printer connection timed out. Check power, IP address, port and LAN connection.'
        : 'The local print agent could not connect to the printer. Check power, IP address, port and LAN connection.',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[OliTechs Print Agent] listening on http://${HOST}:${PORT}`);
});
