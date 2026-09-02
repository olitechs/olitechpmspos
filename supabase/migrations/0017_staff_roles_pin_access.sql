-- OliTechs PMS/POS v2 — staff roles, PIN module access and audit trail

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  role text not null,
  pin_hash text not null,
  assigned_modules text[] not null default '{}'::text[],
  is_active boolean not null default true,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  avatar text,
  last_login timestamptz,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_role_check check (role in (
    'super_admin','hotel_admin','front_office_manager','receptionist','front_desk',
    'pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor'
  )),
  constraint staff_pin_hash_check check (length(pin_hash) >= 32)
);
create index if not exists staff_property_idx on public.staff(property_id, is_active);
create unique index if not exists staff_property_email_idx on public.staff(property_id, lower(email)) where email is not null;

create table if not exists public.staff_logs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name text,
  module text not null,
  action text not null default 'module_entry',
  created_at timestamptz not null default now()
);
create index if not exists staff_logs_property_idx on public.staff_logs(property_id, created_at desc);

alter table public.staff enable row level security;
alter table public.staff_logs enable row level security;

create or replace function public.is_hotel_admin(p_property_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager');
$$;

-- Staff directory is visible to members for the PIN chooser, but the
-- credential column is deliberately not selectable by the authenticated role.
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert
  with check (public.is_hotel_admin(property_id) and created_by = auth.uid());
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update
  using (public.is_hotel_admin(property_id))
  with check (public.is_hotel_admin(property_id));
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete
  using (public.is_hotel_admin(property_id));

drop policy if exists staff_logs_select on public.staff_logs;
create policy staff_logs_select on public.staff_logs for select
  using (public.is_hotel_admin(property_id));
-- Entries are created by the security-definer verification function only.
-- No direct insert/update/delete policies are granted.

revoke select(pin_hash) on public.staff from anon, authenticated;
grant select(id, full_name, email, phone, role, assigned_modules, is_active, property_id, created_by, avatar, last_login, user_id, created_at, updated_at) on public.staff to authenticated;
grant update(pin_hash) on public.staff to authenticated;

create or replace function public.verify_staff_pin(
  p_property_id uuid,
  p_module text,
  p_pin_hash text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare s public.staff; v_user_id uuid;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'Not allowed.';
  end if;
  select * into s
  from public.staff
  where property_id = p_property_id
    and is_active = true
    and p_module = any(assigned_modules)
    and pin_hash = p_pin_hash
  limit 1;
  if s.id is null then
    return jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  end if;
  update public.staff set last_login = now(), updated_at = now() where id = s.id;
  insert into public.staff_logs(property_id, staff_id, staff_name, module, action)
    values(s.property_id, s.id, s.full_name, p_module, 'module_entry');
  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'email', s.email, 'role', s.role, 'assigned_modules', s.assigned_modules, 'avatar', s.avatar)
  );
end;
$$;
grant execute on function public.verify_staff_pin(uuid,text,text) to authenticated;

create or replace function public.reset_staff_pin(p_staff_id uuid, p_pin_hash text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_property uuid;
begin
  select property_id into v_property from public.staff where id = p_staff_id;
  if v_property is null or not public.is_hotel_admin(v_property) then raise exception 'Not allowed.'; end if;
  if length(p_pin_hash) < 32 then raise exception 'Invalid PIN hash.'; end if;
  update public.staff set pin_hash = p_pin_hash, updated_at = now() where id = p_staff_id;
  return true;
end;
$$;
grant execute on function public.reset_staff_pin(uuid,text) to authenticated;

create or replace function public.create_staff_member(
  p_property_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role text,
  p_assigned_modules text[],
  p_pin_hash text,
  p_avatar text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare s public.staff; v_user_id uuid;
begin
  if not public.is_hotel_admin(p_property_id) then raise exception 'Only a Hotel Admin can create staff.'; end if;
  if p_role not in ('super_admin','hotel_admin','front_office_manager','receptionist','front_desk','pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor') then raise exception 'Invalid staff role.'; end if;
  if length(p_pin_hash) < 32 then raise exception 'Invalid PIN hash.'; end if;
  select id into v_user_id from public.profiles where lower(email) = lower(nullif(trim(p_email),'')) limit 1;
  v_user_id := coalesce(p_user_id, v_user_id);
  insert into public.staff(full_name,email,phone,role,assigned_modules,pin_hash,is_active,property_id,created_by,avatar,user_id)
    values(trim(p_full_name), nullif(trim(p_email),''), nullif(trim(p_phone),''), p_role, coalesce(p_assigned_modules,'{}'), p_pin_hash, true, p_property_id, auth.uid(), p_avatar, v_user_id)
    returning * into s;
  return jsonb_build_object('id',s.id,'full_name',s.full_name,'email',s.email,'phone',s.phone,'role',s.role,'assigned_modules',s.assigned_modules,'is_active',s.is_active,'property_id',s.property_id,'avatar',s.avatar,'last_login',s.last_login);
end;
$$;
grant execute on function public.create_staff_member(uuid,text,text,text,text,text[],text,text,uuid) to authenticated;

create or replace function public.touch_staff_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists staff_touch on public.staff;
create trigger staff_touch before update on public.staff for each row execute function public.touch_staff_updated_at();
