-- OliTechs PMS+POS — active property access repair
-- 0042: keep workspace access aligned with the Platform Admin's active
-- property state. An active, packaged property must not be blocked by stale
-- legacy billing dates; billing dates remain informational until the platform
-- explicitly changes the subscription status.

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

  select * into p from public.properties where id=p_property_id;
  if not found then
    return jsonb_build_object('allowed',false,'reason','property_not_found');
  end if;

  select * into s from public.property_subscriptions where property_id=p_property_id;

  if s.property_id is null and p.status='active' and p.package<>'none' then
    v_plan:=case p.package
      when 'professional' then 'professional'
      when 'premium' then 'premium'
      when 'standard' then 'standard'
      else 'starter'
    end;

    insert into public.property_subscriptions(
      property_id,plan_code,status,enabled_modules,updated_by
    )
    values(p_property_id,v_plan,'active','{}',auth.uid())
    on conflict(property_id) do nothing;

    select * into s from public.property_subscriptions where property_id=p_property_id;
  end if;

  if s.property_id is null then
    return jsonb_build_object(
      'allowed',false,'reason','subscription_not_configured',
      'status',null,'plan_code',null
    );
  end if;

  -- Platform Admin's active property/package state is authoritative for
  -- workspace availability. Do not let stale legacy billing dates lock it.
  if p.status='active' and p.package<>'none' and s.status='active' then
    allowed:=true;
  elsif s.status='trial' then
    allowed:=(s.trial_ends_at is null or s.trial_ends_at>=now());
  elsif s.status='past_due' then
    allowed:=(s.current_period_ends_at is null or s.current_period_ends_at>=now())
      or (s.grace_ends_at is not null and s.grace_ends_at>=now());
  elsif s.status='suspended' then
    allowed:=s.grace_ends_at is not null and s.grace_ends_at>=now();
  else
    allowed:=false;
  end if;

  if allowed and cardinality(coalesce(s.enabled_modules,'{}'))>0
     and not(coalesce(p_module,'')=any(s.enabled_modules)) then
    allowed:=false;
  end if;

  return jsonb_build_object(
    'allowed',allowed,
    'status',s.status,
    'plan_code',s.plan_code,
    'reason',case when allowed then 'active' else 'subscription_required' end,
    'period_ends_at',s.current_period_ends_at,
    'trial_ends_at',s.trial_ends_at
  );
end;
$$;

grant execute on function public.fn_subscription_access(uuid,text) to authenticated;
revoke execute on function public.fn_subscription_access(uuid,text) from anon, public;

notify pgrst,'reload schema';
