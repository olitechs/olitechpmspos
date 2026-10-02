// OliTechs network-printing Edge Function stub.
// Browser clients should never open raw TCP sockets to a LAN printer.
// This function is intentionally a transport placeholder for a future
// ESC/POS proxy. Deploy with Supabase CLI when the network-printing backend
// is enabled. Do not expose printer credentials in the browser.
//
// Expected POST body:
// { host: "192.168.1.50", port: 9100, escpos: "base64..." }
//
// The MVP currently uses the browser/system print dialog for every printer.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try {
    const body = await req.json();
    if (!body?.host || !body?.escpos) return new Response(JSON.stringify({ error: 'host and escpos are required' }), { status: 400, headers: {'content-type':'application/json'} });
    return new Response(JSON.stringify({ ok: false, mode: 'stub', message: 'Network ESC/POS proxy is not enabled in MVP. Use system_dialog printing.' }), { status: 501, headers: {'content-type':'application/json'} });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: {'content-type':'application/json'} });
  }
});
