import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase 1 — employee management, department access control, manager
// authorization and employee licensing. These tests pin the security-critical
// properties of the additive migration and its frontend callers. They read the
// source as text (the established contract-test pattern in this repo); runtime
// verification happens when the migration is applied to a Supabase project.

const sql = readFileSync(new URL('../migrations/20261117105534_phase1_employee_management_licensing.sql', import.meta.url), 'utf8');
const inviteFn = readFileSync(new URL('../functions/employee-invite/index.ts', import.meta.url), 'utf8');
const managerFn = readFileSync(new URL('../functions/manager-authorize/index.ts', import.meta.url), 'utf8');
const employeeService = readFileSync(new URL('../../src/services/employeeService.js', import.meta.url), 'utf8');
const authService = readFileSync(new URL('../../src/services/authService.js', import.meta.url), 'utf8');
const permissions = readFileSync(new URL('../../src/lib/permissions.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');


test('migration uses built-in PostgreSQL types without invalid public qualification', () => {
  assert.doesNotMatch(sql, /\\bpublic\\.(jsonb|text|uuid|integer|boolean|numeric|timestamptz)\\b/i);
  assert.match(sql, /declare v jsonb;/i);
});

test('new tables enable RLS and credential tables expose nothing to clients', () => {
  for (const table of [
    'employee_permission_codes', 'employee_departments', 'employee_roles',
    'employee_invitations', 'manager_credentials', 'manager_auth_attempts',
    'module_access_grants', 'employee_access_audit', 'employee_licence_config',
    'employee_licence_addons', 'manager_authorization_tickets',
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), table);
  }
  assert.match(sql, /revoke all on public\.manager_credentials from public, anon, authenticated/i);
  assert.match(sql, /revoke all on public\.manager_auth_attempts from public, anon, authenticated/i);
  assert.match(sql, /revoke all on public\.manager_authorization_tickets from public, anon, authenticated/i);
});

test('invitation mismatch errors include the expected email format argument', () => {\n  assert.match(sql, /raise exception 'This invitation was issued to a different email address\\. Sign in with %\\.', v_inv\\.email using errcode = '42501'/i);\n});\n\ntest('invitation token hashes never leave the server', () => {
  assert.match(sql, /revoke select\(token_hash\) on public\.employee_invitations from anon, authenticated/i);
  assert.match(sql, /grant select\(id, property_id, email[\s\S]*?on public\.employee_invitations to authenticated/i);
  assert.match(sql, /token_hash text not null check \(length\(token_hash\) >= 32\)/i);
});

test('manager PINs are bcrypt-hashed server-side, rate limited and audit-logged', () => {
  assert.match(sql, /extensions\.crypt\(p_pin, extensions\.gen_salt\('bf', 12\)\)/i);
  assert.match(sql, /p_pin !~ '\^\\d\{6\}\$'/i);
  assert.match(sql, /c_max constant integer := 5;/);
  assert.match(sql, /c_window constant interval := interval '10 minutes';/);
  assert.match(sql, /c_lock constant interval := interval '5 minutes';/);
  assert.match(sql, /extensions\.crypt\(btrim\(coalesce\(p_pin, ''\)\), mc\.pin_hash\) = mc\.pin_hash/i);
  assert.match(sql, /'reason', 'wrong_pin'/i);
});

test('the browser can never author its own permission list', () => {
  assert.match(sql, /create table if not exists public\.employee_permission_codes/i);
  assert.match(sql, /function public\.fn_validate_permission_codes\(p_codes text\[\]\)/i);
  assert.match(sql, /Unknown permission code in request\./i);
  assert.match(sql, /permission_codes text\[\] not null default '\{\}'::text\[\]/i);
});

test('permission resolver follows grant -> custom role -> built-in map -> legacy modules', () => {
  assert.match(sql, /function public\.fn_employee_permission_codes\(p_property_id uuid, p_staff_id uuid default null\)/i);
  assert.match(sql, /select coalesce\(array_agg\(distinct g\.permission_code\), '\{\}'\)/i);
  assert.match(sql, /when 'front_office_manager' then array\[/i);
  assert.match(sql, /assigned_modules\) m\s*\n\s*join public\.employee_permission_codes c on c\.workspace = m and c\.code like '%\.access'/i);
});

test('licence accounting counts staff and pending invitations, not property admins', () => {
  assert.match(sql, /function public\.fn_employee_licence_state\(p_property_id uuid\)/i);
  assert.match(sql, /select count\(\*\) into v_active from public\.staff where property_id = p_property_id and is_active;/i);
  assert.match(sql, /where property_id = p_property_id and status = 'pending' and expires_at > now\(\);/i);
  assert.match(sql, /'available_licences', greatest\(v_included \+ v_addons - v_active - v_pending, 0\)/i);
  assert.match(sql, /licence_limit_reached/i);
});

test('licence add-on activation is idempotent per request and refuses unconfigured pricing', () => {
  assert.match(sql, /unique \(property_id, request_id\)/i);
  assert.match(sql, /on conflict \(property_id, request_id\) do nothing/i);
  assert.match(sql, /Additional employee pricing has not been configured\./i);
  assert.match(sql, /addon_monthly_price numeric\(12,2\),\r?\n\s*addon_currency text not null default 'KES'/i);
});

test('manager authorization tickets are single-use, short-lived and redeemed by the requester only', () => {
  assert.match(sql, /expires_at timestamptz not null default now\(\) \+ interval '90 seconds',\r?\n\s*used_at timestamptz/i);
  assert.match(sql, /if v_ticket\.requester_user_id <> auth\.uid\(\) then/i);
  assert.match(sql, /used_at is null and expires_at > now\(\)\s*\n\s*for update;/i);
  assert.match(sql, /manager_staff_id uuid references public\.staff\(id\) on delete cascade,\r?\n\s*permission_code text not null/i);
});

test('deactivating or suspending an employee revokes active grants; reactivation consumes a seat', () => {
  assert.match(sql, /if not p_active or p_suspended then\s*\n\s*update public\.module_access_grants/i);
  assert.match(sql, /if p_active then\s*\n\s*perform public\.fn_assert_licence_available\(v_property\);/i);
  assert.match(sql, /Employees cannot change their own account status\./i);
  assert.match(sql, /Employees cannot change their own role\./i);
});

test('all employee RPCs are revoked from anon and granted to authenticated', () => {
  assert.match(sql, /revoke all on function public\.fn_verify_manager_authorization\(uuid,text,text,integer,text\) from public, anon;/i);
  assert.match(sql, /revoke all on function public\.fn_accept_employee_invitation\(text\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.fn_verify_manager_authorization\(uuid,text,text,integer,text\) to authenticated;/i);
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});

test('employee-invite edge function verifies the caller and never exposes the token hash', () => {
  assert.match(inviteFn, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(inviteFn, /'owner', 'admin', 'manager'\]\.includes\(String\(membership\.role\)\)/);
  assert.match(inviteFn, /inviteUserByEmail/);
  assert.match(inviteFn, /redirectTo: `\$\{APP_URL\}\/accept-invite`/);
  assert.match(inviteFn, /invitation_token: token/);
  assert.match(inviteFn, /token\.length < 16/);
  assert.ok(!/token_hash\s*[,)]/.test(inviteFn.split('.select(')[1] || ''), 'select list must not include token_hash');
});

test('manager-authorize edge function verifies the password via Supabase Auth under the manager JWT', () => {
  assert.match(managerFn, /signInWithPassword\(\{\s*\n?\s*email: managerEmail,\s*\n?\s*password: managerPassword,\s*\n?\s*\}\)/);
  assert.match(managerFn, /managerUser\.id === requesterId/);
  assert.match(managerFn, /Authorization: `Bearer \$\{managerSession\.access_token\}`/);
  assert.match(managerFn, /fn_employee_has_permission/);
  assert.match(managerFn, /manager_authorization_tickets'\)\.insert/);
  assert.match(managerFn, /manager_staff_id: managerStaff\?\.id \?\? null/);
  assert.ok(!/manager_password[^\n]*log/i.test(managerFn));
});

test('employeeService pins the server RPC names and never writes tables directly', () => {
  assert.match(employeeService, /callRpc\('fn_create_employee_with_licence'/);
  assert.match(employeeService, /callRpc\('fn_create_employee_invitation'/);
  assert.match(employeeService, /callRpc\('fn_verify_manager_authorization'/);
  assert.match(employeeService, /callRpc\('fn_redeem_manager_authorization_ticket'/);
  assert.match(employeeService, /callRpc\('fn_set_manager_pin'/);
  assert.match(employeeService, /callRpc\('fn_activate_employee_licence_addon'/);
  assert.match(employeeService, /callRpc\('fn_accept_employee_invitation'/);
  assert.match(employeeService, /licence_limit_reached/);
});

test('frontend scoping is deliberately narrow so a missing migration cannot lock properties out', () => {
  assert.match(authService, /export function isEmployeeScopedUser\(user\)/);
  assert.match(authService, /if \(!user\.permissions\) return false;/);
  assert.match(authService, /export function canUseApp\(user, app\)/);
  assert.match(authService, /export function hasPermissionCode\(user, code\)/);
  assert.match(authService, /fn_employee_permission_summary/);
  assert.match(permissions, /a permission list supplied by the\s+\/\/ browser is never trusted by the server/i);
});

test('routes expose the employee console and the public invitation acceptance screen', () => {
  assert.match(routes, /path="employees\/manage" element=\{<EmployeeConsole tab="employees"\/>\}/);
  assert.match(routes, /path="employees\/departments"/);
  assert.match(routes, /path="employees\/roles"/);
  assert.match(routes, /path="employees\/invitations"/);
  assert.match(routes, /path="employees\/security"/);
  assert.match(routes, /path="employees\/access-history"/);
  assert.match(routes, /path="employees\/licences"/);
  assert.match(routes, /path="\/accept-invite" element=\{<AcceptInvitePage\/>\}/);
});
