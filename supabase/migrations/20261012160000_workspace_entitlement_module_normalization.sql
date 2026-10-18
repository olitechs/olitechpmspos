-- Normalize individual screen ids to the workspace-level subscription keys used by
-- Platform Admin package assignments. Preserve package-derived entitlements and the
-- dashboard landing-workspace exception from the existing production function.
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
  v_entitlement_module text;
  v_enabled_modules text[];
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
    values(p_property_id,v_plan,'active',public.platform_package_modules(p.package),auth.uid())
    on conflict(property_id) do nothing;

    select * into s from public.property_subscriptions where property_id=p_property_id;
  end if;

  if s.property_id is null then
    return jsonb_build_object(
      'allowed',false,'reason','subscription_not_configured',
      'status',null,'plan_code',null
    );
  end if;

  -- Preserve the production rule: active property + assigned package + active
  -- subscription is authoritative; trial/grace rules remain unchanged.
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

  -- Translate screen-level IDs to the canonical package entitlement keys.
  v_entitlement_module := case lower(trim(coalesce(p_module,'')))
    when 'frontoffice' then 'frontoffice'
    when 'front_office' then 'frontoffice'
    when 'pms' then 'frontoffice'
    when 'rooms' then 'frontoffice'
    when 'room-planner' then 'frontoffice'
    when 'room_planner' then 'frontoffice'
    when 'reservations' then 'frontoffice'
    when 'guests' then 'frontoffice'
    when 'folio' then 'frontoffice'
    when 'housekeeping' then 'frontoffice'
    when 'night-audit' then 'frontoffice'
    when 'night_audit' then 'frontoffice'
    when 'maintenance' then 'frontoffice'
    when 'laundry' then 'frontoffice'
    when 'pos' then 'pos'
    when 'cashier' then 'pos'
    when 'backoffice' then 'backoffice'
    when 'back_office' then 'backoffice'
    when 'reports' then 'backoffice'
    when 'booking-engine' then 'backoffice'
    when 'booking_engine' then 'backoffice'
    when 'settings' then 'backoffice'
    when 'employees' then 'backoffice'
    when 'customers' then 'backoffice'
    when 'store' then 'store'
    when 'stores' then 'store'
    when 'inventory' then 'store'
    when 'purchasing' then 'store'
    when 'recipes' then 'store'
    when 'transfers' then 'store'
    when 'channels' then 'store'
    when 'kitchen' then 'store'
    when 'kds' then 'store'
    when 'printers' then 'store'
    when 'pos-devices' then 'store'
    when 'pos_devices' then 'store'
    else lower(trim(coalesce(p_module,'')))
  end;

  -- Dashboard is a non-billable landing workspace, as in the existing production
  -- implementation. Unknown module keys remain denied rather than failing open.
  if allowed and v_entitlement_module='dashboard' then
    allowed:=true;
  elsif allowed and v_entitlement_module not in ('frontoffice','pos','backoffice','store') then
    allowed:=false;
  end if;

  -- A blank legacy allowlist follows the assigned package. Non-empty lists remain
  -- enforced, but legacy screen/workspace aliases are normalized before comparison.
  v_enabled_modules := coalesce(nullif(s.enabled_modules,'{}'::text[]), public.platform_package_modules(p.package));

  if allowed and v_entitlement_module <> 'dashboard'
     and not exists (
       select 1
       from unnest(coalesce(v_enabled_modules,'{}'::text[])) as enabled(module)
       where case lower(trim(enabled.module))
         when 'front_office' then 'frontoffice'
         when 'pms' then 'frontoffice'
         when 'rooms' then 'frontoffice'
         when 'room-planner' then 'frontoffice'
         when 'room_planner' then 'frontoffice'
         when 'reservations' then 'frontoffice'
         when 'guests' then 'frontoffice'
         when 'folio' then 'frontoffice'
         when 'housekeeping' then 'frontoffice'
         when 'night-audit' then 'frontoffice'
         when 'night_audit' then 'frontoffice'
         when 'maintenance' then 'frontoffice'
         when 'laundry' then 'frontoffice'
         when 'cashier' then 'pos'
         when 'back_office' then 'backoffice'
         when 'reports' then 'backoffice'
         when 'booking-engine' then 'backoffice'
         when 'booking_engine' then 'backoffice'
         when 'settings' then 'backoffice'
         when 'employees' then 'backoffice'
         when 'customers' then 'backoffice'
         when 'stores' then 'store'
         when 'inventory' then 'store'
         when 'purchasing' then 'store'
         when 'recipes' then 'store'
         when 'transfers' then 'store'
         when 'channels' then 'store'
         when 'kitchen' then 'store'
         when 'kds' then 'store'
         when 'printers' then 'store'
         when 'pos-devices' then 'store'
         when 'pos_devices' then 'store'
         else lower(trim(enabled.module))
       end = v_entitlement_module
     ) then
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
