-- Already APPLIED to Supabase project mszogmazldxjsiytrlxr (OliTechs PMS+POS).
-- Kept here so the repo's version control matches the live database. Do NOT re-run on production.

-- 1. Stop creating a well-known default PIN for every new property.
--    Owners/admins set their own PIN via fn_reset_pos_access_pin.
drop trigger if exists trg_seed_property_pos_access_pin on public.properties;

-- 2. fn_verify_pos_access_pin: additive 'must_change' flag so clients can force a change.
create or replace function public.fn_verify_pos_access_pin(p_property_id uuid, p_pin text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_credential public.pos_access_credentials;
  v_attempt public.pos_access_pin_attempts;
  v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff', 'fb_manager', 'receptionist', 'front_desk')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
    )
  ) then raise exception 'POS module access required.'; end if;

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
    return jsonb_build_object('ok', true, 'is_default', v_credential.is_default, 'must_change', v_credential.is_default);
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
$function$;

-- 3. fn_reset_pos_access_pin: also reject trivially guessable PINs.
create or replace function public.fn_reset_pos_access_pin(p_property_id uuid, p_new_pin text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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
  ) then raise exception 'Only the property owner or administrator can reset the POS PIN.'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'POS PIN must contain exactly four digits.';
  end if;
  if p_new_pin = '1234' then
    raise exception 'Choose a PIN different from the initial default 1234.';
  end if;
  if p_new_pin ~ '^([0-9])\1{3}$'
     or p_new_pin in ('0123','2345','3456','4567','5678','6789','3210','4321','5432','6543','7654','8765','9876') then
    raise exception 'Choose a PIN that is not a repeated or sequential number.';
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
$function$;
