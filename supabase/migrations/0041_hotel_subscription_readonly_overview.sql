-- OliTechs PMS+POS — hotel-side subscription visibility and authority
-- 0041: make subscription management platform-owned and expose a read-only
-- property subscription overview to every assigned property member.

create or replace function public.fn_upsert_subscription(
  p_property_id uuid,p_plan_code text,p_status text,
  p_trial_ends_at timestamptz,p_current_period_ends_at timestamptz,
  p_grace_ends_at timestamptz,p_enabled_modules text[]
)
returns public.property_subscriptions
language plpgsql security definer set search_path=public
as $$
declare v public.property_subscriptions;
begin
  if not public.is_platform_owner() then
    raise exception 'Subscription changes are controlled by the OliTechs Platform Admin.'
      using errcode = '42501';
  end if;
  if p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'Invalid subscription status';
  end if;
  insert into public.property_subscriptions(
    property_id,plan_code,status,trial_ends_at,current_period_ends_at,
    grace_ends_at,enabled_modules,updated_by
  )
  values(
    p_property_id,coalesce(nullif(p_plan_code,''),'starter'),p_status,
    p_trial_ends_at,p_current_period_ends_at,p_grace_ends_at,
    coalesce(p_enabled_modules,'{}'),auth.uid()
  )
  on conflict(property_id) do update set
    plan_code=excluded.plan_code,status=excluded.status,
    trial_ends_at=excluded.trial_ends_at,
    current_period_ends_at=excluded.current_period_ends_at,
    grace_ends_at=excluded.grace_ends_at,
    enabled_modules=excluded.enabled_modules,
    updated_at=now(),updated_by=auth.uid()
  returning * into v;
  return v;
end;
$$;

grant execute on function public.fn_upsert_subscription(
  uuid,text,text,timestamptz,timestamptz,timestamptz,text[]
) to authenticated;
revoke execute on function public.fn_upsert_subscription(
  uuid,text,text,timestamptz,timestamptz,timestamptz,text[]
) from anon, public;

create or replace function public.fn_get_my_subscription_overview()
returns table(
  property_id uuid,property_name text,business_name text,
  property_status public.property_status,property_package public.property_package,
  property_role text,plan_code text,subscription_status text,
  trial_ends_at timestamptz,current_period_ends_at timestamptz,
  grace_ends_at timestamptz,enabled_modules text[],room_count bigint,
  room_limit text,user_count bigint,user_limit text
)
language sql security definer set search_path=public stable
as $$
  select
    p.id,p.name,p.business_name,p.status,p.package,pu.role::text,
    coalesce(ps.plan_code,case p.package::text
      when 'professional' then 'professional'
      when 'premium' then 'premium'
      when 'standard' then 'standard'
      else 'starter' end),
    coalesce(ps.status,case p.status::text
      when 'active' then 'active'
      when 'suspended' then 'suspended'
      when 'rejected' then 'cancelled'
      else 'trial' end),
    ps.trial_ends_at,ps.current_period_ends_at,ps.grace_ends_at,
    coalesce(ps.enabled_modules,'{}'::text[]),
    (select count(*) from public.rooms r where r.property_id=p.id),
    case lower(coalesce(ps.plan_code,p.package::text))
      when 'starter' then '5' when 'standard' then '5'
      when 'professional' then '50' when 'premium' then '50'
      when 'enterprise' then 'Unlimited' else 'Not configured' end,
    (select count(*) from public.property_users pu2 where pu2.property_id=p.id),
    case lower(coalesce(ps.plan_code,p.package::text))
      when 'starter' then '1' when 'standard' then '1'
      when 'professional' then '10' when 'premium' then '10'
      when 'enterprise' then 'Unlimited' else 'Not configured' end
  from public.property_users pu
  join public.properties p on p.id=pu.property_id
  left join public.property_subscriptions ps on ps.property_id=p.id
  where pu.user_id=auth.uid()
  order by case when pu.role='owner' then 0 when pu.role='admin' then 1 else 2 end,
           p.created_at desc
  limit 1;
$$;

grant execute on function public.fn_get_my_subscription_overview() to authenticated;
revoke execute on function public.fn_get_my_subscription_overview() from anon, public;

notify pgrst,'reload schema';
