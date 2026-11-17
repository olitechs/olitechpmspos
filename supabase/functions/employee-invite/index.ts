// Branded employee invitation and notification delivery via Resend.
// Supabase Auth remains the identity provider; this function only generates
// Supabase Auth action links and delivers transactional email from the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const APP_URL = (Deno.env.get('INVITE_APP_URL') || 'https://app.olitechs.co.ke').replace(/\/+$/, '');
const ALLOWED_ORIGIN = (Deno.env.get('INVITE_ALLOWED_ORIGIN') || 'https://olitechpmspos.vercel.app').replace(/\/+$/, '');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || '';
const APP_ORIGIN = new URL(APP_URL).origin;
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, new URL(ALLOWED_ORIGIN).origin]);

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
function json(data: unknown, req: Request, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}
function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char);
}
function emailShell(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033;padding:32px 12px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6eaf0;border-radius:16px;overflow:hidden">
      <div style="background:#0f172a;padding:24px 30px;color:#fff"><div style="font-size:21px;font-weight:700;letter-spacing:.2px">OliTechs</div><div style="font-size:12px;color:#cbd5e1;margin-top:5px">Property Management &amp; Point of Sale</div></div>
      <div style="padding:30px"><h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">${title}</h1>${body}
      <p style="font-size:12px;color:#64748b;margin-top:28px">This is an automated message from OliTechs. If you were not expecting it, you can safely ignore it.</p></div>
      <div style="padding:16px 30px;background:#f8fafc;color:#64748b;font-size:11px">OliTechs · Secure property operations</div>
    </div></body></html>`;
}
async function sendResend(to: string, subject: string, html: string, idempotencyKey: string) {
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error('Resend is not configured. Check RESEND_API_KEY and EMAIL_FROM Edge Function secrets.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(result?.message || result?.error || `Resend returned HTTP ${response.status}`));
  return String(result?.id || '');
}

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

function outboxEmail(row: any) {
  const payload = row.payload || {};
  const property = escapeHtml(payload.property_name || 'your property');
  const name = escapeHtml(row.recipient_name || 'there');
  if (row.event_type === 'employee_welcome') {
    return {
      subject: `Welcome to ${property} on OliTechs`,
      html: emailShell('Welcome to the team', `<p>Hello ${name},</p><p>Your employee access for <strong>${property}</strong> has been activated.</p><p>Sign in using the email address this invitation was sent to. Your assigned workspaces and permissions are managed by your property administrator.</p><p><a href="${APP_URL}/signin" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:700">Sign in to OliTechs</a></p>`),
    };
  }
  if (row.event_type === 'property_admin_invited') {
    return {
      subject: `Employee invitation sent · ${property}`,
      html: emailShell('An employee has been invited', `<p>Hello ${name},</p><p>An invitation has been sent to <strong>${escapeHtml(payload.employee_email)}</strong> (${escapeHtml(payload.employee_name)}) for <strong>${property}</strong>.</p><p>Role: ${escapeHtml(payload.staff_role || 'Employee')}</p><p>You can review invitations from the Employees section in OliTechs.</p>`),
    };
  }
  return {
    subject: `Employee joined · ${property}`,
    html: emailShell('An employee accepted their invitation', `<p>Hello ${name},</p><p><strong>${escapeHtml(payload.employee_name)}</strong> (${escapeHtml(payload.employee_email)}) has accepted their invitation and joined <strong>${property}</strong>.</p><p>Assigned role: ${escapeHtml(payload.staff_role || 'Employee')}</p><p>You can manage their assigned workspaces and permissions from the Employees section.</p>`),
  };
}

async function processOutbox(propertyId: string, limit = 20) {
  const { data: rows, error } = await admin.from('employee_email_outbox')
    .select('*')
    .eq('property_id', propertyId)
    .eq('status', 'pending')
    .neq('event_type', 'employee_invitation')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const results = { sent: 0, failed: 0 };
  for (const row of rows || []) {
    const { data: claimed, error: claimError } = await admin.from('employee_email_outbox')
      .update({ status: 'processing', locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimError || !claimed) continue;
    try {
      const message = outboxEmail(row);
      const providerId = await sendResend(row.recipient_email, message.subject, message.html, row.idempotency_key);
      await admin.from('employee_email_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), provider_message_id: providerId,
        last_error: null, locked_at: null, updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      results.sent += 1;
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const permanentlyFailed = attempts >= 5;
      const delayMs = Math.min(6 * 60 * 60_000, 60_000 * (2 ** Math.min(attempts - 1, 8)));
      await admin.from('employee_email_outbox').update({
        status: permanentlyFailed ? 'failed' : 'pending',
        attempts,
        next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
        last_error: String(error?.message || error).slice(0, 500),
        locked_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      results.failed += 1;
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, req, 405);
  if (!RESEND_API_KEY || !EMAIL_FROM) return json({ error: 'Resend is not configured. Check RESEND_API_KEY and EMAIL_FROM.' }, req, 503);

  const authHeader = req.headers.get('Authorization') || '';
  if (rateLimited(authHeader.slice(0, 64) || 'anonymous')) return json({ error: 'Too many requests. Try again shortly.' }, req, 429);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  }, req);
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Sign in to continue.' }, req, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, req, 400); }
  const action = String(body.action || 'invite');

  if (action === 'invite') {
    const invitationId = typeof body.invitation_id === 'string' ? body.invitation_id : '';
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[0-9a-f-]{36}$/i.test(invitationId) || token.length < 16) {
      return json({ error: 'A valid invitation and one-time token are required.' }, req, 400);
    }
    const { data: invitation, error: invitationError } = await admin.from('employee_invitations')
      .select('id,property_id,email,full_name,staff_role,status,expires_at')
      .eq('id', invitationId).maybeSingle();
    if (invitationError || !invitation) return json({ error: 'Invitation not found.' }, req, 404);
    if (invitation.status !== 'pending' || new Date(invitation.expires_at).getTime() <= Date.now()) {
      return json({ error: 'Only valid pending invitations can be emailed.' }, req, 409);
    }
    const { data: membership } = await admin.from('property_users').select('role')
      .eq('property_id', invitation.property_id).eq('user_id', userData.user.id).maybeSingle();
    if (!membership || !['owner','admin','manager'].includes(String(membership.role))) {
      return json({ error: 'Only property administrators can send invitations.' }, req, 403);
    }

    const [{ data: property }, { data: profile }] = await Promise.all([
      admin.from('properties').select('name,business_name').eq('id', invitation.property_id).maybeSingle(),
      admin.from('profiles').select('id').ilike('email', invitation.email).maybeSingle(),
    ]);
    const propertyName = String(property?.business_name || property?.name || 'your property');
    const redirect = `${APP_URL}/accept-invite`;
    let actionLink = '';
    let isNewUser = !profile?.id;
    try {
      const generated = isNewUser
        ? await admin.auth.admin.generateLink({
            type: 'invite',
            email: invitation.email,
            options: {
              redirectTo: redirect,
              data: {
                invitation_id: invitation.id,
                invitation_token: token,
                invitation_property: invitation.property_id,
                invitation_setup_required: true,
              },
            },
          })
        : await admin.auth.admin.generateLink({
            type: 'magiclink',
            email: invitation.email,
            options: { redirectTo: `${redirect}?token=${encodeURIComponent(token)}` },
          });
      if (generated.error) throw generated.error;
      actionLink = generated.data?.properties?.action_link || '';
      if (!actionLink) throw new Error('Supabase Auth did not return a secure action link.');
    } catch (error) {
      await admin.from('audit_logs').insert({
        actor_id: userData.user.id, action: 'employee_invitation_auth_link_failed',
        property_id: invitation.property_id,
        new_value: { invitation_id: invitation.id, error: String(error?.message || error).slice(0, 200) },
      });
      return json({ error: String(error?.message || 'Could not generate the secure invitation link.') }, req, 502);
    }

    const inviteHtml = emailShell('You are invited to join OliTechs', `<p>Hello ${escapeHtml(invitation.full_name)},</p><p><strong>${escapeHtml(userData.user.user_metadata?.full_name || userData.user.email || 'Your property administrator')}</strong> has invited you to join <strong>${escapeHtml(propertyName)}</strong>.</p><p>Your assigned role is <strong>${escapeHtml(invitation.staff_role.replaceAll('_',' '))}</strong>. Your administrator controls which workspaces you can access.</p><p>Use the secure button below to ${isNewUser ? 'verify your email and set up your account' : 'sign in and accept the invitation'}.</p><p><a href="${actionLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:13px 22px;border-radius:9px;font-weight:700">Accept invitation</a></p><p style="font-size:12px;color:#64748b">This invitation expires ${new Date(invitation.expires_at).toLocaleString('en-KE',{timeZone:'Africa/Nairobi'})}. If the button does not work, ask your administrator to resend the invitation.</p>`);
    const inviteKey = `employee-invite:${invitation.id}:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then((v)=>Array.from(new Uint8Array(v)).map((b)=>b.toString(16).padStart(2,'0')).join(''))}`;
    let providerId = '';
    let deliveryStatus = 'sent';
    let deliveryError: string | null = null;
    try {
      providerId = await sendResend(invitation.email, `You're invited to join ${propertyName} on OliTechs`, inviteHtml, inviteKey);
    } catch (error) {
      deliveryStatus = 'failed';
      deliveryError = String(error?.message || error).slice(0, 500);
    }
    await admin.from('employee_email_outbox').insert({
      property_id: invitation.property_id, invitation_id: invitation.id,
      event_type: 'employee_invitation', recipient_email: invitation.email,
      recipient_name: invitation.full_name, payload: { property_name: propertyName },
      status: deliveryStatus, attempts: deliveryStatus === 'sent' ? 1 : 1,
      last_error: deliveryError, provider_message_id: providerId || null,
      sent_at: deliveryStatus === 'sent' ? new Date().toISOString() : null,
      idempotency_key: inviteKey,
    }).then(({ error }) => { if (error && !String(error.message).includes('duplicate')) console.error('invite delivery log failed', error.message); });

    const { data: admins } = await admin.from('property_users').select('user_id,role')
      .eq('property_id', invitation.property_id).in('role', ['owner','admin','manager']);
    const adminIds = [...new Set((admins || []).map((row: any) => row.user_id).filter(Boolean))];
    if (adminIds.length) {
      const { data: profiles } = await admin.from('profiles').select('id,email,full_name').in('id', adminIds);
      const notificationRows = (profiles || []).filter((p: any) => p.email).map((p: any) => ({
        property_id: invitation.property_id, invitation_id: invitation.id,
        event_type: 'property_admin_invited', recipient_email: p.email,
        recipient_name: p.full_name || p.email,
        payload: { property_name: propertyName, employee_name: invitation.full_name, employee_email: invitation.email, staff_role: invitation.staff_role },
        idempotency_key: `property-admin-invited:${invitation.id}:${p.id}`,
      }));
      if (notificationRows.length) await admin.from('employee_email_outbox').upsert(notificationRows, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    }
    const notifications = await processOutbox(invitation.property_id);
    await admin.from('audit_logs').insert({
      actor_id: userData.user.id,
      action: deliveryStatus === 'sent' ? 'employee_invitation_email_sent' : 'employee_invitation_email_failed',
      property_id: invitation.property_id,
      new_value: { invitation_id: invitation.id, email: invitation.email, provider_message_id: providerId || null, error: deliveryError },
    });
    if (deliveryStatus !== 'sent') return json({ error: 'Invitation was created, but Resend could not deliver the email. Use Resend on the invitation to rotate the secure link and try again.', delivery_status: 'failed' }, req, 502);
    return json({ ok: true, email: invitation.email, delivery_status: 'sent', admin_notifications: notifications }, req);
  }

  if (action === 'accepted') {
    const invitationId = typeof body.invitation_id === 'string' ? body.invitation_id : '';
    const { data: invitation } = await admin.from('employee_invitations')
      .select('id,property_id,auth_user_id,status').eq('id', invitationId).maybeSingle();
    if (!invitation || invitation.status !== 'accepted' || invitation.auth_user_id !== userData.user.id) {
      return json({ error: 'Accepted invitation not found for this account.' }, req, 403);
    }
    try {
      const result = await processOutbox(invitation.property_id);
      return json({ ok: true, notifications: result }, req);
    } catch (error) {
      return json({ error: String(error?.message || 'Notification processing failed.') }, req, 502);
    }
  }

  if (action === 'retry') {
    const propertyId = typeof body.property_id === 'string' ? body.property_id : '';
    const { data: membership } = await admin.from('property_users').select('role')
      .eq('property_id', propertyId).eq('user_id', userData.user.id).maybeSingle();
    if (!membership || !['owner','admin','manager'].includes(String(membership.role))) {
      return json({ error: 'Only property administrators can retry notification delivery.' }, req, 403);
    }
    // An administrator-requested retry explicitly makes all failed and
    // backoff-delayed pending notifications eligible now.
    await admin.from('employee_email_outbox').update({
      status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(),
      last_error: null, locked_at: null, updated_at: new Date().toISOString(),
    }).eq('property_id', propertyId).neq('event_type', 'employee_invitation').in('status', ['failed', 'pending']);
    // Recover abandoned notification jobs from a crashed invocation.
    await admin.from('employee_email_outbox').update({ status: 'pending', locked_at: null, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('property_id', propertyId).eq('status', 'processing').lt('locked_at', new Date(Date.now() - 10 * 60_000).toISOString()).neq('event_type', 'employee_invitation');
    try {
      const result = await processOutbox(propertyId, 50);
      return json({ ok: true, ...result }, req);
    } catch (error) {
      return json({ error: String(error?.message || 'Retry failed.') }, req, 502);
    }
  }

  return json({ error: 'Unsupported action.' }, req, 400);
});
