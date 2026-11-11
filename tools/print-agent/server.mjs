import { buildEscPosPayload } from '../../src/services/escposJob.js';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig, AGENT_VERSION } from './config.mjs';
import { createLogger, createConsoleLogger } from './logger.mjs';
import { createDurableQueue, classifyPrintError } from './queue.mjs';

// Loopback by default. startPrintAgent() applies the resolved configuration so a
// Windows service and a console run agree on host, port, origins and data paths.
let HOST = '127.0.0.1';
let PORT = 8631;
let runtimeMode = 'console';
let startedAtIso = new Date().toISOString();
let log = createConsoleLogger();
let cloudChannel = null;
let heartbeatTimer = null;
let printQueue = null;
let queueTimer = null;
let drainingQueue = false;
let maxQueueAttempts = 3;
let queueDrainIntervalMs = 1500;
const CONNECT_TIMEOUT_MS = Number(process.env.PRINT_AGENT_TIMEOUT_MS || 6000);
const ALLOWED_PORTS = new Set([9100, 9101, 9102]);
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function normalizeEndpoint(host, port) {
  let rawHost = String(host || '').trim();
  let rawPort = Number(port || 9100);

  // Accept common operator input such as 192.168.2.117:9100 or http://192.168.2.117:9100.
  // The wire transport remains strict IPv4 + raw ESC/POS TCP port.
  try {
    if (/^https?:\/\//i.test(rawHost)) {
      const parsed = new URL(rawHost);
      rawHost = parsed.hostname;
      if (parsed.port) rawPort = Number(parsed.port);
    } else if (/^[0-9.]+:\d+$/.test(rawHost)) {
      const parts = rawHost.split(':');
      rawHost = parts[0];
      rawPort = Number(parts[1]);
    }
  } catch (_) {}

  return { host: rawHost, port: rawPort };
}

function validEndpoint(host, port) {
  return typeof host === 'string' && IPV4.test(host.trim()) &&
    Number.isInteger(port) && ALLOWED_PORTS.has(port);
}

function escPosPayload(text, test = false, settings = {}) {
  const clean = String(text ?? '').replace(/\\r/g, '').replace(/\\n{3,}/g, '\\n\\n').replace(/^\\n+|\\n+$/g, '');
  const body = test
    ? [
        'OliTechs PMS TEST PRINT OK',
        '',
        'OliTechs PMS + POS',
        'Connection: LOCAL PRINT AGENT',
        'Date: ' + new Date().toLocaleString('en-KE'),
        '',
        'If this receipt printed, the network connection is working.',
      ].join('\\n')
    : clean;
  return Buffer.from(buildEscPosPayload(body, settings), 'latin1');
}

function writeTcpNow(host, port, payload) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let writeCallbackDone = false;
    let drainDone = true;
    let endCalled = false;
    let writeFinished = false;
    let connected = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      // Record whether bytes could have reached the printer. The queue uses this
      // to tell a safe retry (connection refused) from a possible duplicate.
      if (error) error.delivered = connected;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    const endWhenDrained = () => {
      if (endCalled || !writeCallbackDone || !drainDone) return;
      endCalled = true;
      socket.end();
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      connected = true;
      const accepted = socket.write(payload, (error) => {
        if (error) return finish(error);
        writeCallbackDone = true;
        endWhenDrained();
      });
      if (!accepted) {
        drainDone = false;
        socket.once('drain', () => {
          drainDone = true;
          endWhenDrained();
        });
      }
    });
    socket.once('finish', () => {
      // Writable finish confirms the complete payload has drained before close.
      writeFinished = true;
      finish(null);
    });
    socket.once('close', () => {
      if (!settled && !writeFinished) {
        const error = new Error('Printer socket closed before the complete job drained.');
        error.code = 'ECONNRESET';
        finish(error);
      } else {
        finish(null);
      }
    });
    socket.once('timeout', () => {
      const error = new Error('Printer connection timed out');
      error.code = 'ETIMEDOUT';
      finish(error);
    });
    socket.once('error', finish);
    socket.connect(port, host);
  });
}


// Serialize all jobs per physical printer. Separate HTTP requests can otherwise
// reach the same thermal printer concurrently and interleave receipt/ticket data.
const printerWriteQueues = new Map();
function writeTcp(host, port, payload) {
  const key = host + ':' + port;
  const previous = printerWriteQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => writeTcpNow(host, port, payload));
  printerWriteQueues.set(key, current);
  current.then(
    () => { if (printerWriteQueues.get(key) === current) printerWriteQueues.delete(key); },
    () => { if (printerWriteQueues.get(key) === current) printerWriteQueues.delete(key); },
  );
  return current;
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
    'Add-Type @\"\nusing System;\nusing System.Runtime.InteropServices;\npublic static class RawPrinter {\n  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]\n  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }\n  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string pPrinterName, out IntPtr hPrinter, IntPtr pDefault);\n  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);\n  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);\n  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);\n  [DllImport("winspool.drv", SetLastError=true)] public static extern int StartPagePrinter(IntPtr hPrinter);\n  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);\n  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);\n}\n\"@',
    '$printer=$args[0]; $data=[Convert]::FromBase64String($args[1]); $h=[IntPtr]::Zero',
    'if(-not [RawPrinter]::OpenPrinter($printer,[ref]$h,[IntPtr]::Zero)){throw "OpenPrinter failed"}',
    '$doc=New-Object RawPrinter+DOCINFO; $doc.pDocName="OliTechs PMS + POS"; $doc.pDataType="RAW"',
    'try { if([RawPrinter]::StartDocPrinter($h,1,$doc)-eq 0){throw "StartDocPrinter failed"}; try { if([RawPrinter]::StartPagePrinter($h)-eq 0){throw "StartPagePrinter failed"}; try { $ptr=[Runtime.InteropServices.Marshal]::AllocHGlobal($data.Length); try { [Runtime.InteropServices.Marshal]::Copy($data,0,$ptr,$data.Length); $written=0; if(-not [RawPrinter]::WritePrinter($h,$ptr,$data.Length,[ref]$written)){throw "WritePrinter failed"}; if($written-ne $data.Length){throw "Spooler wrote $written of $($data.Length) bytes"} } finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)} } finally {[RawPrinter]::EndPagePrinter($h)|Out-Null} } finally {[RawPrinter]::EndDocPrinter($h)|Out-Null} } finally {[RawPrinter]::ClosePrinter($h)|Out-Null}',
    'Write-Output "OK"'
  ].join('\n');
  try {
    return await runPowerShell(script, [name, base64]);
  } catch (error) {
    // A partial spooler write means some bytes may already be on paper, which
    // makes a retry a possible duplicate rather than a safe resend.
    if (/spooler wrote|WritePrinter failed/i.test(String(error?.message || ''))) error.delivered = true;
    throw error;
  }
}

// Cloud printing is optional. The client is created at startup so a workstation
// without Supabase configuration (or without the dependency installed) can still
// start and print over LAN and the Windows spooler.
let AGENT_ID = process.env.PRINT_AGENT_ID || '';
let WORKSPACE_ID = process.env.WORKSPACE_ID || '';
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
let supabaseV2 = null;

async function initCloudClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseV2 = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return supabaseV2;
  } catch (error) {
    log.warn('cloud printing disabled: Supabase client is unavailable', { error: error?.message });
    supabaseV2 = null;
    return null;
  }
}

async function discoverBonjourPrinters() {
  try {
    const mod=await import('bonjour-service');
    const bonjour=new mod.Bonjour();
    return await new Promise(resolve=>{ const found=[]; const browser=bonjour.find({type:'printer'},service=>{const host=service.addresses?.find(a=>IPV4.test(a));if(host)found.push({host,port:Number(service.port||9100),transport:'mdns',label:service.name||host});}); setTimeout(()=>{browser.stop?.();bonjour.destroy?.();resolve(found);},2500); });
  } catch (_) { return []; }
}
async function registerAgent(printers=[]) {
  if (!supabaseV2 || !WORKSPACE_ID || !AGENT_ID) return;
  await supabaseV2.from('print_agents').upsert({id:AGENT_ID,workspace_id:WORKSPACE_ID,status:'online',last_seen:new Date().toISOString(),discovered_printers:printers.length},{onConflict:'id'});
  const {data:defaultStore}=await supabaseV2.from('stores').select('id').eq('workspace_id',WORKSPACE_ID).order('is_default',{ascending:false}).limit(1).maybeSingle();
  for (const p of printers) {
    const {data:existing}=await supabaseV2.from('printers').select('id').eq('workspace_id',WORKSPACE_ID).eq('ip_address',p.host).eq('port',p.port).maybeSingle();
    if(existing) await supabaseV2.from('printers').update({agent_id:AGENT_ID,status:'online',last_seen:new Date().toISOString()}).eq('id',existing.id);
    else if(defaultStore?.id) await supabaseV2.from('printers').insert({workspace_id:WORKSPACE_ID,store_id:defaultStore.id,name:p.label||`Network Printer ${p.host}`,connection_type:'print_agent',ip_address:p.host,port:p.port,agent_id:AGENT_ID,is_kitchen:true,status:'online',last_seen:new Date().toISOString()});
  }
}
async function discoverAndRegister() { try { const network=await discoverNetworkPrinters(); const mdns=await discoverBonjourPrinters(); const found=[...new Map([...network,...mdns].map(p=>[p.host+':'+p.port,p])).values()]; await registerAgent(found); return found; } catch(e){ log.error('printer discovery failed',{error:e.message}); return []; } }
async function processCloudJob(job) {
  if(!supabaseV2) throw new Error('Supabase is not configured for cloud print jobs.');
  const {data:printer,error}=await supabaseV2.from('printers').select('*').eq('id',job.printer_id).single();
  if(error) throw error;
  const raw=Buffer.from(job.content_escpos_base64||'','base64');
  const endpoint=normalizeEndpoint(printer.ip_address,printer.port);
  if(printer.connection_type==='network'||printer.connection_type==='print_agent') {
    if(!validEndpoint(endpoint.host,endpoint.port)) throw new Error('Invalid printer network endpoint.');
    await writeTcp(endpoint.host,endpoint.port,raw);
  } else throw new Error('This agent currently supports network ESC/POS printers.');
  await supabaseV2.from('print_jobs').update({status:'printed',printed_at:new Date().toISOString(),error_message:null}).eq('id',job.id);
  await supabaseV2.from('printers').update({status:'online',last_seen:new Date().toISOString()}).eq('id',printer.id);
}
function startCloudSubscription() {
  if(!supabaseV2 || !WORKSPACE_ID) return;
  const channel=supabaseV2.channel('print_jobs:'+WORKSPACE_ID)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'print_jobs',filter:'workspace_id=eq.'+WORKSPACE_ID},payload=>{
      processCloudJob(payload.new).catch(async e=>{
        log.error('cloud print job failed',{error:e.message});
        await supabaseV2.from('print_jobs').update({status:'failed',error_message:e.message}).eq('id',payload.new.id);
        if(payload.new.printer_id) await supabaseV2.from('printers').update({status:'error',last_seen:new Date().toISOString()}).eq('id',payload.new.printer_id);
      });
    }).subscribe(status=>log.info('cloud realtime status',{status}));
  return channel;
}
function startHeartbeat() {
  if(!supabaseV2 || !WORKSPACE_ID || !AGENT_ID) return null;
  const timer = setInterval(()=>supabaseV2.from('print_agents').update({status:'online',last_seen:new Date().toISOString()}).eq('id',AGENT_ID).then(({error})=>error&&log.error('heartbeat failed',{error:error.message})),30000);
  timer.unref?.();
  return timer;
}

function readIdempotencyKey(req, body) {
  const headerKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : '';
  return String(headerKey || body?.idempotencyKey || body?.idempotency_key || body?.jobId || '').trim() || null;
}

function jobTargetLabel(job) {
  if (!job) return '';
  if (job.transport === 'windows_spooler') return String(job.target?.printerName || '');
  return [job.target?.host, job.target?.port].filter(Boolean).join(':');
}

/**
 * Journals a job (or explains why it will not be sent) before any printing
 * happens. Returns either `{ job }` to print now or `{ response }` when the
 * request is a duplicate or asked to be deferred to the worker.
 */
function admitPrintJob({ req, body, transport, target, payloadBase64, title }) {
  if (!printQueue) {
    // No writable queue: keep printing without crash recovery rather than
    // refusing to print a guest's bill.
    return { job: { id: null, transport, target, payloadBase64, title: title || null } };
  }

  let admission;
  try {
    admission = printQueue.enqueue({
      idempotencyKey: readIdempotencyKey(req, body),
      transport,
      target,
      payloadBase64,
      title: title || null,
      meta: { jobId: body?.jobId || null, propertyId: body?.propertyId || null, printerId: body?.printerId || null },
      attemptLimit: maxQueueAttempts,
    });
  } catch (error) {
    log.error('print queue write failed; printing without recovery', { error: error?.message });
    return { job: { id: null, transport, target, payloadBase64, title: title || null } };
  }

  const job = admission.job;
  if (admission.duplicate) {
    if (job.status === 'printed') {
      return { response: { status: 200, body: {
        ok: true, printed: true, deduplicated: true, status: 'printed', jobId: job.id,
        message: 'This print job has already printed. It was not sent to the printer again.',
      } } };
    }
    if (job.status === 'uncertain') {
      return { response: { status: 409, body: {
        ok: false, code: 'PRINT_OUTCOME_UNCERTAIN', status: 'uncertain', jobId: job.id,
        message: 'A previous attempt for this job may already have printed. Check the paper, then reprint from the printer queue if it is missing.',
      } } };
    }
    return { response: { status: 409, body: {
      ok: false, code: 'PRINT_JOB_IN_PROGRESS', status: job.status, jobId: job.id,
      message: 'This print job is already queued or printing.',
    } } };
  }

  if (body?.defer === true) {
    return { response: { status: 202, body: {
      ok: true, queued: true, status: 'queued', jobId: job.id,
      message: 'The print job is queued and will be sent to the printer by the agent.',
    } } };
  }

  return { job };
}

async function deliverQueuedJob(job) {
  const payload = Buffer.from(String(job.payloadBase64 || ''), 'base64');
  if (!payload.length) {
    const error = new Error('This print job no longer has its print data. Print a new copy from the app instead.');
    error.code = 'PRINT_JOB_PAYLOAD_MISSING';
    throw error;
  }
  if (job.transport === 'windows_spooler') return printWindowsRaw(job.target?.printerName, payload);
  return writeTcp(job.target?.host, job.target?.port, payload);
}

function friendlyPrintFailure(code, message) {
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT') {
    return 'Printer connection timed out. Check power, IP address, port and LAN connection.';
  }
  if (String(code).startsWith('WINDOWS_') || String(code).startsWith('PRINT_')) return message;
  return 'The local print agent could not connect to the printer. Check power, IP address, port and LAN connection.';
}

async function runQueuedJob(job) {
  const journaled = Boolean(printQueue && job?.id);
  // The attempt is written before bytes leave the machine. A crash after this
  // line is reported as `uncertain` on restart instead of being resent blindly.
  if (journaled) printQueue.markAttempt(job.id);

  try {
    await deliverQueuedJob(job);
    if (journaled) printQueue.markPrinted(job.id);
    return { ok: true, jobId: job?.id || null };
  } catch (error) {
    const code = error?.code || 'PRINT_FAILED';
    const message = error?.message || 'The printer did not accept the job.';
    const outcome = classifyPrintError(error);
    if (journaled) {
      if (outcome === 'uncertain') printQueue.markUncertain(job.id, { code, message });
      else printQueue.markFailed(job.id, { code, message });
    }
    log.warn('print job failed', { jobId: job?.id || null, outcome, code, target: jobTargetLabel(job), error: message });
    if (outcome === 'uncertain') {
      return { ok: false, status: 502, body: {
        ok: false, code: 'PRINT_OUTCOME_UNCERTAIN', status: 'uncertain', jobId: job?.id || null,
        message: 'The printer accepted part of this job but never confirmed it. Check whether paper came out, then reprint from the printer queue if it is missing. The agent will not send it again on its own.',
      } };
    }
    return { ok: false, status: 502, body: {
      ok: false, code: code === 'ETIMEDOUT' ? 'TIMEOUT' : 'PRINTER_UNREACHABLE', status: 'failed', jobId: job?.id || null,
      message: friendlyPrintFailure(code, message),
    } };
  }
}

async function drainPrintQueue() {
  if (!printQueue || drainingQueue) return;
  drainingQueue = true;
  try {
    printQueue.failExhausted({ attemptLimit: maxQueueAttempts });
    for (;;) {
      const job = printQueue.nextQueued({ attemptLimit: maxQueueAttempts });
      if (!job) break;
      const outcome = await runQueuedJob(job);
      if (outcome.ok) continue;
      // Never resend a job that may already be on paper, and do not hammer a
      // printer that is switched off.
      if (outcome.body?.code === 'PRINT_OUTCOME_UNCERTAIN') break;
      const attempts = printQueue.get(job.id)?.attempts || 1;
      if (attempts < maxQueueAttempts) {
        printQueue.scheduleRetry(job.id, Math.min(60000, 5000 * 2 ** (attempts - 1)));
      }
      break;
    }
  } catch (error) {
    log.error('print queue drain failed', { error: error?.message });
  } finally {
    drainingQueue = false;
  }
}

function startQueueWorker() {
  if (!printQueue || queueTimer) return null;
  queueTimer = setInterval(() => { void drainPrintQueue(); }, queueDrainIntervalMs);
  queueTimer.unref?.();
  // A job accepted just before the last stop is printed as soon as the service
  // is back up, without waiting for a browser to be open.
  void drainPrintQueue();
  return queueTimer;
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

// Replaced from configuration at startup. Kept as a module-level set so the
// request handler stays a plain function that is easy to exercise in tests.
let TRUSTED_ORIGINS = new Set(['https://olitechpmspos.vercel.app']);

function isAllowedOrigin(origin) {
  if (!origin) return true; // CLI / native local clients do not use browser CORS.
  if (TRUSTED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
      ['http:', 'https:'].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
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
  const origin = String(req.headers.origin || '');
  if (!isAllowedOrigin(origin)) {
    return json(res, 403, {
      ok: false,
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'This local Print Agent only accepts browser requests from the OliTechs app or localhost.',
    });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    // Chromium sends a Private Network Access preflight when a public HTTPS
    // app contacts this loopback service. Only approved origins reach here.
    const privateNetworkRequested =
      String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true';
    return json(res, 204, { ok: true }, privateNetworkRequested
      ? { 'Access-Control-Allow-Private-Network': 'true' }
      : {});
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  // Backward-compatible aliases allow older desktop configurations that stored
  // /api or /print-agent as the agent base URL to keep working during upgrades.
  const routeAliases = {
    '/api/health': '/health',
    '/print-agent/health': '/health',
    '/status': '/health',
    '/api/status': '/health',
    '/print-agent/status': '/health',
    '/api/discover': '/discover',
    '/print-agent/discover': '/discover',
    '/scan-network': '/discover',
    '/api/scan-network': '/discover',
    '/print-agent/scan-network': '/discover',
    '/api/windows-printers': '/windows-printers',
    '/print-agent/windows-printers': '/windows-printers',
    '/api/print': '/print',
    '/print-agent/print': '/print',
    '/api/test': '/test',
    '/print-agent/test': '/test',
    '/api/windows-print': '/windows-print',
    '/print-agent/windows-print': '/windows-print',
    '/api/windows-test': '/windows-test',
    '/print-agent/windows-test': '/windows-test',
    '/api/open-drawer': '/open-drawer',
    '/print-agent/open-drawer': '/open-drawer',
    '/api/queue': '/queue',
    '/print-agent/queue': '/queue',
    '/api/queue/retry': '/queue/retry',
    '/print-agent/queue/retry': '/queue/retry',
  };
  const route = routeAliases[url.pathname] || url.pathname;

  if (req.method === 'GET' && route === '/health') {
    // Deliberately reports only facts a dashboard or support engineer needs.
    // No printer addresses, credentials or configuration values are exposed.
    return json(res, 200, {
      ok: true,
      service: 'OliTechs Local Print Agent',
      version: AGENT_VERSION,
      mode: runtimeMode,
      host: HOST,
      port: PORT,
      pid: process.pid,
      startedAt: startedAtIso,
      uptimeSeconds: Math.round(process.uptime()),
      platform: process.platform,
      queue: printQueue ? printQueue.counts() : null,
    });
  }

  if (req.method === 'GET' && route === '/discover') {
    try {
      return json(res, 200, { ok:true, printers:await discoverNetworkPrinters(), transport:'network_ip' });
    } catch(error) {
      return json(res, 500, { ok:false, code:error?.code||'NETWORK_DISCOVERY_FAILED', message:error?.message||'Unable to scan the local network.' });
    }
  }

  if (req.method === 'GET' && route === '/windows-printers') {
    try { return json(res, 200, { ok:true, printers:await listWindowsPrinters(), transport:'windows_spooler' }); }
    catch(error) { return json(res, 500, { ok:false, code:error?.code||'WINDOWS_PRINTERS_UNAVAILABLE', message:error?.message||'Unable to enumerate Windows printers.' }); }
  }

  if (req.method === 'GET' && route === '/printers/list') {
    try { return json(res, 200, { ok:true, printers:await discoverNetworkPrinters(), transport:'network_ip' }); }
    catch(error) { return json(res, 500, { ok:false, code:error?.code||'NETWORK_DISCOVERY_FAILED', message:error?.message||'Unable to list network printers.' }); }
  }

  if (req.method === 'GET' && route === '/queue') {
    if (!printQueue) return json(res, 200, { ok: true, enabled: false, counts: null, items: [] });
    return json(res, 200, { ok: true, enabled: true, counts: printQueue.counts(), items: printQueue.list({ limit: 100 }) });
  }

  if (req.method === 'POST' && route === '/queue/retry') {
    if (!printQueue) {
      return json(res, 503, { ok: false, code: 'PRINT_QUEUE_DISABLED', message: 'The print queue is not available on this workstation.' });
    }
    try {
      const body = await readBody(req);
      const id = String(body.id || body.jobId || '').trim();
      if (!id) {
        return json(res, 400, { ok: false, code: 'PRINT_JOB_ID_REQUIRED', message: 'Provide the id of the queued print job to reprint.' });
      }
      let job;
      try {
        job = printQueue.requeue(id);
      } catch (error) {
        return json(res, 409, { ok: false, code: error?.code || 'PRINT_JOB_NOT_RETRYABLE', message: error?.message || 'This print job cannot be reprinted.' });
      }
      const outcome = await runQueuedJob(job);
      if (outcome.ok) return json(res, 200, { ok: true, printed: true, jobId: id, job: printQueue.get(id) });
      return json(res, outcome.status, { ...outcome.body, job: printQueue.get(id) });
    } catch (error) {
      return json(res, 500, { ok: false, code: 'PRINT_QUEUE_ERROR', message: error?.message || 'The print queue could not reprint this job.' });
    }
  }

  if (req.method !== 'POST' || !['/print','/test','/windows-print','/windows-test','/open-drawer'].includes(route)) {
    return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'OliTechs print agent endpoint not found.' });
  }

  try {
    const body = await readBody(req);
    if (['/windows-print','/windows-test'].includes(route)) {
      const printerName = String(body.windowsPrinterName || '').trim();
      const raw = body.escposBase64 || body.content_escpos_base64;
      const payload = raw ? Buffer.from(raw, 'base64') : escPosPayload(body.text, route === '/windows-test', body.printSettings || {});
      if (route === '/windows-test') {
        await printWindowsRaw(printerName, payload);
        return json(res, 200, { ok:true, status:'connected', printed:true, transport:'windows_spooler', printerName });
      }
      const admission = admitPrintJob({
        req, body, transport: 'windows_spooler', target: { printerName },
        payloadBase64: payload.toString('base64'), title: body.title,
      });
      if (admission.response) return json(res, admission.response.status, admission.response.body);
      const outcome = await runQueuedJob(admission.job);
      if (!outcome.ok) return json(res, outcome.status, outcome.body);
      return json(res, 200, { ok:true, status:'connected', printed:true, transport:'windows_spooler', printerName, jobId: admission.job.id });
    }

    const endpoint = normalizeEndpoint(body.host || body.ip_address, body.port);
    const host = endpoint.host;
    const port = endpoint.port;

    if (!validEndpoint(host, port)) {
      return json(res, 400, {
        ok: false,
        code: 'INVALID_ENDPOINT',
        message: 'Printer IP or port is invalid. Use an IPv4 address and TCP port 9100, 9101 or 9102.',
      });
    }

    if (route === '/open-drawer') {
      await writeTcp(host, port, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xff]));
      return json(res, 200, {
        ok: true,
        status: 'connected',
        drawerCommandSent: true,
        transport: 'local_agent',
        endpoint: `${host}:${port}`,
      });
    }

    let payload;
    const rawBase64 = body.escposBase64 || body.content_escpos_base64;
    if (rawBase64 && ['/print','/test'].includes(route)) {
      if (typeof rawBase64 !== 'string' || rawBase64.length > 700000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64)) {
        return json(res, 400, { ok:false, code:'INVALID_ESCPOS_PAYLOAD', message:'ESC/POS payload must be valid base64 under 512 KB.' });
      }
      payload = Buffer.from(rawBase64, 'base64');
      if (!payload.length) return json(res, 400, { ok:false, code:'EMPTY_ESCPOS_PAYLOAD', message:'ESC/POS payload is empty.' });
    } else {
      payload = escPosPayload(body.text, route === '/test', body.printSettings || {});
    }

    if (route === '/test') {
      // A test page is a deliberate repeatable action, so it is never deduplicated.
      await writeTcp(host, port, payload);
      return json(res, 200, { ok:true, status:'connected', printed:true, transport:'local_agent', endpoint:`${host}:${port}` });
    }

    const admission = admitPrintJob({
      req, body, transport: 'network_ip', target: { host, port },
      payloadBase64: payload.toString('base64'), title: body.title,
    });
    if (admission.response) return json(res, admission.response.status, admission.response.body);
    const outcome = await runQueuedJob(admission.job);
    if (!outcome.ok) return json(res, outcome.status, outcome.body);

    return json(res, 200, {
      ok: true,
      status: 'connected',
      printed: true,
      transport: 'local_agent',
      endpoint: `${host}:${port}`,
      jobId: admission.job.id,
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

function readInstanceLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (_) {
    return null;
  }
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another account.
    return error?.code === 'EPERM';
  }
}

/**
 * Starts the local API and everything that must outlive a browser session.
 * Throws with a stable `code` rather than starting a half-configured agent.
 */
export async function startPrintAgent({ config = loadConfig(), logger = null } = {}) {
  runtimeMode = config.mode;
  startedAtIso = new Date().toISOString();
  HOST = config.host;
  PORT = config.port;
  TRUSTED_ORIGINS = new Set(config.allowedOrigins);
  if (config.agentId) AGENT_ID = config.agentId;
  if (config.workspaceId) WORKSPACE_ID = config.workspaceId;
  if (config.supabase) {
    SUPABASE_URL = config.supabase.url;
    SUPABASE_KEY = config.supabase.key;
  }

  if (logger) {
    log = logger;
  } else {
    fs.mkdirSync(config.logDir, { recursive: true });
    log = createLogger({
      dir: config.logDir,
      maxBytes: config.logMaxBytes,
      maxFiles: config.logMaxFiles,
      level: config.logLevel,
      mirror: config.mode !== 'service',
    });
  }

  log.info('print agent starting', {
    version: AGENT_VERSION,
    mode: runtimeMode,
    host: HOST,
    port: PORT,
    dataDir: config.dataDir,
    allowedOrigins: config.allowedOrigins,
  });
  if (config.hostWarning) log.warn(config.hostWarning, { requestedHost: config.requestedHost, host: HOST });
  if (config.ignoredOrigins?.length) log.warn('ignored invalid allowed-origin entries', { origins: config.ignoredOrigins });

  fs.mkdirSync(config.dataDir, { recursive: true });

  // The durable queue is created before the port is opened, so every job the
  // agent accepts from this moment on is already on disk.
  try {
    printQueue = createDurableQueue({
      dir: config.queueDir,
      logger: log,
      retentionMs: config.queueRetentionMs,
      maxRecords: config.queueMaxRecords,
      maxAttempts: config.queueMaxAttempts,
    });
    maxQueueAttempts = config.queueMaxAttempts;
    queueDrainIntervalMs = config.queueDrainMs;
    log.info('print queue ready', {
      dir: config.queueDir,
      recovered: printQueue.recoveredCount,
      counts: printQueue.counts(),
    });
  } catch (error) {
    printQueue = null;
    log.error('print queue unavailable; printing continues without crash recovery', { error: error?.message });
  }

  // Single instance: two agents on one workstation would claim the same print
  // jobs and drive the same printers, which is how duplicate tickets happen.
  const running = readInstanceLock(config.lockFile);
  if (running?.pid && running.pid !== process.pid && pidIsAlive(running.pid)) {
    const error = new Error(`Another OliTechs Print Agent is already running on this computer (process ${running.pid}). Stop it before starting a second one.`);
    error.code = 'AGENT_ALREADY_RUNNING';
    log.error('refusing to start a second print agent', { pid: running.pid, lockFile: config.lockFile });
    throw error;
  }

  await new Promise((resolve, reject) => {
    const onListenError = (error) => {
      if (error?.code === 'EADDRINUSE') {
        const friendly = new Error(`Port ${config.port} is already in use. Another print agent or program is using it on this computer.`);
        friendly.code = 'AGENT_PORT_IN_USE';
        return reject(friendly);
      }
      reject(error);
    };
    server.once('error', onListenError);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', onListenError);
      const address = server.address();
      if (address && typeof address === 'object') PORT = address.port;
      resolve();
    });
  });

  // The lock records the real port, which is what makes an ephemeral test port
  // discoverable and what a support engineer can read from disk.
  fs.writeFileSync(config.lockFile, JSON.stringify({
    pid: process.pid,
    host: HOST,
    port: PORT,
    mode: runtimeMode,
    version: AGENT_VERSION,
    startedAt: startedAtIso,
  }, null, 2));
  log.info('print agent listening', { host: HOST, port: PORT, pid: process.pid });

  await initCloudClient();
  if (config.discoverOnStart) {
    try {
      const found = await discoverAndRegister();
      log.info('printer discovery finished', { count: found.length });
    } catch (error) {
      log.warn('printer discovery skipped', { error: error?.message });
    }
  }
  cloudChannel = startCloudSubscription();
  heartbeatTimer = startHeartbeat();
  startQueueWorker();

  let shutdownPromise = null;
  const shutdown = (reason = 'shutdown') => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = new Promise((resolve) => {
      log.info('print agent stopping', { reason });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { fs.rmSync(config.lockFile, { force: true }); } catch (_) {}
        if (queueTimer) clearInterval(queueTimer);
        queueTimer = null;
        try { printQueue?.close(); } catch (_) {}
        printQueue = null;
        log.info('print agent stopped', { reason });
        resolve();
      };
      const forceTimer = setTimeout(finish, config.shutdownTimeoutMs);
      forceTimer.unref?.();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (queueTimer) clearInterval(queueTimer);
      queueTimer = null;
      try { cloudChannel?.unsubscribe?.(); } catch (_) {}
      cloudChannel = null;
      try { server.closeIdleConnections?.(); } catch (_) {}
      server.close(() => {
        clearTimeout(forceTimer);
        finish();
      });
      // Keep-alive sockets left open by a browser must not block a service stop.
      setTimeout(() => {
        try { server.closeAllConnections?.(); } catch (_) {}
      }, 1000).unref?.();
    });
    return shutdownPromise;
  };

  const stopOnSignal = (signal) => {
    log.info('shutdown requested', { signal });
    shutdown(signal).finally(() => process.exit(0));
  };
  process.once('SIGTERM', stopOnSignal);
  process.once('SIGINT', stopOnSignal);
  // A service must crash loudly (so Windows restarts it) instead of hanging in
  // an unknown state where receipts silently stop appearing.
  process.once('uncaughtException', (error) => {
    log.error('uncaught exception', { error: error?.stack || String(error) });
    process.exit(1);
  });
  process.once('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: reason?.stack || String(reason) });
    process.exit(1);
  });

  return {
    server,
    config,
    logger: log,
    shutdown,
    get port() { return PORT; },
    get queue() { return printQueue; },
  };
}