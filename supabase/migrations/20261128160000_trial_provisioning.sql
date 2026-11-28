-- OliTechs PMS+POS — 7-day Professional trial provisioning
--
-- Forward-only correction. Applied migration history is immutable, so this
-- migration redefines approve_property instead of editing 0035.
--
-- Behaviour change: a newly approved property starts on a 7-day Professional
-- trial (no card required) instead of an open-ended active period. Expiry is
-- computed live by fn_property_entitlement, so no cron and no status mutation
-- job are required.
--
-- Deliberately preserved:
--   * a paid period that is still valid (active/past_due with a future
--     current_period_ends_at) — re-approval must never reset paid time;
--   * an existing unexpired trial;
--   * enabled module overrides.
--
-- Deliberately reset:
--   * cancelled/suspended/expired rows — an approval is the unlock action, so
--     those rows receive a fresh trial rather than staying locked.
--
-- No parallel subscriptions table is introduced: property_subscriptions stays
-- the single billing source and fn_property_entitlement stays the authority.

create or replace function public.approve_property(
  p_property_id uuid,
  p_package public.property_package
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
  v_old_status public.property_status;
  v_old_package public.property_package;
  v_plan text;
  v_sub public.property_subscriptions;
  v_preserve boolean := false;
  v_trial_ends_at timestamptz;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can approve properties.' using errcode = '42501';
  end if;

  if p_package is null or p_package = 'none' then
    raise exception 'An active property must have a package.' using errcode = '22023';
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.' using errcode = 'P0002';
  end if;

  v_old_status := v_property.status;
  v_old_package := v_property.package;

  update public.properties
  set status = 'active',
      package = p_package,
      updated_at = now()
  where id = p_property_id
  returning * into v_property;

  v_plan := case p_package
    when 'professional' then 'professional'
    when 'premium' then 'premium'
    when 'standard' then 'standard'
    else 'starter'
  end;

  select * into v_sub
  from public.property_subscriptions
  where property_id = p_property_id
  for update;

  if found then
    v_preserve :=
      (v_sub.status in ('active', 'past_due')
        and v_sub.current_period_ends_at is not null
        and v_sub.current_period_ends_at >= now())
      or (v_sub.status = 'trial'
        and v_sub.trial_ends_at is not null
        and v_sub.trial_ends_at >= now());
  end if;

  v_trial_ends_at := now() + interval '7 days';

  if v_preserve then
    -- Keep the live paid/trial period, dates, grace and modules untouched.
    -- Only the assigned plan follows the approved package.
    update public.property_subscriptions
    set plan_code = v_plan,
        updated_at = now(),
        updated_by = auth.uid()
    where property_id = p_property_id;
  else
    insert into public.property_subscriptions(
      property_id, plan_code, status, trial_ends_at,
      current_period_ends_at, grace_ends_at, enabled_modules, updated_by
    )
    values(
      p_property_id,
      v_plan,
      'trial',
      v_trial_ends_at,
      null,
      null,
      '{}',
      auth.uid()
    )
    on conflict(property_id) do update set
      plan_code = excluded.plan_code,
      status = 'trial',
      trial_ends_at = excluded.trial_ends_at,
      current_period_ends_at = null,
      grace_ends_at = null,
      enabled_modules = case
        when coalesce(array_length(property_subscriptions.enabled_modules, 1), 0) = 0 then '{}'
        else property_subscriptions.enabled_modules
      end,
      updated_at = now(),
      updated_by = auth.uid();
  end if;

  insert into public.audit_logs(
    actor_id, action, property_id, old_value, new_value
  )
  values(
    auth.uid(),
    'property_approved',
    v_property.id,
    jsonb_build_object(
      'status', v_old_status,
      'package', v_old_package
    ),
    jsonb_build_object(
      'status', 'active',
      'package', p_package,
      'subscription_status', case when v_preserve then v_sub.status else 'trial' end,
      'plan_code', v_plan,
      'trial_ends_at', case when v_preserve then v_sub.trial_ends_at else v_trial_ends_at end,
      'preserved_existing_period', v_preserve
    )
  );

  return v_property;
end;
$$;

grant execute on function public.approve_property(uuid, public.property_package) to authenticated;
revoke execute on function public.approve_property(uuid, public.property_package) from anon, public;

notify pgrst, 'reload schema';
