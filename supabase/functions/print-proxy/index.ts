import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ALLOWED_PORTS = new Set([9100, 9101, 9102]);

const escPos = {
  init: new Uint8Array([0x1b, 0x40]),
  boldOn: new Uint8Array([0x1b, 0x45, 0x01]),
  boldOff: new Uint8Array([0x1b, 0x45, 0x00]),
  alignCenter: new Uint8Array([0x1b, 0x61, 0x01]),
  alignLeft: new Uint8Array([0x1b, 0x61, 0x00]),
  cut: new Uint8Array([0x1d, 0x56, 0x00]),
  lf: new Uint8Array([0x0a]),
};

const encoder = new TextEncoder();

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function validEndpoint(host: unknown, port: unknown) {
  return typeof host === 'string'
    && IPV4.test(host.trim())
    && Number.isInteger(Number(port))
    && ALLOWED_PORTS.has(Number(port));
}

function concat(...parts: Uint8Array[]) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function normaliseText(value: unknown) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, all) => line || all[i - 1])
    .join('\n')
    .trim();
}

function buildPayload({ text, test = false }: { text?: unknown; test?: boolean }) {
  const body = normaliseText(text);
  const stamp = new Date().toLocaleString('en-KE');
  const header = test
    ? concat(
        escPos.init,
        escPos.alignCenter,
        escPos.boldOn,
        encoder.encode('OLITECHS PMS + POS\n'),
        escPos.boldOff,
        encoder.encode('PRINTER TEST\n\n'),
        escPos.alignLeft,
        encoder.encode('Connection: DIRECT TCP\n'),
        encoder.encode(`Date: ${stamp}\n\n`),
        encoder.encode('Printer test successful.\n'),
        escPos.lf,
        escPos.lf,
        escPos.cut,
      )
    : concat(
        escPos.init,
        escPos.alignLeft,
        encoder.encode(body + '\n'),
        escPos.lf,
        escPos.lf,
        escPos.cut,
      );
  return header;
}

async function writeTcp(host: string, port: number, payload: Uint8Array, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let conn: Deno.Conn | null = null;
  try {
    conn = await Deno.connect({ hostname: host, port, transport: 'tcp', signal: controller.signal });
    let offset = 0;
    while (offset < payload.length) {
      offset += await conn.write(payload.subarray(offset));
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch {}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return corsJson({ ok:false, code:'METHOD_NOT_ALLOWED', message:'POST required.' }, 405);

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return corsJson({ ok:false, code:'FUNCTION_CONFIG_ERROR', message:'Print service is not configured on the platform.' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return corsJson({ ok:false, code:'UNAUTHORIZED', message:'Authentication is required for printer operations.' }, 401);

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user) {
      return corsJson({ ok:false, code:'UNAUTHORIZED', message:'Your session is not authorized for printer operations.' }, 401);
    }

    const body = await req.json();
    const host = String(body?.host || '').trim();
    const port = Number(body?.port || 9100);
    const action = body?.action === 'test' ? 'test' : 'print';
    const printerId = String(body?.printerId || '');
    const propertyId = body?.propertyId ? String(body.propertyId) : '';

    if (!propertyId || !printerId) {
      return corsJson({ ok:false, code:'MISSING_PRINTER_REFERENCE', message:'A saved property printer is required.' }, 400);
    }
    const { data: printer, error: lookupError } = await client
      .from('property_printers')
      .select('id,property_id,connection_type,ip_address,port')
      .eq('id', printerId)
      .eq('property_id', propertyId)
      .maybeSingle();

    if (lookupError) {
      return corsJson({ ok:false, code:'PRINTER_LOOKUP_FAILED', message: lookupError.message || 'The printer configuration could not be verified.' }, 500);
    }
    if (!printer || printer.connection_type !== 'network_ip') {
      return corsJson({ ok:false, code:'PRINTER_NOT_CONFIGURED', message:'This printer is not configured for direct network printing.' }, 400);
    }

    // The saved printer configuration is authoritative. The caller cannot
    // redirect a printer ID to another LAN endpoint, and stale client
    // host/port formatting cannot cause a false endpoint-mismatch failure.
    const savedHost = String(printer.ip_address || '').trim();
    const savedPort = Number(printer.port || 9100);

    if (!validEndpoint(savedHost, savedPort)) {
      return corsJson({
        ok:false,
        code:'INVALID_SAVED_ENDPOINT',
        message:'The saved printer IP or TCP port is invalid. Reconfigure the printer before printing.',
      }, 400);
    }

    const payload = buildPayload({ text: body?.text, test: action === 'test' });
    await writeTcp(savedHost, savedPort, payload);

    return corsJson({
      ok: true,
      status: 'connected',
      printed: action === 'print',
      tested: action === 'test',
      endpoint: `${savedHost}:${savedPort}`,
    });
  } catch (error) {
    const message = String(error?.message || error || '');
    const code = /timed out|abort/i.test(message) ? 'TIMEOUT' : 'PRINTER_UNREACHABLE';
    return corsJson({
      ok: false,
      code,
      message: code === 'TIMEOUT'
        ? 'Printer connection timed out. The printer is offline or the network route is unavailable.'
        : 'The platform could not connect to the printer. Check power, IP address, TCP port and network routing.',
    }, 502);
  }
});
