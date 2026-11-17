// Employee invitation email dispatch.
//
// The browser can never hold the Supabase service role, so the actual
// "send the invitation email" step lives here. The invitation row itself and
// its acceptance are created/consumed by Postgres RPCs (fn_create_employee_
// invitation / fn_accept_employee_invitation); this function only:
//   1. verifies the caller is an administrator of the invitation's property,
//   2. asks Supabase Auth to deliver the built-in invite email, carrying the
//      one-time invitation token in the user's metadata (read back by the
//      /accept-invite screen) and redirecting to it,
//   3. records the dispatch in audit_logs.
//
// Deployed by .github/workflows/deploy-supabase-functions.yml.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
// The redirect target of Supabase's built-in invite email. Override for
// staging; production defaults to the hosted app.
const APP_URL = (Deno.env.get('INVITE_APP_URL') || 'https://app.olitechs.co.ke').replace(/\/+$/, '');
const ALLOWED_ORIGIN = (Deno.env.get('INVITE_ALLOWED_ORIGIN') || 'https://olitechpmspos.vercel.app').replace(/\/+$/, '');

// The production app is hosted on app.olitechs.co.ke. Keep the configured
// staging origin as an additional allowed origin, but never let a stale
// INVITE_ALLOWED_ORIGIN value block the canonical production app.
const APP_ORIGIN = new URL(APP_URL).origin;
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, new URL(ALLOWED_ORIGIN).origin]);

function corsHeaders(req: Request) {
  const requestOrigin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : APP_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

// One resend per minute per caller keeps the mailbox and the GoTrue
// rate limiter safe from double-clicks.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(clientKey: string) {
  const timestamp = Date.now();
  const bucket = rateBuckets.get(clientKey);
  if (!bucket || bucket.resetAt <= timestamp) {
    rateBuckets.set(clientKey, { count: 1, resetAt: timestamp + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function corsJson(data: unknown, req: Request, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return corsJson({ error: 'Method not allowed.' }, req, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const callerKey = authHeader.slice(0, 64) || 'anonymous';
  if (rateLimited(callerKey)) return corsJson({ error: 'Too many requests. Try again shortly.' }, req, 429);

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  }, req);

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return corsJson({ error: 'Sign in to send invitations.' }, req, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: 'Invalid request body.' }, req, 400);
  }

  const invitationId = typeof body.invitation_id === 'string' ? body.invitation_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return corsJson({ error: 'invitation_id is required.' }, req, 400);

  // The caller must be an administrator of the invitation's property. Verified
  // server-side here: a stale or forged invitation_id cannot be emailed out.
  const { data: invitation, error: invitationError } = await admin
    .from('employee_invitations')
    .select('id, property_id, email, status, expires_at')
    .eq('id', invitationId)
    .maybeSingle();
  if (invitationError || !invitation) return corsJson({ error: 'Invitation not found.' }, req, 404);
  if (invitation.status !== 'pending') return corsJson({ error: 'Only pending invitations can be emailed.' }, req, 409);

  const { data: membership, error: membershipError } = await admin
    .from('property_users')
    .select('role')
    .eq('property_id', invitation.property_id)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (membershipError || !membership || !['owner', 'admin', 'manager'].includes(String(membership.role))) {
    return corsJson({ error: 'Only property administrators can send invitations.' }, req, 403);
  }

  // The one-time acceptance token is regenerated by the admin UI before
  // sending; it is passed in the request body and embedded into the user's
  // metadata so the /accept-invite screen can read it back. It is never
  // written to the invitation row in clear text.
  const token = typeof body.token === 'string' ? body.token : '';
  if (token.length < 16) return corsJson({ error: 'A valid invitation token is required.' }, req, 400);

  const { error: inviteError } = await admin.auth.inviteUserByEmail(invitation.email, {
    redirectTo: `${APP_URL}/accept-invite`,
    data: { invitation_id: invitation.id, invitation_token: token, invitation_property: invitation.property_id },
  }, req);
  if (inviteError) {
    const message = String(inviteError.message || 'Invitation email failed.');
    await admin.from('audit_logs').insert({
      actor_id: userData.user.id,
      action: 'employee_invitation_email_failed',
      property_id: invitation.property_id,
      new_value: { invitation_id: invitation.id, error: message.slice(0, 200) },
    });
    return corsJson({ error: message }, req, 502);
  }

  await admin.from('audit_logs').insert({
    actor_id: userData.user.id,
    action: 'employee_invitation_email_sent',
    property_id: invitation.property_id,
    new_value: { invitation_id: invitation.id, email: invitation.email },
  }, req);

  return corsJson({ ok: true, email: invitation.email }, req);
});
