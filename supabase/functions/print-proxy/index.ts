import { withSupabase } from 'npm:@supabase/server@^1';

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

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    try {
      const body = await req.json();
      const host = String(body?.host || '').trim();
      const port = Number(body?.port || 9100);
      const action = body?.action === 'test' ? 'test' : 'print';
      const printerId = String(body?.printerId || '');
      const propertyId = body?.propertyId ? String(body.propertyId) : '';

      const query = ctx.supabase
        .from('property_printers')
        .select('id,property_id,connection_type,ip_address,port');
      const lookup = printerId
        ? await query.eq('id', printerId).maybeSingle()
        : propertyId
          ? await query.eq('property_id', propertyId).eq('ip_address', host).eq('port', port).maybeSingle()
          : { data: null, error: null };
      if (lookup.error) return json({ ok:false, code:'PRINTER_LOOKUP_FAILED', message:'The printer configuration could not be verified.' }, 500);
      if (!lookup.data || lookup.data.connection_type !== 'network_ip') return json({ ok:false, code:'PRINTER_NOT_CONFIGURED', message:'This printer is not configured for direct network printing.' }, 400);
      if (lookup.data.ip_address !== host || Number(lookup.data.port || 9100) !== port) return json({ ok:false, code:'PRINTER_ENDPOINT_MISMATCH', message:'The requested endpoint does not match the saved printer configuration.' }, 409);

      if (!validEndpoint(host, port)) {
        return json({
          ok: false,
          code: 'INVALID_ENDPOINT',
          message: 'Printer IP or port is invalid. Use an IPv4 address and TCP port 9100, 9101 or 9102.',
        }, 400);
      }

      const payload = buildPayload({ text: body?.text, test: action === 'test' });
      await writeTcp(host, port, payload);

      return json({
        ok: true,
        status: 'connected',
        printed: action === 'print',
        tested: action === 'test',
        endpoint: `${host}:${port}`,
      });
    } catch (error) {
      const message = String(error?.message || error || '');
      const code = /timed out|abort/i.test(message) ? 'TIMEOUT' : 'PRINTER_UNREACHABLE';
      return json({
        ok: false,
        code,
        message: code === 'TIMEOUT'
          ? 'Printer connection timed out. The printer is offline or the network route is unavailable.'
          : 'The platform could not connect to the printer. Check power, IP address, TCP port and network routing.',
      }, 502);
    }
  }),
};
