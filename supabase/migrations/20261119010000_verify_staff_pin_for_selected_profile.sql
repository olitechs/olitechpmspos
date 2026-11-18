-- Verify the PIN against the staff profile explicitly selected in the login UI.
-- The legacy verifier remains available for manager-authorisation prompts that
-- intentionally accept any authorised manager PIN. Workspace login must use
-- this selected-profile verifier to prevent duplicate PINs resolving to another
-- employee and to ensure the displayed identity matches the server session.
-- Apply in staging and run PIN regression tests before production promotion.

begin;

create or replace function public.verify_staff_pin_for_staff(
  p_property_id uuid,
  p_module text,
  p_pin_hash text,
  p_staff_id uuid
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

  if p_property_id is null
     or p_module is null
     or btrim(p_module) = ''
     or p_pin_hash is null
     or p_staff_id is null then
    raise exception 'Invalid PIN verification request.' using errcode = '22023';
  end if;

  if not public.is_member_of_property(p_property_id)
     and not public.is_platform_owner() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  -- Lock the existing attempt row before checking lockout. INSERT ... ON
  -- CONFLICT below serializes first-attempt races on the same user/property.
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
     and id = p_staff_id
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

grant execute on function public.verify_staff_pin_for_staff(uuid, text, text, uuid) to authenticated;
revoke execute on function public.verify_staff_pin(uuid, text, text) from anon, public;

grant execute on function public.verify_staff_pin_for_staff(uuid, text, text, uuid) to authenticated;
revoke execute on function public.verify_staff_pin_for_staff(uuid, text, text, uuid) from anon, public;

notify pgrst, 'reload schema';
commit;
