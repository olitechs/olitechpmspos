import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || '';
const APP_URL = (Deno.env.get('INVITE_APP_URL') || 'https://app.olitechs.co.ke').replace(/\/+$/, '');
const RECIPIENTS = ['info@olitechs.co.ke', 'olitechs2025@gmail.com'];
const PACKAGES = ['starter', 'standard', 'professional', 'enterprise'];
const BILLING_CYCLES = ['monthly', 'annual'];
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

type DemoRequestRow = {
  id: string;
  notification_status?: string | null;
  notification_attempts?: number | null;
};

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = new Set([
    'https://olitechs.co.ke',
    'https://www.olitechs.co.ke',
    'https://app.olitechs.co.ke',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const vercel = /^https:\/\/olitechpmspos(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
  const allowOrigin = allowed.has(origin) || vercel ? origin : APP_URL;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function reply(req: Request, payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function textField(body: Record<string, unknown>, key: string, maxLength: number, fallback = '') {
  const value = body[key];
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, maxLength);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed.' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return reply(req, { error: 'Demo request service is not configured.' }, 503);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return reply(req, { error: 'Invalid request body.' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return reply(req, { error: 'Invalid request body.' }, 400);
  }

  const fullName = textField(body, 'full_name', 120);
  const rawEmail = textField(body, 'email', 254);
  const requesterEmail = rawEmail.toLowerCase();
  const propertyName = textField(body, 'property_name', 160);
  const contactPhone = textField(body, 'phone', 60) || null;
  const rawPackage = textField(body, 'package_name', 120).toLowerCase();
  const requestedPackage = PACKAGES.includes(rawPackage) ? rawPackage : null;
  const rawCycle = textField(body, 'billing_cycle', 30).toLowerCase();
  const billingCycle = BILLING_CYCLES.includes(rawCycle) ? rawCycle : null;
  const requestNotes = textField(body, 'notes', 2000) || null;

  if (fullName.length < 2) return reply(req, { error: 'Please enter your name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) return reply(req, { error: 'Enter a valid email address.' }, 400);
  if (propertyName.length < 2) return reply(req, { error: 'Please enter your property or business name.' }, 400);

  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: existing, error: existingError } = await admin.from('demo_requests')
    .select('id,notification_status,notification_attempts')
    .eq('requester_email', requesterEmail)
    .eq('status', 'pending')
    .gte('requested_at', cutoff)
    .maybeSingle();
  if (existingError) return reply(req, { error: 'Could not check existing demo requests.' }, 500);

  const previous = existing as DemoRequestRow | null;
  if (previous?.notification_status === 'sent') {
    return reply(req, {
      ok: true,
      already_requested: true,
      notification_status: 'sent',
      request_id: previous.id,
      message: 'Your demo request is already with the OliTechs team.',
    });
  }

  const fields = {
    requester_name: fullName,
    requester_email: requesterEmail,
    property_name: propertyName,
    contact_phone: contactPhone,
    requested_package: requestedPackage,
    billing_cycle: billingCycle,
    request_notes: requestNotes,
    notification_status: 'pending',
    notification_error: null,
  };

  let request = previous as DemoRequestRow | null;
  let requestError = null as { message?: string } | null;
  if (!request) {
    const insert = await admin.from('demo_requests').insert({
      ...fields,
      source: 'homepage',
      status: 'pending',
      notification_attempts: 0,
    }).select('id,notification_status,notification_attempts').single();
    request = insert.data as DemoRequestRow | null;
    requestError = insert.error;
  } else {
    const update = await admin.from('demo_requests').update(fields)
      .eq('id', request.id).select('id,notification_status,notification_attempts').single();
    request = update.data as DemoRequestRow | null;
    requestError = update.error;
  }
  if (requestError || !request) return reply(req, { error: 'Could not save the demo request.' }, 500);

  const saved = request as DemoRequestRow;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    await admin.from('demo_requests').update({
      notification_status: 'failed',
      notification_error: 'Resend is not configured (RESEND_API_KEY / EMAIL_FROM).',
      notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, {
      error: 'Your request was saved, but email delivery is not configured. Please contact OliTechs support.',
      request_id: saved.id,
      notification_status: 'failed',
    }, 503);
  }

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f4f6fa;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px">
      <h2 style="margin-top:0">New demo request</h2>
      <p>A visitor asked to see OliTechs PMS + POS for <strong>${escapeHtml(propertyName)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Name</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requesterEmail)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Property / business</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(propertyName)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Phone</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(contactPhone || 'Not provided')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Package of interest</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requestedPackage || 'Not sure yet')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Billing cycle</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(billingCycle || 'Not sure yet')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">What they want to see</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requestNotes || '—')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Request ID</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(saved.id)}</td></tr>
      </table>
      <p style="margin-bottom:0;color:#64748b;font-size:12px">The request is also in the OliTechs platform admin inbox under Demo Requests.</p>
      <p><a href="${APP_URL}/admin/subscription-requests">Open request inbox</a></p>
    </div></body></html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `demo-request:${saved.id}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: RECIPIENTS,
        subject: `Demo request · ${propertyName}`,
        html,
      }),
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = result as { message?: string; error?: string };
      throw new Error(String(details?.message || details?.error || `Resend HTTP ${response.status}`));
    }
    const provider = result as { id?: string };
    await admin.from('demo_requests').update({
      notification_status: 'sent',
      notification_error: null,
      provider_message_id: String(provider?.id || ''),
      notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, {
      ok: true,
      already_requested: false,
      notification_status: 'sent',
      request_id: saved.id,
      message: `Your demo request has been sent to the OliTechs platform inbox and ${RECIPIENTS[0]}.`,
    });
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 500);
    await admin.from('demo_requests').update({
      notification_status: 'failed',
      notification_error: message,
      notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, {
      error: 'Your request was saved, but the notification email could not be delivered. Please contact OliTechs support.',
      request_id: saved.id,
      notification_status: 'failed',
    }, 502);
  }
});
