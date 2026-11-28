import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || '';
const APP_URL = (Deno.env.get('INVITE_APP_URL') || 'https://app.olitechs.co.ke').replace(/\/+$/, '');
const RECIPIENTS = ['info@olitechs.co.ke', 'olitechs2025@gmail.com'];

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
function expired(subscription: any) {
  if (!subscription) return true;
  const status = String(subscription.status || '').toLowerCase();
  if (['suspended','cancelled'].includes(status)) return true;
  const now = Date.now();
  const manualEnd = subscription.manual_extension_until ? Date.parse(subscription.manual_extension_until) : NaN;
  if (Number.isFinite(manualEnd) && manualEnd >= now) return false;
  if (status === 'trial') {
    const trialEnd = subscription.trial_ends_at ? Date.parse(subscription.trial_ends_at) : NaN;
    return Number.isFinite(trialEnd) && trialEnd < now;
  }
  if (!['active','past_due'].includes(status)) return false;
  const periodEnd = subscription.current_period_ends_at ? Date.parse(subscription.current_period_ends_at) : NaN;
  if (!Number.isFinite(periodEnd) || periodEnd >= now) return false;
  const graceEnd = subscription.grace_ends_at ? Date.parse(subscription.grace_ends_at) : NaN;
  return !Number.isFinite(graceEnd) || graceEnd < now;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed.' }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) return reply(req, { error: 'Renewal service is not configured.' }, 503);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return reply(req, { error: 'Sign in to request renewal.' }, 401);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return reply(req, { error: 'Your session is invalid. Please sign in again.' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return reply(req, { error: 'Invalid request body.' }, 400); }
  const propertyId = String(body?.property_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(propertyId)) {
    return reply(req, { error: 'A valid property is required.' }, 400);
  }

  const { data: membership, error: membershipError } = await admin.from('property_users')
    .select('role').eq('property_id', propertyId).eq('user_id', user.id).maybeSingle();
  if (membershipError || !membership || !['owner','admin'].includes(String(membership.role).toLowerCase())) {
    return reply(req, { error: 'Only the property owner or administrator can request renewal.' }, 403);
  }

  const [{ data: property, error: propertyError }, { data: subscription, error: subscriptionError }, { data: profile }] = await Promise.all([
    admin.from('properties').select('id,name,business_name,package,status').eq('id', propertyId).maybeSingle(),
    admin.from('property_subscriptions').select('plan_code,status,trial_ends_at,current_period_ends_at,grace_ends_at,manual_extension_until,enabled_modules').eq('property_id', propertyId).maybeSingle(),
    admin.from('profiles').select('full_name,email').eq('id', user.id).maybeSingle(),
  ]);
  if (propertyError || subscriptionError) return reply(req, { error: 'Could not verify the property subscription.' }, 500);
  if (!property) return reply(req, { error: 'Property not found.' }, 404);
  if (property.status !== 'active') return reply(req, { error: 'This property is not active. Please contact OliTechs support.' }, 409);
  if (!expired(subscription)) return reply(req, { error: 'This subscription has not expired. Refresh your subscription details.' }, 409);

  let { data: request, error: requestError } = await admin.from('subscription_renewal_requests')
    .select('*').eq('property_id', propertyId).eq('status', 'pending').maybeSingle();
  if (requestError) return reply(req, { error: 'Could not check existing renewal requests.' }, 500);

  if (!request) {
    const insert = await admin.from('subscription_renewal_requests').insert({
      property_id: propertyId,
      requested_by: user.id,
      requester_email: user.email || profile?.email || '',
      requester_name: profile?.full_name || user.user_metadata?.full_name || user.email || 'Property administrator',
      property_name: property.business_name || property.name,
      package_code: subscription?.plan_code || property.package || null,
      subscription_status: subscription?.status || 'not_configured',
      period_ends_at: subscription?.current_period_ends_at || subscription?.trial_ends_at || null,
      grace_ends_at: subscription?.grace_ends_at || null,
      status: 'pending',
      notification_status: 'pending',
    }).select('*').single();
    request = insert.data;
    requestError = insert.error;
    if (requestError?.code === '23505') {
      const existing = await admin.from('subscription_renewal_requests').select('*')
        .eq('property_id', propertyId).eq('status', 'pending').maybeSingle();
      request = existing.data;
      requestError = existing.error;
    }
  }
  if (requestError || !request) return reply(req, { error: 'Could not save the renewal request.' }, 500);
  if (request.notification_status === 'sent') {
    return reply(req, { ok: true, already_requested: true, notification_status: 'sent', request_id: request.id,
      message: 'A renewal request is already with the OliTechs team.' });
  }
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'failed', notification_error: 'Resend is not configured (RESEND_API_KEY / EMAIL_FROM).',
      notification_attempts: Number(request.notification_attempts || 0) + 1,
    }).eq('id', request.id);
    return reply(req, { error: 'Your request was saved, but email delivery is not configured. Please contact OliTechs support.', request_id: request.id, notification_status: 'failed' }, 503);
  }

  const propertyName = escapeHtml(property.business_name || property.name);
  const requester = escapeHtml(profile?.full_name || user.user_metadata?.full_name || user.email);
  const requesterEmail = escapeHtml(user.email || profile?.email || '');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;background:#f4f6fa;padding:24px">
    <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px">
      <h2 style="margin-top:0">Subscription renewal requested</h2>
      <p>A property administrator has requested subscription renewal for <strong>${propertyName}</strong>.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Property</td><td style="padding:8px;border-bottom:1px solid #eee">${propertyName}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Package</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.plan_code || property.package || 'Not assigned')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Subscription status</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.status || 'Not configured')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Period ended</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.current_period_ends_at || subscription?.trial_ends_at || 'Not recorded')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Grace ended</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(subscription?.grace_ends_at || 'Not configured')}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Requested by</td><td style="padding:8px;border-bottom:1px solid #eee">${requester} (${requesterEmail})</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Request ID</td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(request.id)}</td></tr>
      </table>
      <p style="margin-bottom:0;color:#64748b;font-size:12px">Review the property in the OliTechs Platform Admin before restoring access.</p>
      <p><a href="${APP_URL}/admin/properties/${encodeURIComponent(propertyId)}">Open property in Platform Admin</a></p>
    </div></body></html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `subscription-renewal:${request.id}` },
      body: JSON.stringify({ from: EMAIL_FROM, to: RECIPIENTS, subject: `Subscription renewal · ${property.business_name || property.name}`, html }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result?.message || result?.error || `Resend HTTP ${response.status}`));
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'sent', notification_error: null,
      provider_message_id: String(result?.id || ''), notification_attempts: Number(request.notification_attempts || 0) + 1,
    }).eq('id', request.id);
    return reply(req, { ok: true, already_requested: false, notification_status: 'sent', request_id: request.id,
      message: 'Your renewal request has been sent to the OliTechs team.' });
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 500);
    await admin.from('subscription_renewal_requests').update({
      notification_status: 'failed', notification_error: message,
      notification_attempts: Number(request.notification_attempts || 0) + 1,
    }).eq('id', request.id);
    return reply(req, { error: 'Your request was saved, but the notification email could not be delivered. Please contact OliTechs support.', request_id: request.id, notification_status: 'failed' }, 502);
  }
});
