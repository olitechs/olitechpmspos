-- OliTechs PMS+POS — staff PIN hardening
--
-- REVIEW IN STAGING FIRST. This replaces public.verify_staff_pin(uuid,text,text)
-- as defined in 0020_active_staff_server_session.sql. Do not apply to production
-- until the staging PIN flow and release checks pass.
--
-- REQUIRED PRE-APPLY CHECK (run against the target database before applying):
--   select has_column_privilege(
--     'authenticated', 'public.staff', 'pin_hash', 'select'
--   );
-- true means the authenticated role can currently read pin_hash. Record the
-- result with the release evidence; this check is diagnostic, not a substitute
-- for reviewing effective grants and testing the API.
--
-- 1. Five failed attempts in a rolling 10-minute window lock the (auth user,
--    property) pair for 5 minutes. On a shared terminal this pauses PIN entry
--    for that signed-in user/property pair, not every user at the property.
-- 2. Failed attempts are logged to staff_logs with action = 'wrong_pin'.
-- 3. Remove table-level and column-level pin_hash SELECT grants, then restore
--    authenticated SELECT only for the other current staff columns.
--
-- NOT fixed here: PINs remain unsalted client-side SHA-256 hashes. Throttling
-- slows online guessing but does not protect a leaked hash. Prefer a follow-up
-- design that performs PIN hashing and verification server-side with pgcrypto.

begin;

create table if not exists public.staff_pin_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  primary key (user_id, property_id)
);

alter table public.staff_pin_attempts enable row level security;
revoke all on public.staff_pin_attempts from public, anon, authenticated;
-- No policies: only the security-definer verifier below touches this table.

create or replace function public.verify_staff_pin(
  p_property_id uuid,
  p_module text,
  p_pin_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.staff;
  a public.staff_pin_attempts;
  v_locked timestamptz;
  c_max constant integer := 5;
  c_window constant interval := interval '10 minutes';
  c_lock constant interval := interval '5 minutes';
begin
  if auth.uid() is null then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  if not public.is_member_of_property(p_property_id)
     and not public.is_platform_owner() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  -- Serialize attempts when an attempt row already exists. The subsequent
  -- INSERT ... ON CONFLICT update remains atomic for first-attempt races.
  select *
    into a
    from public.staff_pin_attempts
   where user_id = auth.uid()
     and property_id = p_property_id
   for update;

  if found and a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'retry_after_seconds',
      ceil(extract(epoch from (a.locked_until - now())))::integer
    );
  end if;

  select *
    into s
    from public.staff
   where property_id = p_property_id
     and is_active = true
     and p_module = any(assigned_modules)
     and pin_hash = p_pin_hash
   limit 1;

  if s.id is null then
    insert into public.staff_pin_attempts (
      user_id, property_id, failed_count, window_started_at, locked_until
    )
    values (auth.uid(), p_property_id, 1, now(), null)
    on conflict (user_id, property_id) do update
      set failed_count = case
            when public.staff_pin_attempts.window_started_at < now() - c_window
              or (public.staff_pin_attempts.locked_until is not null
                  and public.staff_pin_attempts.locked_until <= now())
            then 1
            else public.staff_pin_attempts.failed_count + 1
          end,
          window_started_at = case
            when public.staff_pin_attempts.window_started_at < now() - c_window
              or (public.staff_pin_attempts.locked_until is not null
                  and public.staff_pin_attempts.locked_until <= now())
            then now()
            else public.staff_pin_attempts.window_started_at
          end,
          locked_until = null;

    update public.staff_pin_attempts
       set locked_until = now() + c_lock
     where user_id = auth.uid()
       and property_id = p_property_id
       and failed_count >= c_max
    returning locked_until into v_locked;

    insert into public.staff_logs (
      property_id, staff_id, staff_name, module, action
    )
    values (p_property_id, null, null, p_module, 'wrong_pin');

    if v_locked is not null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'locked',
        'retry_after_seconds',
        ceil(extract(epoch from (v_locked - now())))::integer
      );
    end if;

    return jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  end if;

  delete from public.staff_pin_attempts
   where user_id = auth.uid()
     and property_id = p_property_id;

  update public.staff
     set last_login = now(),
         updated_at = now()
   where id = s.id;

  insert into public.staff_sessions (user_id, staff_id, property_id, verified_at)
  values (auth.uid(), s.id, s.property_id, now())
  on conflict (user_id) do update
    set staff_id = excluded.staff_id,
        property_id = excluded.property_id,
        verified_at = excluded.verified_at;

  insert into public.staff_logs (
    property_id, staff_id, staff_name, module, action
  )
  values (s.property_id, s.id, s.full_name, p_module, 'module_entry');

  return jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', s.id,
      'full_name', s.full_name,
      'email', s.email,
      'role', s.role,
      'assigned_modules', s.assigned_modules,
      'avatar', s.avatar
    )
  );
end;
$$;

grant execute on function public.verify_staff_pin(uuid, text, text) to authenticated;
revoke execute on function public.verify_staff_pin(uuid, text, text) from anon, public;

-- Remove both table-wide and any legacy column-specific SELECT grants on the
-- sensitive hash column. Then restore reads for all other current columns.
revoke select (pin_hash) on public.staff from public, anon, authenticated;
revoke select on public.staff from public, anon, authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'staff'
     and column_name <> 'pin_hash';

  if cols is null then
    raise exception 'Could not determine public.staff columns; refusing to change grants.';
  end if;

  execute format(
    'grant select (%s) on public.staff to authenticated',
    cols
  );
end
$$;

notify pgrst, 'reload schema';

commit;

-- Regression checks in a disposable Supabase staging project:
-- A. No auth user can call the verifier without a property membership (unless
--    they are a platform owner); unauthenticated calls are rejected.
-- B. Four wrong PINs return reason=wrong_pin; the fifth returns reason=locked.
-- C. Further attempts during lockout do not extend or bypass the lock.
-- D. Lockout expires after five minutes; the 10-minute failure window resets.
-- E. A successful PIN clears that user's attempts for that property and still
--    creates/refreshes staff_sessions, updates last_login, and writes module_entry.
-- F. Failed attempts write wrong_pin logs without disclosing staff identities.
-- G. User/property pairs are isolated; one user locked out does not lock out
--    another auth user at the same property.
-- H. PIN verification remains limited to active staff assigned to p_module.
-- I. authenticated cannot SELECT staff.pin_hash through PostgREST or SQL, while
--    normal non-sensitive staff fields used by the app remain readable.
-- J. Existing POS login/logout, module access, and staff audit logs regressions
--    pass before promotion.
