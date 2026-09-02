-- Server-side active PIN staff session. This mirrors the 30-minute browser
-- session so RLS can enforce the role of the staff member actually selected.
create table if not exists public.staff_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index if not exists staff_sessions_property_idx on public.staff_sessions(property_id);
alter table public.staff_sessions enable row level security;
-- No direct client policies: only security-definer functions manage sessions.

create or replace function public.current_staff_role(p_property_id uuid)
returns text
language sql security definer stable set search_path = public
as $$
  select s.role
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id
  where ss.user_id = auth.uid()
    and ss.property_id = p_property_id
    and s.is_active = true
    and ss.verified_at > now() - interval '30 minutes'
  limit 1;
$$;

create or replace function public.current_staff_id(p_property_id uuid)
returns uuid
language sql security definer stable set search_path = public
as $$
  select s.id
  from public.staff_sessions ss
  join public.staff s on s.id = ss.staff_id
  where ss.user_id = auth.uid()
    and ss.property_id = p_property_id
    and s.is_active = true
    and ss.verified_at > now() - interval '30 minutes'
  limit 1;
$$;

do $$
begin
  -- Refresh the existing verifier so every successful PIN also establishes
  -- the server-side active staff identity used by RLS.
  null;
end $$;

create or replace function public.verify_staff_pin(
  p_property_id uuid,
  p_module text,
  p_pin_hash text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare s public.staff;
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
  insert into public.staff_sessions(user_id,staff_id,property_id,verified_at)
    values(auth.uid(),s.id,s.property_id,now())
    on conflict (user_id) do update set staff_id=excluded.staff_id,property_id=excluded.property_id,verified_at=excluded.verified_at;
  insert into public.staff_logs(property_id, staff_id, staff_name, module, action)
    values(s.property_id, s.id, s.full_name, p_module, 'module_entry');
  return jsonb_build_object('ok', true, 'staff', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'email', s.email, 'role', s.role, 'assigned_modules', s.assigned_modules, 'avatar', s.avatar));
end;
$$;
grant execute on function public.verify_staff_pin(uuid,text,text) to authenticated;

create or replace function public.clear_active_staff_session()
returns boolean
language sql security definer set search_path = public
as $$
  delete from public.staff_sessions where user_id = auth.uid();
  select true;
$$;
grant execute on function public.clear_active_staff_session() to authenticated;
