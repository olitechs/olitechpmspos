import http from 'node:http';
import net from 'node:net';
import { URL } from 'node:url';

const HOST = process.env.PRINT_AGENT_HOST || '127.0.0.1';
const PORT = Number(process.env.PRINT_AGENT_PORT || 8631);
const CONNECT_TIMEOUT_MS = Number(process.env.PRINT_AGENT_TIMEOUT_MS || 6000);
const ALLOWED_PORTS = new Set([9100, 9101, 9102]);
const IPV4 = /^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$/;

const enc = new TextEncoder();

function validEndpoint(host, port) {
  return typeof host === 'string' && IPV4.test(host.trim()) &&
    Number.isInteger(port) && ALLOWED_PORTS.has(port);
}

function escPosPayload(text, test = false) {
  const clean = String(text ?? '')
    .replace(/\\r/g, '')
    .replace(/\\n{3,}/g, '\\n\\n')
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
      ].join('\\n')
    : clean;

  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x00]),
    enc.encode(body + '\\n\\n\\n'),
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

  if (req.method !== 'POST' || !['/print', '/test'].includes(url.pathname)) {
    return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'OliTechs print agent endpoint not found.' });
  }

  try {
    const body = await readBody(req);
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
