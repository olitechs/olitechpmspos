-- OliTechs PMS+POS — Subscription access bootstrap/fix
-- 0035: ensure approved/packaged properties always have an active subscription
-- and prevent a missing legacy subscription row from locking an active workspace.

create or replace function public.fn_subscription_access(
  p_property_id uuid,
  p_module text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.property_subscriptions;
  p public.properties;
  allowed boolean := false;
  v_plan text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  if public.is_platform_owner() then
    return jsonb_build_object('allowed',true,'reason','platform_owner');
  end if;

  select * into p
  from public.properties
  where id = p_property_id;

  if not found then
    return jsonb_build_object('allowed',false,'reason','property_not_found');
  end if;

  -- An active property with a real package is entitled to its base workspace
  -- even if the subscription row was missing on an older installation.
  if p.status = 'active' and p.package <> 'none' then
    select * into s
    from public.property_subscriptions
    where property_id = p_property_id;

    if s.property_id is null then
      v_plan := case p.package
        when 'professional' then 'professional'
        when 'premium' then 'premium'
        when 'standard' then 'standard'
        else 'starter'
      end;

      insert into public.property_subscriptions(
        property_id, plan_code, status, enabled_modules, updated_by
      )
      values(
        p_property_id, v_plan, 'active', '{}', auth.uid()
      )
      on conflict(property_id) do nothing;

      select * into s
      from public.property_subscriptions
      where property_id = p_property_id;
    end if;
  else
    select * into s
    from public.property_subscriptions
    where property_id = p_property_id;
  end if;

  if s.property_id is null then
    return jsonb_build_object(
      'allowed',false,
      'reason','subscription_not_configured',
      'status',null,
      'plan_code',null
    );
  end if;

  allowed :=
    s.status in ('trial','active','past_due')
    and (s.current_period_ends_at is null or s.current_period_ends_at >= now())
    and (s.trial_ends_at is null or s.trial_ends_at >= now());

  if s.grace_ends_at is not null
     and s.grace_ends_at >= now()
     and s.status in ('past_due','suspended') then
    allowed := true;
  end if;

  if cardinality(coalesce(s.enabled_modules,'{}')) > 0
     and not (coalesce(p_module,'') = any(s.enabled_modules)) then
    allowed := false;
  end if;

  return jsonb_build_object(
    'allowed', allowed,
    'status', s.status,
    'plan_code', s.plan_code,
    'reason', case when allowed then 'active' else 'subscription_required' end,
    'period_ends_at', s.current_period_ends_at,
    'trial_ends_at', s.trial_ends_at
  );
end;
$$;

-- Repair every already-approved property that has a package but no
-- subscription record.
insert into public.property_subscriptions(
  property_id, plan_code, status, enabled_modules, updated_by
)
select
  p.id,
  case p.package
    when 'professional' then 'professional'
    when 'premium' then 'premium'
    when 'standard' then 'standard'
    else 'starter'
  end,
  'active',
  '{}',
  null
from public.properties p
left join public.property_subscriptions s on s.property_id = p.id
where p.status = 'active'
  and p.package <> 'none'
  and s.property_id is null
on conflict(property_id) do nothing;

-- Replace the legacy approval RPC so every future approval also provisions
-- the subscription record atomically.
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

  insert into public.property_subscriptions(
    property_id, plan_code, status, enabled_modules, updated_by
  )
  values(
    p_property_id,
    v_plan,
    'active',
    '{}',
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code = excluded.plan_code,
    status = 'active',
    trial_ends_at = null,
    current_period_ends_at = null,
    grace_ends_at = null,
    enabled_modules = '{}',
    updated_at = now(),
    updated_by = auth.uid();

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
      'subscription_status', 'active',
      'plan_code', v_plan
    )
  );

  return v_property;
end;
$$;

grant execute on function public.fn_subscription_access(uuid,text) to authenticated;
grant execute on function public.approve_property(uuid,public.property_package) to authenticated;

revoke execute on function public.fn_subscription_access(uuid,text) from anon, public;
revoke execute on function public.approve_property(uuid,public.property_package) from anon, public;

notify pgrst, 'reload schema';
