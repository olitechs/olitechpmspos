-- Property-scoped POS access PINs. Hashes are never readable through the client API.
create table if not exists public.pos_access_credentials (
  property_id uuid primary key references public.properties(id) on delete cascade,
  pin_hash text not null,
  is_default boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_access_pin_attempts (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

alter table public.pos_access_credentials enable row level security;
alter table public.pos_access_pin_attempts enable row level security;
revoke all on table public.pos_access_credentials from public, anon, authenticated;
revoke all on table public.pos_access_pin_attempts from public, anon, authenticated;

insert into public.pos_access_credentials(property_id, pin_hash, is_default)
select p.id, extensions.crypt('1234', extensions.gen_salt('bf', 12)), true
from public.properties p
on conflict (property_id) do nothing;

create or replace function public.fn_seed_property_pos_access_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.pos_access_credentials(property_id, pin_hash, is_default)
  values (new.id, extensions.crypt('1234', extensions.gen_salt('bf', 12)), true)
  on conflict (property_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_property_pos_access_pin on public.properties;
create trigger trg_seed_property_pos_access_pin
after insert on public.properties
for each row execute function public.fn_seed_property_pos_access_pin();

create or replace function public.fn_verify_pos_access_pin(p_property_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_credential public.pos_access_credentials;
  v_attempt public.pos_access_pin_attempts;
  v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  delete from public.pos_access_pin_attempts
  where property_id = p_property_id
    and user_id = auth.uid()
    and locked_until is not null
    and locked_until <= now();

  select * into v_attempt
  from public.pos_access_pin_attempts
  where property_id = p_property_id and user_id = auth.uid()
  for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object('ok', false, 'locked_until', v_attempt.locked_until,
      'message', 'Too many incorrect PIN attempts. Try again after the lock expires.');
  end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  if v_credential.property_id is null then
    raise exception 'POS access PIN is not configured. Ask the property administrator.';
  end if;

  if p_pin ~ '^[0-9]{4}$' then
    v_ok := extensions.crypt(p_pin, v_credential.pin_hash) = v_credential.pin_hash;
  end if;

  if v_ok then
    delete from public.pos_access_pin_attempts
    where property_id = p_property_id and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'is_default', v_credential.is_default);
  end if;

  insert into public.pos_access_pin_attempts(property_id, user_id, failed_attempts, locked_until, updated_at)
  values (p_property_id, auth.uid(), 1, null, now())
  on conflict (property_id, user_id) do update
  set failed_attempts = least(public.pos_access_pin_attempts.failed_attempts + 1, 5),
      locked_until = case
        when public.pos_access_pin_attempts.failed_attempts + 1 >= 5
          then now() + interval '15 minutes'
        else null
      end,
      updated_at = now()
  returning * into v_attempt;

  return jsonb_build_object(
    'ok', false,
    'attempts_remaining', greatest(0, 5 - v_attempt.failed_attempts),
    'locked_until', v_attempt.locked_until,
    'message', case when v_attempt.locked_until is not null
      then 'Too many incorrect PIN attempts. Try again in 15 minutes.'
      else 'Incorrect POS PIN. Try again.' end
  );
end;
$$;

create or replace function public.fn_pos_access_pin_status(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_credential public.pos_access_credentials;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
        and lower(coalesce(s.role, '')) in ('hotel_admin', 'super_admin')
    )
  ) then raise exception 'Only the property owner or administrator can manage the POS PIN.'; end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  return jsonb_build_object(
    'configured', v_credential.property_id is not null,
    'is_default', coalesce(v_credential.is_default, true),
    'updated_at', v_credential.updated_at
  );
end;
$$;

create or replace function public.fn_reset_pos_access_pin(p_property_id uuid, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
  ) then raise exception 'Only the property owner or administrator can reset the POS PIN.'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'POS PIN must contain exactly four digits.';
  end if;
  if p_new_pin = '1234' then
    raise exception 'Choose a PIN different from the initial default 1234.';
  end if;

  insert into public.pos_access_credentials(property_id, pin_hash, is_default, updated_by, updated_at)
  values (p_property_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 12)), false, auth.uid(), now())
  on conflict (property_id) do update
  set pin_hash = excluded.pin_hash,
      is_default = false,
      updated_by = auth.uid(),
      updated_at = now();

  delete from public.pos_access_pin_attempts where property_id = p_property_id;
  return jsonb_build_object('ok', true, 'is_default', false);
end;
$$;

revoke all on function public.fn_verify_pos_access_pin(uuid, text) from public, anon;
revoke all on function public.fn_pos_access_pin_status(uuid) from public, anon;
revoke all on function public.fn_reset_pos_access_pin(uuid, text) from public, anon;
grant execute on function public.fn_verify_pos_access_pin(uuid, text) to authenticated;
grant execute on function public.fn_pos_access_pin_status(uuid) to authenticated;
grant execute on function public.fn_reset_pos_access_pin(uuid, text) to authenticated;
