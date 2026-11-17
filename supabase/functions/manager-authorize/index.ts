// Manager authorization — password path.
//
// The full-screen manager authorization screen offers two approval methods:
//   * the manager's own PIN  -> verified entirely inside Postgres by
//     fn_verify_manager_authorization (bcrypt + rate limiting), and
//   * the manager's email/password -> verified HERE, because a Postgres RPC
//     cannot verify a Supabase Auth password.
//
// The flow keeps every security property server-side:
//   1. The requesting employee's own JWT is verified; their membership and
//      active staff identity are checked against the database.
//   2. The manager's credentials are verified by Supabase Auth itself
//      (signInWithPassword), so failed attempts are rate-limited by GoTrue and
//      the password is never stored, logged, or seen by Postgres.
//   3. The approving manager's ability to GRANT the requested permission is
//      re-checked server-side (a manager cannot approve a permission they do
//      not possess).
//   4. Instead of returning an approval the client can forge, this function
//      writes a single-use, 90-second ticket row; the employee's own session
//      redeems it via fn_redeem_manager_authorization_ticket, which re-checks
//      the manager's permission and creates the scoped, time-limited grant.
//
// Deployed by .github/workflows/deploy-supabase-functions.yml.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// Browser origins allowed to call this function. Both official production
// domains are always allowed; INVITE_ALLOWED_ORIGIN may add further origins
// (comma-separated, e.g. a staging deploy) without losing the defaults.
const BASE_ORIGINS = ['https://app.olitechs.co.ke', 'https://olitechpmspos.vercel.app'];
const configuredOrigins = (Deno.env.get('INVITE_ALLOWED_ORIGIN') || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...BASE_ORIGINS, ...configuredOrigins]);

// Echoes the request's own origin when allow-listed, so every supported
// production domain works without per-domain secrets.
function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : BASE_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const RATE_LIMIT = 10;
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

function corsJson(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MANAGER_STAFF_ROLES = new Set([
  'hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return corsJson(req, { error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  const callerKey = authHeader.slice(0, 64) || 'anonymous';
  if (rateLimited(callerKey)) return corsJson(req, { error: 'Too many attempts. Try again shortly.' }, 429);

  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return corsJson(req, { error: 'Sign in to request manager authorization.' }, 401);
  const requesterId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return corsJson(req, { error: 'Invalid request body.' }, 400);
  }

  const propertyId = typeof body.property_id === 'string' ? body.property_id : '';
  const permissionCode = typeof body.permission_code === 'string' ? body.permission_code.trim() : '';
  const managerEmail = typeof body.manager_email === 'string' ? body.manager_email.trim().toLowerCase() : '';
  const managerPassword = typeof body.manager_password === 'string' ? body.manager_password : '';
  const duration = Number.isFinite(Number(body.duration_minutes)) ? Number(body.duration_minutes) : 60;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 300) : null;

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (!uuidPattern.test(propertyId) || !permissionCode || !managerEmail || !managerPassword) {
    return corsJson(req, { error: 'property_id, permission_code, manager_email and manager_password are required.' }, 400);
  }

  // 1. The requester must belong to this property.
  const { data: membership } = await admin
    .from('property_users')
    .select('role')
    .eq('property_id', propertyId)
    .eq('user_id', requesterId)
    .maybeSingle();
  if (!membership) return corsJson(req, { error: 'You do not belong to this property.' }, 403);

  // 2. The requester must have an active employee identity to receive the grant.
  const { data: requesterStaff } = await admin
    .from('staff')
    .select('id, is_active')
    .eq('property_id', propertyId)
    .eq('user_id', requesterId)
    .maybeSingle();
  if (!requesterStaff?.is_active) {
    return corsJson(req, { error: 'Your employee profile is not active for this property.' }, 403);
  }

  // 3. Verify the manager's credentials with Supabase Auth itself. The
  //    password is only ever seen here and never persisted or logged.
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: managerSession, error: managerError } = await authClient.auth.signInWithPassword({
    email: managerEmail,
    password: managerPassword,
  });
  if (managerError || !managerSession?.user) {
    return corsJson(req, { ok: false, reason: 'wrong_credentials', error: 'Manager email or password is incorrect.' }, 401);
  }
  const managerUser = managerSession.user;

  // A manager cannot authorize their own restricted action.
  if (managerUser.id === requesterId) {
    return corsJson(req, { ok: false, reason: 'self_approval', error: 'A manager cannot approve their own request.' }, 403);
  }

  // 4. The approver must belong to the same property.
  const { data: managerMembership } = await admin
    .from('property_users')
    .select('role')
    .eq('property_id', propertyId)
    .eq('user_id', managerUser.id)
    .maybeSingle();
  if (!managerMembership) {
    return corsJson(req, { ok: false, reason: 'manager_not_authorized', error: 'The approving manager does not belong to this property.' }, 403);
  }

  // 5. Resolve the manager's employee identity (required for the permission
  //    re-check and for the audit trail).
  const { data: managerStaff } = await admin
    .from('staff')
    .select('id, full_name, role, is_active')
    .eq('property_id', propertyId)
    .eq('user_id', managerUser.id)
    .maybeSingle();

  const isPropertyAdmin = ['owner', 'admin', 'manager'].includes(String(managerMembership.role));
  const isManagerStaff = !!managerStaff?.is_active
    && MANAGER_STAFF_ROLES.has(String(managerStaff.role));
  if (!isPropertyAdmin && !isManagerStaff) {
    return corsJson(req, { ok: false, reason: 'manager_not_authorized', error: 'This account cannot approve manager authorizations.' }, 403);
  }

  // 6. The manager must hold the requested permission. Re-checked under the
  //    manager's OWN session (their JWT), so property_role()/staff lookups
  //    resolve for them — including property administrators who are not
  //    employee (staff) rows at all.
  const managerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${managerSession.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: holds, error: holdsError } = await managerClient.rpc('fn_employee_has_permission', {
    p_property_id: propertyId,
    p_code: permissionCode,
    p_staff_id: managerStaff?.id ?? null,
  });
  if (holdsError || holds !== true) {
    await admin.from('employee_access_audit').insert({
      property_id: propertyId,
      staff_id: requesterStaff.id,
      actor_user_id: requesterId,
      action: 'manager_authorization',
      permission_code: permissionCode,
      result: 'rejected',
      details: { reason: 'manager_not_authorized', manager_user_id: managerUser.id, path: 'password' },
    });
    return corsJson(req, { ok: false, reason: 'manager_not_authorized', error: 'The approving manager is not authorized to grant this permission.' }, 403);
  }

  // 7. Issue the single-use ticket. The employee's own session redeems it via
  //    fn_redeem_manager_authorization_ticket within 90 seconds.
  const ticketId = crypto.randomUUID();
  const { error: ticketError } = await admin.from('manager_authorization_tickets').insert({
    id: ticketId,
    property_id: propertyId,
    requester_user_id: requesterId,
    requester_staff_id: requesterStaff.id,
    manager_user_id: managerUser.id,
    manager_staff_id: managerStaff?.id ?? null,
    permission_code: permissionCode,
    reason,
  });
  if (ticketError) {
    return corsJson(req, { error: 'Could not record the authorization ticket.' }, 500);
  }

  return corsJson(req, {
    ok: true,
    ticket_id: ticketId,
    manager: { name: managerStaff?.full_name || managerUser.email },
  });
});
