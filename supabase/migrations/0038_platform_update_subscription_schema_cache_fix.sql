-- OliTechs PMS+POS — Subscription RPC schema-cache repair
-- 0038: ensure the platform subscription RPC exists with the exact
-- signature used by PostgREST/Supabase and reload the API schema cache.

create or replace function public.platform_update_subscription(
  p_property_id uuid,
  p_plan_code text,
  p_status text,
  p_trial_ends_at timestamptz default null,
  p_current_period_ends_at timestamptz default null,
  p_grace_ends_at timestamptz default null,
  p_enabled_modules text[] default '{}'
)
returns public.property_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.property_subscriptions;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage subscriptions.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.properties where id = p_property_id
  ) then
    raise exception 'Property not found.';
  end if;

  if p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'Invalid subscription status.';
  end if;

  insert into public.property_subscriptions(
    property_id,
    plan_code,
    status,
    trial_ends_at,
    current_period_ends_at,
    grace_ends_at,
    enabled_modules,
    updated_by
  )
  values(
    p_property_id,
    coalesce(nullif(trim(p_plan_code), ''), 'starter'),
    p_status,
    p_trial_ends_at,
    p_current_period_ends_at,
    p_grace_ends_at,
    coalesce(p_enabled_modules, '{}'),
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    trial_ends_at = excluded.trial_ends_at,
    current_period_ends_at = excluded.current_period_ends_at,
    grace_ends_at = excluded.grace_ends_at,
    enabled_modules = excluded.enabled_modules,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_subscription;

  insert into public.audit_logs(
    actor_id,
    action,
    property_id,
    new_value
  )
  values(
    auth.uid(),
    'property_subscription_updated',
    p_property_id,
    jsonb_build_object(
      'plan_code', v_subscription.plan_code,
      'status', v_subscription.status,
      'enabled_modules', v_subscription.enabled_modules
    )
  );

  return v_subscription;
end;
$$;

grant execute on function public.platform_update_subscription(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text[]
) to authenticated;

revoke execute on function public.platform_update_subscription(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text[]
) from anon, public;

notify pgrst, 'reload schema';
