import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || '';
const APP_URL = (Deno.env.get('INVITE_APP_URL') || 'https://app.olitechs.co.ke').replace(/\/+$/, '');
const RECIPIENTS = ['info@olitechs.co.ke', 'olitechs2025@gmail.com'];
const REQUEST_KINDS = ['subscribe', 'upgrade', 'renewal'];
const BILLING_CYCLES = ['monthly', 'annual'];

type SubscriptionRequestRow = {
  id: string;
  notification_status?: string | null;
  notification_attempts?: number | null;
};

function cors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = new Set(['https://olitechs.co.ke','https://www.olitechs.co.ke','https://app.olitechs.co.ke']);
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
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
}
function textField(body: Record<string, unknown>, key: string, maxLength: number, fallback = '') {
  const value = body[key];
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, maxLength);
}
function requestLabel(kind: string) {
  if (kind === 'upgrade') return 'upgrade';
  if (kind === 'subscribe') return 'subscription';
  return 'renewal';
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed.' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) return reply(req, { error: 'Subscription request service is not configured.' }, 503);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return reply(req, { error: 'Sign in to send a subscription request.' }, 401);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return reply(req, { error: 'Your session is invalid. Please sign in again.' }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return reply(req, { error: 'Invalid request body.' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch { return reply(req, { error: 'Invalid request body.' }, 400); }

  const propertyId = textField(body, 'property_id', 60);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(propertyId)) {
    return reply(req, { error: 'A valid property is required.' }, 400);
  }

  const rawKind = textField(body, 'request_kind', 30, 'renewal');
  const requestKind = REQUEST_KINDS.includes(rawKind) ? rawKind : 'renewal';
  const rawCycle = textField(body, 'billing_cycle', 30).toLowerCase();
  const billingCycle = BILLING_CYCLES.includes(rawCycle) ? rawCycle : 'monthly';
  const requestedPackage = textField(body, 'package_name', 120) || null;
  const contactPhone = textField(body, 'phone', 60) || null;
  const requestNotes = textField(body, 'notes', 2000) || null;

  const { data: membership, error: membershipError } = await admin.from('property_users')
    .select('role').eq('property_id', propertyId).eq('user_id', user.id).maybeSingle();
  const membershipRole = String((membership as { role?: unknown } | null)?.role || '').toLowerCase();
  if (membershipError || !membership || !['owner','admin'].includes(membershipRole)) {
    return reply(req, { error: 'Only the property owner or administrator can send a subscription request.' }, 403);
  }

  const [{ data: property, error: propertyError }, { data: subscription, error: subscriptionError }, { data: profile }] = await Promise.all([
    admin.from('properties').select('id,name,business_name,package,status').eq('id', propertyId).maybeSingle(),
    admin.from('property_subscriptions').select('plan_code,status,trial_ends_at,current_period_ends_at,grace_ends_at,manual_extension_until,enabled_modules').eq('property_id', propertyId).maybeSingle(),
    admin.from('profiles').select('full_name,email').eq('id', user.id).maybeSingle(),
  ]);
  if (propertyError || subscriptionError) return reply(req, { error: 'Could not verify the property subscription.' }, 500);
  if (!property) return reply(req, { error: 'Property not found.' }, 404);
  if (property.status !== 'active') return reply(req, { error: 'This property is not active. Please contact OliTechs support.' }, 409);

  const requesterName = (profile as { full_name?: string | null } | null)?.full_name
    || String(user.user_metadata?.full_name || '') || user.email || 'Property administrator';
  const requesterEmail = user.email || (profile as { email?: string | null } | null)?.email || '';
  const propertyName = property.business_name || property.name;
  const currentPackage = subscription?.plan_code || property.package || null;
  const requestFields = {
    request_kind: requestKind,
    requested_package: requestedPackage || currentPackage,
    billing_cycle: billingCycle,
    contact_phone: contactPhone,
    request_notes: requestNotes,
    requester_email: requesterEmail,
    requester_name: requesterName,
    property_name: propertyName,
  };

  let { data: request, error: requestError } = await admin.from('subscription_renewal_requests')
    .select('*').eq('property_id', propertyId).eq('status', 'pending').maybeSingle();
  if (requestError) return reply(req, { error: 'Could not check existing subscription requests.' }, 500);

  if (!request) {
    const insert = await admin.from('subscription_renewal_requests').insert({
      property_id: propertyId,
      requested_by: user.id,
      requester_email: requesterEmail,
      requester_name: requesterName,
      property_name: propertyName,
      package_code: currentPackage,
      subscription_status: subscription?.status || 'not_configured',
      period_ends_at: subscription?.current_period_ends_at || subscription?.trial_ends_at || null,
      grace_ends_at: subscription?.grace_ends_at || null,
      status: 'pending',
      notification_status: 'pending',
      ...requestFields,
    }).select('*').single();
    request = insert.data as SubscriptionRequestRow | null;
    requestError = insert.error;
    if (requestError?.code === '23505') {
      const existing = await admin.from('subscription_renewal_requests').select('*')
        .eq('property_id', propertyId).eq('status', 'pending').maybeSingle();
      request = existing.data as SubscriptionRequestRow | null;
      requestError = existing.error;
    }
  } else if ((request as SubscriptionRequestRow).notification_status !== 'sent') {
    const update = await admin.from('subscription_renewal_requests').update(requestFields)
      .eq('id', (request as SubscriptionRequestRow).id).select('*').single();
    request = update.data as SubscriptionRequestRow | null;
    requestError = update.error;
  }
  if (requestError || !request) return reply(req, { error: 'Could not save the subscription request.' }, 500);

  const saved = request as SubscriptionRequestRow;
  if (saved.notification_status === 'sent') {
    return reply(req, { ok: true, already_requested: true, notification_status: 'sent', request_id: saved.id,
      message: 'A subscription request is already with the OliTechs team.' });
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'failed', notification_error: 'Resend is not configured (RESEND_API_KEY / EMAIL_FROM).',
      notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, { error: 'Your request was saved, but email delivery is not configured. Please contact OliTechs support.', request_id: saved.id, notification_status: 'failed' }, 503);
  }

  const label = requestLabel(requestKind);
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f4f6fa;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px">
      <h2 style="margin-top:0">Subscription ${escapeHtml(label)} requested</h2>
      <p>A property administrator has sent a ${escapeHtml(label)} request for <strong>${escapeHtml(propertyName)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Property</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(propertyName)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Requested package</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requestedPackage || currentPackage || 'Not assigned')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Current package</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(currentPackage || 'Not assigned')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Billing cycle</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(billingCycle)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Phone</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(contactPhone || 'Not provided')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Message</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requestNotes || '—')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Subscription status</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.status || 'Not configured')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Period ended</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.current_period_ends_at || subscription?.trial_ends_at || 'Not recorded')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Requested by</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(requesterName)} (${escapeHtml(requesterEmail)})</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Request ID</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(saved.id)}</td></tr>
      </table>
      <p style="margin-bottom:0;color:#64748b;font-size:12px">The request is also in the OliTechs platform admin inbox. Review it before restoring or changing access.</p>
      <p><a href="${APP_URL}/admin/subscription-requests">Open subscription request inbox</a></p>
      <p><a href="${APP_URL}/admin/properties/${encodeURIComponent(propertyId)}">Open property in Platform Admin</a></p>
    </div></body></html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `subscription-request:${saved.id}` },
      body: JSON.stringify({ from: EMAIL_FROM, to: RECIPIENTS, subject: `Subscription ${label} · ${propertyName}`, html }),
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = result as { message?: string; error?: string };
      throw new Error(String(details?.message || details?.error || `Resend HTTP ${response.status}`));
    }
    const provider = result as { id?: string };
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'sent', notification_error: null,
      provider_message_id: String(provider?.id || ''), notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, { ok: true, already_requested: false, notification_status: 'sent', request_id: saved.id,
      message: `Your ${label} request has been sent to the OliTechs platform inbox and info@olitechs.co.ke.` });
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 500);
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'failed', notification_error: message,
      notification_attempts: Number(saved.notification_attempts || 0) + 1,
    }).eq('id', saved.id);
    return reply(req, { error: 'Your request was saved, but the notification email could not be delivered. Please contact OliTechs support.', request_id: saved.id, notification_status: 'failed' }, 502);
  }
});
