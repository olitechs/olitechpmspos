-- Employee management, department access control, manager authorization and
-- employee licensing — Phase 1 database foundation.
--
-- ADDITIVE ONLY. This migration never drops or renumbers anything and it does
-- not modify the existing tenancy helpers (is_platform_owner,
-- is_member_of_property, property_role, current_staff_role) or the existing
-- staff table flows (verify_staff_pin / create_staff_member keep working
-- unchanged). It attaches to the existing tenant model:
--
--   auth.users -> profiles -> property_users (membership, property_id tenant key)
--   staff      (existing PIN identities, extended additively with
--               department_id / role_id columns)
--
-- New objects follow the established patterns in this repository:
--   * RLS on every table; credential tables (manager_credentials,
--     manager_auth_attempts, invitation token hashes) get NO client policies
--     at all — they are touched only by security-definer functions.
--   * Sensitive mutations happen in security-definer RPCs; the browser can
--     never supply its own permission list — codes are validated against the
--     seeded employee_permission_codes catalog server-side.
--   * Manager PINs are hashed server-side with pgcrypto bcrypt
--     (extensions.crypt / gen_salt), the same pattern as pos_access_credentials
--     in 20261106190100, and never selectable by any client role.
--   * Licensing allowances and the additional-employee monthly price come from
--     the platform-configured employee_licence_config table. No prices are
--     invented here: the add-on price column is NULL until the platform owner
--     configures it, and the UI must display an unconfigured state then.
--
-- Rate limiting: manager PIN verification reuses the staff_pin_attempts
-- design (5 failures / 10 minutes -> 5 minute lock) from 20261013200000.

-- ---------------------------------------------------------------------------
-- 1. Permission code catalog (server-side source of truth)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_permission_codes (
  code text primary key,
  workspace text not null check (workspace in ('pos','store','frontoffice','backoffice')),
  label text not null,
  sensitive boolean not null default false,
  sort_order integer not null default 100
);

alter table public.employee_permission_codes enable row level security;
-- Read-only reference data: members may read it; nobody writes it via SQL.
drop policy if exists employee_permission_codes_select on public.employee_permission_codes;
create policy employee_permission_codes_select on public.employee_permission_codes
  for select to authenticated using (true);

insert into public.employee_permission_codes (code, workspace, label, sensitive, sort_order) values
  -- POS
  ('pos.access','pos','Use the POS workspace',false,10),
  ('pos.open_shift','pos','Open a cashier shift',false,11),
  ('pos.close_shift','pos','Close a cashier shift',true,12),
  ('pos.process_sale','pos','Process sales and payments',false,13),
  ('pos.apply_discount','pos','Apply approved discounts',true,14),
  ('pos.refund','pos','Issue refunds',true,15),
  ('pos.void','pos','Void orders or sent items',true,16),
  ('pos.reprint_receipt','pos','Reprint receipts',false,17),
  -- Front Office
  ('front_office.access','frontoffice','Use the Front Office workspace',false,20),
  ('front_office.reservations.view','frontoffice','View reservations',false,21),
  ('front_office.reservations.create','frontoffice','Create reservations and walk-ins',false,22),
  ('front_office.checkin','frontoffice','Check guests in',false,23),
  ('front_office.checkout','frontoffice','Check guests out',true,24),
  ('front_office.folio.view','frontoffice','View guest folios',false,25),
  ('front_office.folio.post_charge','frontoffice','Post charges to folios',true,26),
  ('front_office.folio.payment','frontoffice','Take guest payments',true,27),
  -- Stores
  ('stores.access','store','Use the Stores workspace',false,30),
  ('stores.inventory.view','store','View inventory levels',false,31),
  ('stores.stock.receive','store','Receive stock (GRN)',true,32),
  ('stores.stock.issue','store','Issue stock',true,33),
  ('stores.stock.transfer','store','Transfer stock',false,34),
  ('stores.stock.adjust','store','Make stock adjustments',true,35),
  ('stores.suppliers.manage','store','Manage suppliers and purchasing',true,36),
  -- Back Office
  ('back_office.access','backoffice','Use the Back Office workspace',false,40),
  ('back_office.reports.view','backoffice','View financial and operational reports',false,41),
  ('back_office.settings.manage','backoffice','Manage property settings',true,42),
  ('back_office.employees.manage','backoffice','Manage employees, departments and permissions',true,43),
  ('back_office.billing.manage','backoffice','View subscription and licence billing',false,44)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Departments
-- ---------------------------------------------------------------------------

create table if not exists public.employee_departments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  default_workspace text not null check (default_workspace in ('pos','store','frontoffice','backoffice')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);
create index if not exists employee_departments_property_idx on public.employee_departments(property_id);

alter table public.employee_departments enable row level security;
drop policy if exists employee_departments_select on public.employee_departments;
create policy employee_departments_select on public.employee_departments
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
-- Department structure is administered server-side (see section 8 RPCs);
-- no direct insert/update/delete policies for clients.

-- ---------------------------------------------------------------------------
-- 3. Custom property roles (permission bundles)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_roles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  workspace text not null check (workspace in ('pos','store','frontoffice','backoffice')),
  permission_codes text[] not null default '{}'::text[],
  is_system boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);
create index if not exists employee_roles_property_idx on public.employee_roles(property_id);

alter table public.employee_roles enable row level security;
drop policy if exists employee_roles_select on public.employee_roles;
create policy employee_roles_select on public.employee_roles
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
-- Mutations only through the RPCs in section 8.

-- ---------------------------------------------------------------------------
-- 4. staff: additive department/role columns (existing columns untouched)
-- ---------------------------------------------------------------------------

alter table public.staff add column if not exists department_id uuid references public.employee_departments(id) on delete set null;
alter table public.staff add column if not exists role_id uuid references public.employee_roles(id) on delete set null;
create index if not exists staff_department_idx on public.staff(department_id) where department_id is not null;
create index if not exists staff_role_idx on public.staff(role_id) where role_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Invitations
-- ---------------------------------------------------------------------------

create table if not exists public.employee_invitations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  email text not null,
  full_name text not null,
  staff_role text not null,
  role_id uuid references public.employee_roles(id) on delete set null,
  department_id uuid references public.employee_departments(id) on delete set null,
  assigned_modules text[] not null default '{}'::text[],
  token_hash text not null check (length(token_hash) >= 32),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid references public.profiles(id) on delete set null,
  auth_user_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_invitations_property_idx on public.employee_invitations(property_id, status);
create index if not exists employee_invitations_email_idx on public.employee_invitations(property_id, lower(email), status);

alter table public.employee_invitations enable row level security;
drop policy if exists employee_invitations_select on public.employee_invitations;
create policy employee_invitations_select on public.employee_invitations
  for select to authenticated
  using (
    public.is_platform_owner()
    or (public.is_member_of_property(property_id) and auth.uid() = auth_user_id)
    -- Token hashes must never leave the server: the full column list readable
    -- by administrators is granted below WITHOUT token_hash.
    or (public.is_member_of_property(property_id) and public.is_hotel_admin(property_id))
  );
revoke select(token_hash) on public.employee_invitations from anon, authenticated;
grant select(id, property_id, email, full_name, staff_role, role_id, department_id, assigned_modules, status, invited_by, auth_user_id, expires_at, accepted_at, created_at, updated_at)
  on public.employee_invitations to authenticated;
-- All writes happen in the security-definer RPCs; no direct write policies.

-- ---------------------------------------------------------------------------
-- 6. Manager credentials (per-manager PIN, bcrypt, server-verified)
-- ---------------------------------------------------------------------------

create table if not exists public.manager_credentials (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  pin_hash text not null check (length(pin_hash) >= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manager_credentials_property_idx on public.manager_credentials(property_id);

-- Rate limiting for manager authorization attempts, keyed by the requesting
-- session (auth user + property): 5 failures / 10 minutes -> 5 minute lock.
create table if not exists public.manager_auth_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  primary key (user_id, property_id)
);

alter table public.manager_credentials enable row level security;
alter table public.manager_auth_attempts enable row level security;
revoke all on public.manager_credentials from public, anon, authenticated;
revoke all on public.manager_auth_attempts from public, anon, authenticated;
-- No client policies: only the security-definer verifier below touches them.

-- ---------------------------------------------------------------------------
-- 7. Time-limited manager access grants + access audit
-- ---------------------------------------------------------------------------

create table if not exists public.module_access_grants (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  permission_code text not null,
  granted_by_staff_id uuid references public.staff(id) on delete set null,
  granted_by_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);
create index if not exists module_access_grants_active_idx
  on public.module_access_grants(property_id, staff_id, permission_code)
  where revoked_at is null;
create index if not exists module_access_grants_expiry_idx
  on public.module_access_grants(expires_at) where revoked_at is null;

alter table public.module_access_grants enable row level security;
drop policy if exists module_access_grants_select on public.module_access_grants;
create policy module_access_grants_select on public.module_access_grants
  for select to authenticated
  using (
    public.is_platform_owner()
    or (public.is_member_of_property(property_id) and public.is_hotel_admin(property_id))
    -- An employee can see their own temporary grants so the UI can show expiry.
    or exists (
      select 1 from public.staff s
      where s.id = module_access_grants.staff_id
        and s.user_id = auth.uid()
    )
  );
-- Grants are created/expired/revoked in the verifier RPCs only.

create table if not exists public.employee_access_audit (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  permission_code text,
  module text,
  result text not null check (result in ('allowed','denied','granted','rejected','expired','revoked','error')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists employee_access_audit_property_idx on public.employee_access_audit(property_id, created_at desc);

alter table public.employee_access_audit enable row level security;
drop policy if exists employee_access_audit_select on public.employee_access_audit;
create policy employee_access_audit_select on public.employee_access_audit
  for select to authenticated
  using (public.is_platform_owner() or (public.is_member_of_property(property_id) and public.is_hotel_admin(property_id)));
-- Append-only: writes happen inside the definer RPCs; no insert/update/delete
-- policies exist for any client role.

-- ---------------------------------------------------------------------------
-- 8. Employee licensing
-- ---------------------------------------------------------------------------

-- Platform-configured allowances and the additional-employee monthly price.
-- No price is invented by this migration: addon_monthly_price starts NULL and
-- stays NULL until the platform owner configures it.
create table if not exists public.employee_licence_config (
  plan_code text primary key,
  included_employees integer not null check (included_employees >= 1),
  addon_monthly_price numeric(12,2),
  addon_currency text not null default 'KES',
  max_grant_minutes integer not null default 240 check (max_grant_minutes between 5 and 720),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.employee_licence_config enable row level security;
drop policy if exists employee_licence_config_select on public.employee_licence_config;
create policy employee_licence_config_select on public.employee_licence_config
  for select to authenticated using (true);

insert into public.employee_licence_config (plan_code, included_employees, addon_monthly_price) values
  ('starter',      1, null),
  ('standard',     1, null),
  ('premium',      1, null),
  ('professional', 5, null),
  ('enterprise',   5, null)
on conflict (plan_code) do nothing;

-- Additional employee licence add-ons purchased through the existing billing
-- system. request_id makes activation idempotent: the same browser request
-- retried twice inserts one row, preventing duplicate licence charges.
create table if not exists public.employee_licence_addons (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  request_id uuid not null,
  quantity integer not null check (quantity between 1 and 100),
  monthly_price numeric(12,2) not null check (monthly_price >= 0),
  currency text not null default 'KES',
  status text not null default 'active' check (status in ('active','cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, request_id)
);
create index if not exists employee_licence_addons_property_idx
  on public.employee_licence_addons(property_id, status);

alter table public.employee_licence_addons enable row level security;
drop policy if exists employee_licence_addons_select on public.employee_licence_addons;
create policy employee_licence_addons_select on public.employee_licence_addons
  for select to authenticated
  using (public.is_platform_owner() or (public.is_member_of_property(property_id) and public.is_hotel_admin(property_id)));
-- Purchases/cancellations happen through the definer RPCs only.

-- ---------------------------------------------------------------------------
-- 9. Server-side permission resolver
-- ---------------------------------------------------------------------------

create or replace function public.fn_employee_permission_codes(p_property_id uuid, p_staff_id uuid default null)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_staff public.staff;
  v_codes text[];
  v_workspace text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return '{}';
  end if;

  -- The property administrator/owner account (property_users owner/admin)
  -- implicitly holds every permission of its property.
  if public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;

  select * into v_staff from public.staff
  where id = coalesce(p_staff_id, public.current_staff_id(p_property_id))
    and property_id = p_property_id
    and is_active = true
  limit 1;

  if v_staff.id is null then
    return '{}';
  end if;

  -- Precedence 1: active, unexpired manager authorization grants.
  select coalesce(array_agg(distinct g.permission_code), '{}') into v_codes
  from public.module_access_grants g
  where g.property_id = p_property_id
    and g.staff_id = v_staff.id
    and g.revoked_at is null
    and g.expires_at > now();

  -- Precedence 2: the assigned custom role's permission bundle.
  if v_staff.role_id is not null then
    select array((select unnest(r.permission_codes)
                  union
                  select unnest(coalesce(v_codes, '{}'::text[]))))
      into v_codes
    from public.employee_roles r
    where r.id = v_staff.role_id and r.property_id = p_property_id;
  end if;

  -- Precedence 3: the built-in staff role map (backward compatible with every
  -- existing staff row that has no role_id).
  if coalesce(array_length(coalesce(v_codes, '{}'::text[]), 1), 0) = 0 then
    v_codes := case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment','pos.access','pos.process_sale','stores.access','stores.inventory.view','back_office.access','back_office.reports.view']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access','front_office.reservations.view']
      else '{}'::text[]
    end;
  end if;

  -- Backward-compatibility fallback: a staff row still using the legacy
  -- assigned_modules text[] keeps its workspace-level .access codes.
  if coalesce(array_length(coalesce(v_codes, '{}'::text[]), 1), 0) = 0
     and coalesce(array_length(coalesce(v_staff.assigned_modules, '{}'::text[]), 1), 0) > 0 then
    select coalesce(array_agg(c.code), '{}') into v_codes
    from unnest(v_staff.assigned_modules) m
    join public.employee_permission_codes c on c.workspace = m and c.code like '%.access';
  end if;

  return coalesce(v_codes, '{}');
end;
$$;

create or replace function public.fn_employee_has_permission(p_property_id uuid, p_code text, p_staff_id uuid default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(p_code = any(public.fn_employee_permission_codes(p_property_id, p_staff_id)), false);
$$;

-- Workspace resolution for navigation hiding. Returns the workspaces the
-- current employee may open, honouring legacy assigned_modules too.
create or replace function public.fn_employee_workspaces(p_property_id uuid)
returns text[]
language sql stable security definer set search_path = public
as $$
  with codes as (select unnest(public.fn_employee_permission_codes(p_property_id)) as code)
  select distinct coalesce(array_agg(c.workspace), '{}')
  from codes join public.employee_permission_codes c on c.code = codes.code;
$$;

-- ---------------------------------------------------------------------------
-- 10. Access audit helper (no secrets: callers pass labels, not credentials)
-- ---------------------------------------------------------------------------

create or replace function public.fn_log_employee_access(
  p_property_id uuid,
  p_staff_id uuid,
  p_action text,
  p_permission_code text default null,
  p_module text default null,
  p_result text default 'allowed',
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return;
  end if;
  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, module, result, details)
  values (p_property_id, p_staff_id, auth.uid(), p_action, p_permission_code, p_module, p_result, p_details);
end;
$$;
revoke all on function public.fn_log_employee_access(uuid,uuid,text,text,text,text,jsonb) from public, anon;
grant execute on function public.fn_log_employee_access(uuid,uuid,text,text,text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Departments / roles / employee administration RPCs
-- ---------------------------------------------------------------------------

create or replace function public.fn_create_employee_department(
  p_property_id uuid, p_name text, p_default_workspace text, p_description text default null
)
returns public.employee_departments
language plpgsql security definer set search_path = public
as $$
declare v public.employee_departments;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can manage departments.' using errcode = '42501';
  end if;
  insert into public.employee_departments(property_id, name, default_workspace, description, created_by)
  values (p_property_id, btrim(p_name), p_default_workspace, p_description, auth.uid())
  returning * into v;
  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_department_created', p_property_id,
    jsonb_build_object('department_id', v.id, 'name', v.name, 'default_workspace', v.default_workspace));
  return v;
end;
$$;

create or replace function public.fn_update_employee_department(p_department_id uuid, p_name text, p_default_workspace text, p_description text default null)
returns public.employee_departments
language plpgsql security definer set search_path = public
as $$
declare v public.employee_departments;
begin
  select * into v from public.employee_departments where id = p_department_id;
  if v.id is null then raise exception 'Department not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v.property_id)) then
    raise exception 'Only property administrators can manage departments.' using errcode = '42501';
  end if;
  update public.employee_departments
    set name = btrim(p_name), default_workspace = p_default_workspace, description = p_description, updated_at = now()
  where id = p_department_id
  returning * into v;
  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_department_updated', v.property_id, jsonb_build_object('department_id', v.id, 'name', v.name));
  return v;
end;
$$;

create or replace function public.fn_delete_employee_department(p_department_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid;
begin
  select property_id into v_property from public.employee_departments where id = p_department_id;
  if v_property is null then return false; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v_property)) then
    raise exception 'Only property administrators can manage departments.' using errcode = '42501';
  end if;
  delete from public.employee_departments where id = p_department_id;
  insert into public.audit_logs(actor_id, action, property_id, old_value)
  values (auth.uid(), 'employee_department_deleted', v_property, jsonb_build_object('department_id', p_department_id));
  return true;
end;
$$;

-- Validates a permission list against the seeded catalog; the browser never
-- defines its own codes.
create or replace function public.fn_validate_permission_codes(p_codes text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(array_length(coalesce(p_codes, '{}'::text[]), 1), 0) = 0
     or not exists (
       select 1 from unnest(coalesce(p_codes, '{}'::text[])) c
       left join public.employee_permission_codes e on e.code = c
       where e.code is null
     );
$$;

create or replace function public.fn_create_employee_role(
  p_property_id uuid, p_name text, p_workspace text, p_permission_codes text[], p_description text default null
)
returns public.employee_roles
language plpgsql security definer set search_path = public
as $$
declare v public.employee_roles;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can manage roles.' using errcode = '42501';
  end if;
  if not public.fn_validate_permission_codes(p_permission_codes) then
    raise exception 'Unknown permission code in request.' using errcode = '22023';
  end if;
  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, created_by)
  values (p_property_id, btrim(p_name), p_workspace, coalesce(p_permission_codes, '{}'), p_description, auth.uid())
  returning * into v;
  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_role_created', p_property_id, jsonb_build_object('role_id', v.id, 'name', v.name, 'workspace', v.workspace));
  return v;
end;
$$;

create or replace function public.fn_update_employee_role(p_role_id uuid, p_name text, p_workspace text, p_permission_codes text[], p_description text default null)
returns public.employee_roles
language plpgsql security definer set search_path = public
as $$
declare v public.employee_roles;
begin
  select * into v from public.employee_roles where id = p_role_id;
  if v.id is null then raise exception 'Role not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v.property_id)) then
    raise exception 'Only property administrators can manage roles.' using errcode = '42501';
  end if;
  if v.is_system then
    raise exception 'Built-in roles cannot be edited. Create a custom role instead.' using errcode = '42501';
  end if;
  if not public.fn_validate_permission_codes(p_permission_codes) then
    raise exception 'Unknown permission code in request.' using errcode = '22023';
  end if;
  update public.employee_roles
    set name = btrim(p_name), workspace = p_workspace, permission_codes = coalesce(p_permission_codes, '{}'),
        description = p_description, updated_at = now()
  where id = p_role_id
  returning * into v;
  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (auth.uid(), 'employee_role_updated', v.property_id, jsonb_build_object('role_id', v.id), jsonb_build_object('role_id', v.id, 'name', v.name));
  return v;
end;
$$;

create or replace function public.fn_delete_employee_role(p_role_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v public.employee_roles;
begin
  select * into v from public.employee_roles where id = p_role_id;
  if v.id is null then return false; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v.property_id)) then
    raise exception 'Only property administrators can manage roles.' using errcode = '42501';
  end if;
  if v.is_system then
    raise exception 'Built-in roles cannot be deleted.' using errcode = '42501';
  end if;
  delete from public.employee_roles where id = p_role_id;
  insert into public.audit_logs(actor_id, action, property_id, old_value)
  values (auth.uid(), 'employee_role_deleted', v.property_id, jsonb_build_object('role_id', p_role_id, 'name', v.name));
  return true;
end;
$$;

-- Seeds built-in property roles once per property (idempotent).
create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id,'Cashier','pos','{pos.access,pos.open_shift,pos.close_shift,pos.process_sale,pos.apply_discount}','POS cashier workspace',true),
    (p_property_id,'Waiter','pos','{pos.access,pos.open_shift,pos.process_sale}','Restaurant waiter workspace',true),
    (p_property_id,'Storekeeper','store','{stores.access,stores.inventory.view,stores.stock.receive,stores.stock.issue,stores.stock.transfer}','Stores workspace',true),
    (p_property_id,'Receptionist','frontoffice','{front_office.access,front_office.reservations.view,front_office.reservations.create,front_office.checkin,front_office.folio.view,front_office.folio.payment}','Front Office workspace',true),
    (p_property_id,'Accountant','backoffice','{back_office.access,back_office.reports.view,back_office.billing.manage}','Financial reports and accounting',true),
    (p_property_id,'Property Manager','backoffice','{back_office.access,back_office.reports.view,back_office.employees.manage,back_office.settings.manage,pos.access,front_office.access,stores.access}','Assigned management modules',true)
  on conflict (property_id, name) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Employee creation with licence enforcement
-- ---------------------------------------------------------------------------

-- Licence math shared by employee creation and invitations:
-- counted employees = active staff rows + pending invitations.
-- The property owner / administrators (property_users owner/admin) are NOT
-- paid employees and are never counted.
create or replace function public.fn_employee_licence_state(p_property_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_plan text;
  v_included integer;
  v_price numeric;
  v_currency text;
  v_max_grant integer;
  v_active integer;
  v_pending integer;
  v_addons integer;
  v_next_billing timestamptz;
  v_sub_status text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select coalesce(ps.plan_code, p.package::text) into v_plan
  from public.properties p left join public.property_subscriptions ps on ps.property_id = p.id
  where p.id = p_property_id;

  select c.included_employees, c.addon_monthly_price, c.addon_currency, c.max_grant_minutes
    into v_included, v_price, v_currency, v_max_grant
  from public.employee_licence_config c
  where c.plan_code = lower(v_plan) and c.active;

  -- Unknown plan codes behave like the closest configured default (1 seat)
  -- instead of silently allowing unlimited employees.
  v_included := coalesce(v_included, 1);

  select count(*) into v_active from public.staff where property_id = p_property_id and is_active;
  select count(*) into v_pending from public.employee_invitations
    where property_id = p_property_id and status = 'pending' and expires_at > now();
  select coalesce(sum(quantity), 0) into v_addons from public.employee_licence_addons
    where property_id = p_property_id and status = 'active';

  select ps.current_period_ends_at, ps.status into v_next_billing, v_sub_status
  from public.property_subscriptions ps where ps.property_id = p_property_id;

  return jsonb_build_object(
    'plan_code', lower(coalesce(v_plan, '')),
    'included_employees', v_included,
    'registered_employees', v_active,
    'pending_invitations', v_pending,
    'additional_employees', v_addons,
    'available_licences', greatest(v_included + v_addons - v_active - v_pending, 0),
    'over_limit', greatest((v_active + v_pending) - (v_included + v_addons), 0),
    'addon_monthly_price', v_price,
    'addon_currency', v_currency,
    'max_grant_minutes', coalesce(v_max_grant, 240),
    'next_billing_date', v_next_billing,
    'subscription_status', v_sub_status
  );
end;
$$;

create or replace function public.fn_assert_licence_available(p_property_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v jsonb;
begin
  v := public.fn_employee_licence_state(p_property_id);
  if (v->>'over_limit')::int > 0 or (v->>'available_licences')::int < 1 then
    raise exception 'licence_limit_reached: %', v::text
      using errcode = 'P0001', detail = v::text;
  end if;
  return v;
end;
$$;

create or replace function public.fn_create_employee_with_licence(
  p_property_id uuid, p_full_name text, p_email text, p_phone text,
  p_staff_role text, p_assigned_modules text[], p_pin_hash text,
  p_role_id uuid default null, p_department_id uuid default null,
  p_avatar text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.staff;
  v_user_id uuid;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can add employees.' using errcode = '42501';
  end if;
  if not public.fn_subscription_module_allowed(p_property_id, 'backoffice') then
    raise exception 'Back Office is not enabled for this subscription.';
  end if;
  if p_staff_role not in ('super_admin','hotel_admin','front_office_manager','receptionist','front_desk','pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor') then
    raise exception 'Invalid staff role.';
  end if;
  if length(p_pin_hash) < 32 then raise exception 'Invalid PIN hash.'; end if;
  if p_role_id is not null then
    if not exists (select 1 from public.employee_roles r where r.id = p_role_id and r.property_id = p_property_id) then
      raise exception 'Unknown role for this property.';
    end if;
  end if;
  if p_department_id is not null then
    if not exists (select 1 from public.employee_departments d where d.id = p_department_id and d.property_id = p_property_id) then
      raise exception 'Unknown department for this property.';
    end if;
  end if;

  perform public.fn_assert_licence_available(p_property_id);

  select id into v_user_id from public.profiles where lower(email) = lower(nullif(trim(p_email),'')) limit 1;

  insert into public.staff(full_name, email, phone, role, assigned_modules, pin_hash, is_active,
                           property_id, created_by, avatar, user_id, role_id, department_id)
  values (btrim(p_full_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), p_staff_role,
          coalesce(p_assigned_modules, '{}'), p_pin_hash, true, p_property_id, auth.uid(), p_avatar, v_user_id,
          p_role_id, p_department_id)
  returning * into s;

  perform public.fn_seed_employee_roles(p_property_id);

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_created', p_property_id,
    jsonb_build_object('staff_id', s.id, 'email', s.email, 'staff_role', s.role, 'role_id', p_role_id, 'department_id', p_department_id));

  return jsonb_build_object(
    'id', s.id, 'full_name', s.full_name, 'email', s.email, 'phone', s.phone,
    'role', s.role, 'assigned_modules', s.assigned_modules, 'is_active', s.is_active,
    'property_id', s.property_id, 'avatar', s.avatar, 'last_login', s.last_login,
    'role_id', s.role_id, 'department_id', s.department_id
  );
end;
$$;

create or replace function public.fn_set_employee_department(p_staff_id uuid, p_department_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid; v_old uuid;
begin
  select property_id, department_id into v_property, v_old from public.staff where id = p_staff_id;
  if v_property is null then raise exception 'Employee not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v_property)) then
    raise exception 'Only property administrators can manage employees.' using errcode = '42501';
  end if;
  if p_department_id is not null and not exists
    (select 1 from public.employee_departments where id = p_department_id and property_id = v_property) then
    raise exception 'Unknown department for this property.';
  end if;
  update public.staff set department_id = p_department_id where id = p_staff_id;
  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (auth.uid(), 'employee_department_assigned', v_property,
    jsonb_build_object('staff_id', p_staff_id, 'department_id', v_old),
    jsonb_build_object('staff_id', p_staff_id, 'department_id', p_department_id));
  return true;
end;
$$;

create or replace function public.fn_set_employee_role(p_staff_id uuid, p_role_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid; v_old uuid;
begin
  select property_id, role_id into v_property, v_old from public.staff where id = p_staff_id;
  if v_property is null then raise exception 'Employee not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v_property)) then
    raise exception 'Only property administrators can manage employees.' using errcode = '42501';
  end if;
  if p_role_id is not null and not exists
    (select 1 from public.employee_roles where id = p_role_id and property_id = v_property) then
    raise exception 'Unknown role for this property.';
  end if;
  -- An employee can never change their own role or permissions.
  if exists (select 1 from public.staff s where s.id = p_staff_id and s.user_id = auth.uid())
     and not public.is_platform_owner() then
    raise exception 'Employees cannot change their own role.' using errcode = '42501';
  end if;
  update public.staff set role_id = p_role_id where id = p_staff_id;
  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (auth.uid(), 'employee_role_assigned', v_property,
    jsonb_build_object('staff_id', p_staff_id, 'role_id', v_old),
    jsonb_build_object('staff_id', p_staff_id, 'role_id', p_role_id));
  return true;
end;
$$;

create or replace function public.fn_set_employee_status(p_staff_id uuid, p_active boolean, p_suspended boolean default false)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid;
begin
  select property_id into v_property from public.staff where id = p_staff_id;
  if v_property is null then raise exception 'Employee not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v_property)) then
    raise exception 'Only property administrators can manage employees.' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff s where s.id = p_staff_id and s.user_id = auth.uid())
     and not public.is_platform_owner() then
    raise exception 'Employees cannot change their own account status.' using errcode = '42501';
  end if;
  -- Reactivating consumes a licence seat again; refuse when none is available.
  if p_active then
    perform public.fn_assert_licence_available(v_property);
  end if;
  update public.staff set is_active = p_active where id = p_staff_id;
  -- Deactivating or suspending revokes every active temporary grant at once.
  if not p_active or p_suspended then
    update public.module_access_grants
      set revoked_at = now(), revoked_by = auth.uid()
    where staff_id = p_staff_id and revoked_at is null;
  end if;
  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(),
    case when not p_active and p_suspended then 'employee_suspended' when not p_active then 'employee_deactivated' else 'employee_reactivated' end,
    v_property, jsonb_build_object('staff_id', p_staff_id, 'is_active', p_active));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Invitations (token: bcrypt-hashed at rest, shown to the caller once)
-- ---------------------------------------------------------------------------

create or replace function public.fn_create_employee_invitation(
  p_property_id uuid, p_email text, p_full_name text,
  p_staff_role text, p_assigned_modules text[],
  p_role_id uuid default null, p_department_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_invitation public.employee_invitations;
  v_token text;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can invite employees.' using errcode = '42501';
  end if;
  if not public.fn_subscription_module_allowed(p_property_id, 'backoffice') then
    raise exception 'Back Office is not enabled for this subscription.';
  end if;
  if p_email is null or position('@' in p_email) < 2 then
    raise exception 'A valid email address is required.';
  end if;
  if p_staff_role not in ('super_admin','hotel_admin','front_office_manager','receptionist','front_desk','pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor') then
    raise exception 'Invalid staff role.';
  end if;

  -- Existing active employee with this email: reject the duplicate membership.
  if exists (
    select 1 from public.staff
    where property_id = p_property_id and is_active and lower(email) = lower(btrim(p_email))
  ) then
    raise exception 'An active employee with this email already exists for this property.';
  end if;

  -- Pending invitations count toward the licence allowance: creating one more
  -- than the allowance permits is rejected up front.
  perform public.fn_assert_licence_available(p_property_id);

  -- A pending invitation for the same email is replaced (resent) rather than duplicated.
  update public.employee_invitations
    set status = 'revoked', updated_at = now()
  where property_id = p_property_id and status = 'pending' and lower(email) = lower(btrim(p_email));

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.employee_invitations(
    property_id, email, full_name, staff_role, role_id, department_id, assigned_modules,
    token_hash, status, invited_by, expires_at
  )
  values (
    p_property_id, btrim(p_email), btrim(p_full_name), p_staff_role, p_role_id, p_department_id,
    coalesce(p_assigned_modules, '{}'),
    extensions.crypt(v_token, extensions.gen_salt('bf', 12)),
    'pending', auth.uid(), now() + interval '7 days'
  )
  returning * into v_invitation;

  perform public.fn_seed_employee_roles(p_property_id);

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_invitation_created', p_property_id,
    jsonb_build_object('invitation_id', v_invitation.id, 'email', v_invitation.email));

  -- The raw token is returned exactly once and never stored in clear text.
  return jsonb_build_object(
    'invitation', jsonb_build_object(
      'id', v_invitation.id, 'email', v_invitation.email, 'full_name', v_invitation.full_name,
      'staff_role', v_invitation.staff_role, 'status', v_invitation.status,
      'expires_at', v_invitation.expires_at, 'created_at', v_invitation.created_at
    ),
    'token', v_token
  );
end;
$$;

create or replace function public.fn_resend_employee_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v public.employee_invitations; v_token text;
begin
  select * into v from public.employee_invitations where id = p_invitation_id;
  if v.id is null then raise exception 'Invitation not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v.property_id)) then
    raise exception 'Only property administrators can invite employees.' using errcode = '42501';
  end if;
  if v.status <> 'pending' then raise exception 'Only pending invitations can be resent.'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  update public.employee_invitations
    set token_hash = extensions.crypt(v_token, extensions.gen_salt('bf', 12)),
        expires_at = now() + interval '7 days',
        updated_at = now()
  where id = p_invitation_id
  returning * into v;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_invitation_resent', v.property_id, jsonb_build_object('invitation_id', v.id));

  return jsonb_build_object('invitation_id', v.id, 'email', v.email, 'expires_at', v.expires_at, 'token', v_token);
end;
$$;

create or replace function public.fn_revoke_employee_invitation(p_invitation_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid;
begin
  select property_id into v_property from public.employee_invitations where id = p_invitation_id;
  if v_property is null then return false; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v_property)) then
    raise exception 'Only property administrators can invite employees.' using errcode = '42501';
  end if;
  update public.employee_invitations set status = 'revoked', updated_at = now() where id = p_invitation_id;
  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_invitation_revoked', v_property, jsonb_build_object('invitation_id', p_invitation_id));
  return true;
end;
$$;

-- Called by the invitee AFTER they have created their own credentials
-- (Supabase Auth signup through the invite link). Binds their auth user to
-- the invited staff identity. Cross-property safe: the invitation row itself
-- carries the property.
create or replace function public.fn_accept_employee_invitation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_inv public.employee_invitations;
  v_staff public.staff;
begin
  if auth.uid() is null then
    raise exception 'Sign in with the account you created from your invitation email.' using errcode = '42501';
  end if;
  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'Invalid invitation token.' using errcode = '22023';
  end if;

  select * into v_inv from public.employee_invitations
  where status = 'pending' and expires_at > now()
    and token_hash = extensions.crypt(btrim(p_token), token_hash)
  limit 1;

  if v_inv.id is null then
    raise exception 'This invitation is no longer valid. Ask your administrator to resend it.' using errcode = '22023';
  end if;

  -- The invitee must have created their auth account with the invited email.
  if not exists (
    select 1 from public.profiles where id = auth.uid() and lower(email) = lower(v_inv.email)
  ) then
    raise exception 'This invitation was issued to a different email address. Sign in with %.' using errcode = '42501';
  end if;

  -- Idempotent acceptance.
  select * into v_staff from public.staff
  where property_id = v_inv.property_id and user_id = auth.uid() limit 1;
  if v_staff.id is not null then
    update public.employee_invitations
      set status = 'accepted', accepted_at = coalesce(accepted_at, now()), auth_user_id = auth.uid(), updated_at = now()
    where id = v_inv.id;
    return jsonb_build_object('ok', true, 'already_member', true, 'property_id', v_inv.property_id);
  end if;

  perform public.fn_assert_licence_available(v_inv.property_id);

  -- If the invitation was created before the employee existed as a PIN row,
  -- link that row; otherwise create the employee now.
  select * into v_staff from public.staff
  where property_id = v_inv.property_id and is_active = false and lower(email) = lower(v_inv.email)
  limit 1;

  if v_staff.id is not null then
    update public.staff
      set is_active = true, user_id = auth.uid(), role_id = coalesce(v_inv.role_id, role_id),
          department_id = coalesce(v_inv.department_id, department_id), last_login = now(), updated_at = now()
    where id = v_staff.id
    returning * into v_staff;
  else
    insert into public.staff(full_name, email, role, assigned_modules, pin_hash, is_active,
                             property_id, created_by, user_id, role_id, department_id, last_login)
    values (v_inv.full_name, v_inv.email, v_inv.staff_role, coalesce(v_inv.assigned_modules, '{}'),
            extensions.crypt(encode(gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 12)),
            true, v_inv.property_id, v_inv.invited_by, auth.uid(),
            v_inv.role_id, v_inv.department_id, now())
    returning * into v_staff;
    -- A PIN row created at acceptance has no known PIN yet; the admin issues
    -- one through the existing PIN & Security console.
  end if;

  update public.employee_invitations
    set status = 'accepted', accepted_at = now(), auth_user_id = auth.uid(), updated_at = now()
  where id = v_inv.id;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (auth.uid(), 'employee_invitation_accepted', v_inv.property_id,
    jsonb_build_object('invitation_id', v_inv.id, 'staff_id', v_staff.id, 'user_id', auth.uid()));

  return jsonb_build_object('ok', true, 'already_member', false, 'property_id', v_inv.property_id, 'staff_id', v_staff.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Manager authorization (full-screen flow, server-side verification)
-- ---------------------------------------------------------------------------

create or replace function public.fn_set_manager_pin(p_property_id uuid, p_staff_id uuid, p_pin text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_staff public.staff;
begin
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'A manager PIN must be exactly 6 digits.' using errcode = '22023';
  end if;
  select * into v_staff from public.staff where id = p_staff_id and property_id = p_property_id;
  if v_staff.id is null then raise exception 'Employee not found.'; end if;

  -- Either the staff member themselves (signed in as that staff identity) or
  -- a property administrator may set the PIN. Managers may not set a PIN for
  -- a role they do not hold.
  if v_staff.user_id is null or v_staff.user_id <> auth.uid() then
    if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
  end if;
  if v_staff.role not in ('hotel_admin','super_admin','front_office_manager','store_manager','fb_manager') then
    raise exception 'Only managers can hold a manager authorization PIN.';
  end if;

  insert into public.manager_credentials(staff_id, property_id, pin_hash)
  values (p_staff_id, p_property_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)))
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash, property_id = excluded.property_id, updated_at = now();

  -- PIN hashes are audit-relevant events but never their values.
  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, result)
  values (p_property_id, p_staff_id, auth.uid(), 'manager_pin_set', 'granted');
  return true;
end;
$$;

create or replace function public.fn_clear_manager_pin(p_property_id uuid, p_staff_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can manage manager credentials.' using errcode = '42501';
  end if;
  delete from public.manager_credentials where staff_id = p_staff_id and property_id = p_property_id;
  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, result)
  values (p_property_id, p_staff_id, auth.uid(), 'manager_pin_cleared', 'revoked');
  return true;
end;
$$;

-- Verify a manager PIN and issue a scoped, time-limited access grant.
-- The requester is the currently active PIN staff session; the approver is
-- whoever's manager credential matched. A manager can never approve a
-- permission they do not hold, and nobody approves with their own PIN.
create or replace function public.fn_verify_manager_authorization(
  p_property_id uuid,
  p_permission_code text,
  p_pin text,
  p_duration_minutes integer default 60,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c_max constant integer := 5;
  c_window constant interval := interval '10 minutes';
  c_lock constant interval := interval '5 minutes';

  v_requester public.staff;
  v_manager record;
  v_attempts public.manager_auth_attempts;
  v_attempts_remaining integer;
  v_config public.employee_licence_config;
  v_max_minutes integer;
  v_duration integer;
  v_grant public.module_access_grants;
begin
  if auth.uid() is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employee_permission_codes where code = p_permission_code) then
    raise exception 'Unknown permission code.' using errcode = '22023';
  end if;

  select * into v_attempts from public.manager_auth_attempts
  where user_id = auth.uid() and property_id = p_property_id for update;
  if found and v_attempts.locked_until is not null and v_attempts.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked',
      'retry_after_seconds', ceil(extract(epoch from (v_attempts.locked_until - now())))::int);
  end if;

  -- The requesting employee identity (PIN session takes precedence).
  select * into v_requester from public.staff
  where id = public.current_staff_id(p_property_id) and property_id = p_property_id and is_active
  limit 1;
  if v_requester.id is null then
    select * into v_requester from public.staff
    where property_id = p_property_id and is_active and user_id = auth.uid()
    limit 1;
  end if;
  if v_requester.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_requester_identity');
  end if;

  -- Find the manager whose credential matches this PIN. Candidates are active
  -- managers with a credential, always excluding the requester themselves.
  select s.id as staff_id, s.full_name, s.role, mc.pin_hash
    into v_manager
  from public.manager_credentials mc
  join public.staff s on s.id = mc.staff_id
  where mc.property_id = p_property_id
    and s.property_id = p_property_id
    and s.is_active
    and s.id <> v_requester.id
    and s.role in ('hotel_admin','super_admin','front_office_manager','store_manager','fb_manager')
    and extensions.crypt(btrim(coalesce(p_pin, '')), mc.pin_hash) = mc.pin_hash
  limit 1;

  if v_manager.staff_id is null then
    -- Distinguish "no manager has a credential at all" from "wrong PIN".
    if exists (
      select 1 from public.manager_credentials mc
      join public.staff s on s.id = mc.staff_id
      where mc.property_id = p_property_id and s.is_active and s.id <> v_requester.id
        and s.role in ('hotel_admin','super_admin','front_office_manager','store_manager','fb_manager')
    ) then
      insert into public.manager_auth_attempts(user_id, property_id, failed_count, window_started_at, locked_until)
      values (auth.uid(), p_property_id, 1, now(), null)
      on conflict (user_id, property_id) do update
        set failed_count = case
              when public.manager_auth_attempts.window_started_at < now() - c_window
                or (public.manager_auth_attempts.locked_until is not null and public.manager_auth_attempts.locked_until <= now())
              then 1 else public.manager_auth_attempts.failed_count + 1 end,
            window_started_at = case
              when public.manager_auth_attempts.window_started_at < now() - c_window
                or (public.manager_auth_attempts.locked_until is not null and public.manager_auth_attempts.locked_until <= now())
              then now() else public.manager_auth_attempts.window_started_at end,
            locked_until = case
              when (public.manager_auth_attempts.failed_count + 1) >= c_max then now() + c_lock
              else public.manager_auth_attempts.locked_until end;

      insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
      values (p_property_id, v_requester.id, auth.uid(), 'manager_authorization', p_permission_code, 'denied',
        jsonb_build_object('reason', 'wrong_pin'));

      -- Report remaining attempts (0 means the next failure locks).
      select greatest(c_max - failed_count, 0) into v_attempts_remaining
        from public.manager_auth_attempts where user_id = auth.uid() and property_id = p_property_id;
      return jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'attempts_remaining', v_attempts_remaining);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_manager_pin');
  end if;

  -- The manager must actually hold the requested permission.
  if not public.fn_employee_has_permission(p_property_id, p_permission_code, v_manager.staff_id) then
    insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
    values (p_property_id, v_requester.id, auth.uid(), 'manager_authorization', p_permission_code, 'rejected',
      jsonb_build_object('reason', 'manager_not_authorized', 'manager_staff_id', v_manager.staff_id));
    return jsonb_build_object('ok', false, 'reason', 'manager_not_authorized');
  end if;

  select * into v_config from public.employee_licence_config where plan_code = (
    select coalesce(lower(ps.plan_code), p.package::text)
    from public.properties p left join public.property_subscriptions ps on ps.property_id = p.id
    where p.id = p_property_id
  );
  v_max_minutes := coalesce(v_config.max_grant_minutes, 240);
  v_duration := least(greatest(coalesce(p_duration_minutes, 60), 5), v_max_minutes);

  -- One active grant per (employee, permission): a new approval replaces the
  -- previous one rather than stacking.
  update public.module_access_grants
    set revoked_at = now(), revoked_by = auth.uid()
  where property_id = p_property_id and staff_id = v_requester.id
    and permission_code = p_permission_code and revoked_at is null;

  insert into public.module_access_grants(
    property_id, staff_id, permission_code, granted_by_staff_id, granted_by_user_id, reason, expires_at
  )
  values (
    p_property_id, v_requester.id, p_permission_code, v_manager.staff_id, auth.uid(), p_reason,
    now() + make_interval(mins => v_duration)
  )
  returning * into v_grant;

  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
  values (p_property_id, v_requester.id, auth.uid(), 'manager_authorization', p_permission_code, 'granted',
    jsonb_build_object('manager_staff_id', v_manager.staff_id, 'manager_name', v_manager.full_name,
                       'expires_at', v_grant.expires_at, 'duration_minutes', v_duration));

  -- A successful authorization clears the failure window.
  delete from public.manager_auth_attempts where user_id = auth.uid() and property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'grant', jsonb_build_object(
      'id', v_grant.id, 'permission_code', v_grant.permission_code,
      'expires_at', v_grant.expires_at
    ),
    'manager', jsonb_build_object('name', v_manager.full_name, 'role', v_manager.role)
  );
end;
$$;

create or replace function public.fn_revoke_manager_grant(p_property_id uuid, p_grant_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_grant public.module_access_grants;
begin
  select * into v_grant from public.module_access_grants where id = p_grant_id and property_id = p_property_id;
  if v_grant.id is null then return false; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id))
     and not exists (select 1 from public.staff s where s.id = v_grant.staff_id and s.user_id = auth.uid()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.module_access_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant_id;
  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
  values (p_property_id, v_grant.staff_id, auth.uid(), 'manager_grant_revoked', v_grant.permission_code, 'revoked',
    jsonb_build_object('grant_id', p_grant_id));
  return true;
end;
$$;

-- Password path lives in the manager-authorize edge function (the password is
-- verified against Supabase Auth server-side there); this RPC records the
-- grant ONLY after that verification, and is called with the edge function's
-- verified manager identity passed through a short-lived, single-use ticket
-- so the browser can never fabricate an approval.
create table if not exists public.manager_authorization_tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  requester_staff_id uuid not null references public.staff(id) on delete cascade,
  manager_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Nullable: a property administrator who has no employee (staff) row may
  -- approve with their email/password. Coverage for that case is verified
  -- under the manager's own JWT inside the edge function; the ticket is
  -- single-use, service-role-written and expires in 90 seconds.
  manager_staff_id uuid references public.staff(id) on delete cascade,
  permission_code text not null,
  expires_at timestamptz not null default now() + interval '90 seconds',
  used_at timestamptz
);

alter table public.manager_authorization_tickets enable row level security;
revoke all on public.manager_authorization_tickets from public, anon, authenticated;
-- Written by the edge function's service role; consumed by the definer RPC.

create or replace function public.fn_redeem_manager_authorization_ticket(
  p_property_id uuid, p_ticket_id uuid, p_duration_minutes integer default 60, p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket public.manager_authorization_tickets;
  v_requester public.staff;
  v_grant public.module_access_grants;
  v_max_minutes integer;
  v_duration integer;
  v_config public.employee_licence_config;
begin
  if auth.uid() is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into v_ticket from public.manager_authorization_tickets
  where id = p_ticket_id and property_id = p_property_id
    and used_at is null and expires_at > now()
  for update;
  if v_ticket.id is null then
    raise exception 'Authorization ticket is invalid or expired. Ask the manager to approve again.' using errcode = '22023';
  end if;
  -- Only the session that started the request may redeem it.
  if v_ticket.requester_user_id <> auth.uid() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select * into v_requester from public.staff where id = v_ticket.requester_staff_id and is_active;
  if v_requester.id is null then
    raise exception 'Requesting employee is no longer active.';
  end if;

  -- The approving manager must hold the requested permission. When the ticket
  -- carries a manager employee identity, re-check it here as defense in
  -- depth; a NULL manager_staff_id means a property administrator approved
  -- via the password path, which the edge function verified under the
  -- manager's own JWT before writing this single-use ticket.
  if v_ticket.manager_staff_id is not null then
    if not public.fn_employee_has_permission(p_property_id, v_ticket.permission_code, v_ticket.manager_staff_id) then
      insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
      values (p_property_id, v_requester.id, auth.uid(), 'manager_authorization', v_ticket.permission_code, 'rejected',
        jsonb_build_object('reason', 'manager_not_authorized', 'manager_user_id', v_ticket.manager_user_id));
      raise exception 'The approving manager is not authorized to grant this permission.';
    end if;
  end if;

  update public.manager_authorization_tickets set used_at = now() where id = v_ticket.id;

  select * into v_config from public.employee_licence_config where plan_code = (
    select coalesce(lower(ps.plan_code), p.package::text)
    from public.properties p left join public.property_subscriptions ps on ps.property_id = p.id
    where p.id = p_property_id
  );
  v_max_minutes := coalesce(v_config.max_grant_minutes, 240);
  v_duration := least(greatest(coalesce(p_duration_minutes, 60), 5), v_max_minutes);

  update public.module_access_grants set revoked_at = now(), revoked_by = auth.uid()
  where property_id = p_property_id and staff_id = v_requester.id
    and permission_code = v_ticket.permission_code and revoked_at is null;

  insert into public.module_access_grants(
    property_id, staff_id, permission_code, granted_by_staff_id, granted_by_user_id, reason, expires_at
  )
  values (
    p_property_id, v_requester.id, v_ticket.permission_code, v_ticket.manager_staff_id, v_ticket.manager_user_id,
    p_reason, now() + make_interval(mins => v_duration)
  )
  returning * into v_grant;

  insert into public.employee_access_audit(property_id, staff_id, actor_user_id, action, permission_code, result, details)
  values (p_property_id, v_requester.id, auth.uid(), 'manager_authorization', v_ticket.permission_code, 'granted',
    jsonb_build_object('manager_user_id', v_ticket.manager_user_id, 'expires_at', v_grant.expires_at, 'duration_minutes', v_duration));

  return jsonb_build_object(
    'ok', true,
    'grant', jsonb_build_object('id', v_grant.id, 'permission_code', v_grant.permission_code, 'expires_at', v_grant.expires_at)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Licensing RPCs (purchase/cancel additional licences, overview)
-- ---------------------------------------------------------------------------

create or replace function public.fn_activate_employee_licence_addon(
  p_property_id uuid, p_quantity integer, p_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_state jsonb;
  v_price numeric;
  v_currency text;
  v_addon public.employee_licence_addons;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can purchase licences.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Licence quantity must be between 1 and 100.' using errcode = '22023';
  end if;

  v_state := public.fn_employee_licence_state(p_property_id);
  v_price := v_state->>'addon_monthly_price';
  v_currency := coalesce(v_state->>'addon_currency', 'KES');

  -- Additional employee pricing is configured by the platform owner. When it
  -- has not been configured yet, activation is refused rather than guessed.
  if v_price is null then
    raise exception 'Additional employee pricing has not been configured. Contact OliTechs support.';
  end if;

  insert into public.employee_licence_addons(property_id, request_id, quantity, monthly_price, currency, created_by)
  values (p_property_id, p_request_id, p_quantity, v_price * p_quantity, v_currency, auth.uid())
  on conflict (property_id, request_id) do nothing
  returning * into v_addon;

  if v_addon.id is null then
    -- Idempotent retry of the same request: return the existing add-on.
    select * into v_addon from public.employee_licence_addons
    where property_id = p_property_id and request_id = p_request_id;
  else
    insert into public.audit_logs(actor_id, action, property_id, new_value)
    values (auth.uid(), 'employee_licence_addon_activated', p_property_id,
      jsonb_build_object('addon_id', v_addon.id, 'quantity', v_addon.quantity, 'monthly_total', v_addon.monthly_price));
  end if;

  return jsonb_build_object(
    'ok', true,
    'addon', jsonb_build_object('id', v_addon.id, 'quantity', v_addon.quantity, 'monthly_price', v_addon.monthly_price, 'currency', v_addon.currency),
    'licence_state', public.fn_employee_licence_state(p_property_id)
  );
end;
$$;

create or replace function public.fn_cancel_employee_licence_addon(p_property_id uuid, p_addon_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_addon public.employee_licence_addons;
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can cancel licences.' using errcode = '42501';
  end if;
  select * into v_addon from public.employee_licence_addons
  where id = p_addon_id and property_id = p_property_id and status = 'active';
  if v_addon.id is null then raise exception 'Active licence add-on not found.'; end if;

  -- Cancelling must not strand registered employees above their allowance:
  -- the available-seat check still applies at next employee activation, and
  -- active employees already registered keep working (documented policy).
  update public.employee_licence_addons set status = 'cancelled', ended_at = now() where id = p_addon_id;

  insert into public.audit_logs(actor_id, action, property_id, old_value)
  values (auth.uid(), 'employee_licence_addon_cancelled', p_property_id,
    jsonb_build_object('addon_id', v_addon.id, 'quantity', v_addon.quantity));

  return jsonb_build_object('ok', true, 'licence_state', public.fn_employee_licence_state(p_property_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Reads used by the Employee Management UI
-- ---------------------------------------------------------------------------

create or replace function public.fn_list_employee_departments(p_property_id uuid)
returns setof public.employee_departments
language sql stable security definer set search_path = public
as $$
  select * from public.employee_departments where property_id = p_property_id order by name;
$$;

create or replace function public.fn_list_employee_roles(p_property_id uuid)
returns setof public.employee_roles
language sql stable security definer set search_path = public
as $$
  select * from public.employee_roles where property_id = p_property_id order by is_system desc, name;
$$;

create or replace function public.fn_list_employee_invitations(p_property_id uuid)
returns table(
  id uuid, email text, full_name text, staff_role text, status text,
  role_id uuid, department_id uuid, expires_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select id, email, full_name, staff_role, status, role_id, department_id, expires_at, created_at
  from public.employee_invitations
  where property_id = p_property_id
  order by created_at desc;
$$;

create or replace function public.fn_employee_permission_summary(p_property_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_codes text[]; v_workspaces text[]; v_grants jsonb;
begin
  v_codes := public.fn_employee_permission_codes(p_property_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'permission_code', g.permission_code, 'expires_at', g.expires_at,
    'granted_by', s.full_name)), '[]'::jsonb)
    into v_grants
  from public.module_access_grants g
  left join public.staff s on s.id = g.granted_by_staff_id
  where g.property_id = p_property_id
    and g.staff_id = coalesce(public.current_staff_id(p_property_id),
      (select id from public.staff where property_id = p_property_id and user_id = auth.uid() and is_active limit 1))
    and g.revoked_at is null and g.expires_at > now();

  v_workspaces := public.fn_employee_workspaces(p_property_id);

  return jsonb_build_object('codes', to_jsonb(v_codes), 'workspaces', to_jsonb(v_workspaces), 'active_grants', v_grants);
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Grants + PostgREST schema reload
-- ---------------------------------------------------------------------------

revoke all on function public.fn_employee_permission_codes(uuid,uuid) from public, anon;
revoke all on function public.fn_employee_has_permission(uuid,text,uuid) from public, anon;
revoke all on function public.fn_employee_workspaces(uuid) from public, anon;
revoke all on function public.fn_employee_licence_state(uuid) from public, anon;
revoke all on function public.fn_assert_licence_available(uuid) from public, anon;
revoke all on function public.fn_create_employee_with_licence(uuid,text,text,text,text,text[],text,uuid,uuid,text) from public, anon;
revoke all on function public.fn_set_employee_department(uuid,uuid) from public, anon;
revoke all on function public.fn_set_employee_role(uuid,uuid) from public, anon;
revoke all on function public.fn_set_employee_status(uuid,boolean,boolean) from public, anon;
revoke all on function public.fn_create_employee_invitation(uuid,text,text,text,text[],uuid,uuid) from public, anon;
revoke all on function public.fn_resend_employee_invitation(uuid) from public, anon;
revoke all on function public.fn_revoke_employee_invitation(uuid) from public, anon;
revoke all on function public.fn_accept_employee_invitation(text) from public, anon;
revoke all on function public.fn_set_manager_pin(uuid,uuid,text) from public, anon;
revoke all on function public.fn_clear_manager_pin(uuid,uuid) from public, anon;
revoke all on function public.fn_verify_manager_authorization(uuid,text,text,integer,text) from public, anon;
revoke all on function public.fn_revoke_manager_grant(uuid,uuid) from public, anon;
revoke all on function public.fn_redeem_manager_authorization_ticket(uuid,uuid,integer,text) from public, anon;
revoke all on function public.fn_activate_employee_licence_addon(uuid,integer,uuid) from public, anon;
revoke all on function public.fn_cancel_employee_licence_addon(uuid,uuid) from public, anon;
revoke all on function public.fn_list_employee_departments(uuid) from public, anon;
revoke all on function public.fn_list_employee_roles(uuid) from public, anon;
revoke all on function public.fn_list_employee_invitations(uuid) from public, anon;
revoke all on function public.fn_employee_permission_summary(uuid) from public, anon;
revoke all on function public.fn_validate_permission_codes(text[]) from public, anon;
revoke all on function public.fn_create_employee_department(uuid,text,text,text) from public, anon;
revoke all on function public.fn_update_employee_department(uuid,text,text,text) from public, anon;
revoke all on function public.fn_delete_employee_department(uuid) from public, anon;
revoke all on function public.fn_create_employee_role(uuid,text,text,text[],text) from public, anon;
revoke all on function public.fn_update_employee_role(uuid,text,text,text[],text) from public, anon;
revoke all on function public.fn_delete_employee_role(uuid) from public, anon;
revoke all on function public.fn_seed_employee_roles(uuid) from public, anon;

grant execute on function public.fn_employee_permission_codes(uuid,uuid) to authenticated;
grant execute on function public.fn_employee_has_permission(uuid,text,uuid) to authenticated;
grant execute on function public.fn_employee_workspaces(uuid) to authenticated;
grant execute on function public.fn_employee_licence_state(uuid) to authenticated;
grant execute on function public.fn_assert_licence_available(uuid) to authenticated;
grant execute on function public.fn_create_employee_with_licence(uuid,text,text,text,text,text[],text,uuid,uuid,text) to authenticated;
grant execute on function public.fn_set_employee_department(uuid,uuid) to authenticated;
grant execute on function public.fn_set_employee_role(uuid,uuid) to authenticated;
grant execute on function public.fn_set_employee_status(uuid,boolean,boolean) to authenticated;
grant execute on function public.fn_create_employee_invitation(uuid,text,text,text,text[],uuid,uuid) to authenticated;
grant execute on function public.fn_resend_employee_invitation(uuid) to authenticated;
grant execute on function public.fn_revoke_employee_invitation(uuid) to authenticated;
grant execute on function public.fn_accept_employee_invitation(text) to authenticated;
grant execute on function public.fn_set_manager_pin(uuid,uuid,text) to authenticated;
grant execute on function public.fn_clear_manager_pin(uuid,uuid) to authenticated;
grant execute on function public.fn_verify_manager_authorization(uuid,text,text,integer,text) to authenticated;
grant execute on function public.fn_revoke_manager_grant(uuid,uuid) to authenticated;
grant execute on function public.fn_redeem_manager_authorization_ticket(uuid,uuid,integer,text) to authenticated;
grant execute on function public.fn_activate_employee_licence_addon(uuid,integer,uuid) to authenticated;
grant execute on function public.fn_cancel_employee_licence_addon(uuid,uuid) to authenticated;
grant execute on function public.fn_list_employee_departments(uuid) to authenticated;
grant execute on function public.fn_list_employee_roles(uuid) to authenticated;
grant execute on function public.fn_list_employee_invitations(uuid) to authenticated;
grant execute on function public.fn_employee_permission_summary(uuid) to authenticated;
grant execute on function public.fn_create_employee_department(uuid,text,text,text) to authenticated;
grant execute on function public.fn_update_employee_department(uuid,text,text,text) to authenticated;
grant execute on function public.fn_delete_employee_department(uuid) to authenticated;
grant execute on function public.fn_create_employee_role(uuid,text,text,text[],text) to authenticated;
grant execute on function public.fn_update_employee_role(uuid,text,text,text[],text) to authenticated;
grant execute on function public.fn_delete_employee_role(uuid) to authenticated;

notify pgrst, 'reload schema';
