-- Forward-compatible subscription expiry enforcement for the existing production schema.

BEGIN;

ALTER TABLE public.property_subscriptions ADD COLUMN IF NOT EXISTS manual_extension_until timestamptz;

create or replace function public.fn_property_entitlement(p_property_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.properties;
  s public.property_subscriptions;
  v_effective_end timestamptz;
  v_grace_end timestamptz;
  v_seconds bigint;
  v_seconds_of_grace bigint;
  v_missing_expiry boolean := false;
  v_grace_invalid boolean := false;
  v_state text;
  v_allowed boolean := false;
  v_plan_code text;
begin
  -- Resolve the caller's own property when none was supplied.
  if p_property_id is null then
    select pu.property_id into p_property_id
    from public.property_users pu
    where pu.user_id = auth.uid()
    order by case when pu.role = 'owner' then 0 when pu.role = 'admin' then 1 else 2 end,
             pu.property_id
    limit 1;
  end if;

  if p_property_id is null then
    return jsonb_build_object(
      'state', 'no_property', 'allowed', false,
      'reason', 'no_property_membership', 'evaluated_at', now()
    );
  end if;

  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  select * into p from public.properties where id = p_property_id;
  if not found then
    return jsonb_build_object(
      'state', 'no_property', 'allowed', false,
      'reason', 'property_not_found', 'evaluated_at', now()
    );
  end if;

  if public.is_platform_owner() then
    return jsonb_build_object(
      'state', 'platform_owner', 'allowed', true, 'reason', 'platform_owner',
      'property_id', p.id, 'property_status', p.status, 'package', p.package,
      'evaluated_at', now()
    );
  end if;

  -- Property-level access state always dominates the subscription row.
  if p.status in ('suspended', 'inactive') then
    v_state := 'suspended';
  elsif p.status = 'rejected' then
    v_state := 'cancelled';
  elsif p.status = 'pending' then
    v_state := 'pending';
  end if;

  select * into s from public.property_subscriptions where property_id = p.id;

  if v_state is null and s.property_id is null then
    if p.status = 'active' and p.package <> 'none' then
      -- Legacy approved property without a subscription row: keep working but
      -- flag for the platform reconciliation report instead of locking out.
      v_state := 'active';
      v_allowed := true;
      v_missing_expiry := true;
      v_plan_code := case p.package
        when 'professional' then 'professional'
        when 'premium' then 'premium'
        when 'standard' then 'standard'
        else 'starter'
      end;
    else
      v_state := 'no_subscription';
    end if;
  end if;

  if v_state is null and s.property_id is not null then
    v_plan_code := s.plan_code;
    v_effective_end := s.current_period_ends_at;
    v_grace_end := s.grace_ends_at;
    if s.grace_ends_at is not null and s.current_period_ends_at is not null
       and s.grace_ends_at < s.current_period_ends_at then
      -- Impossible date combination (grace before expiry): keep the stored
      -- values for display, but flag for administrative correction.
      v_grace_invalid := true;
    end if;

    -- Platform-set cancellation/suspension always blocks, regardless of dates.
    if s.status = 'cancelled' then
      v_state := 'cancelled';
    elsif s.status = 'suspended' then
      v_state := 'suspended';
    elsif s.manual_extension_until is not null and s.manual_extension_until >= now() then
      -- Audited platform-admin extension wins over elapsed dates.
      v_state := 'manually_extended';
      v_allowed := true;
      v_effective_end := s.manual_extension_until;
    elsif s.status = 'trial' then
      if s.trial_ends_at is null then
        v_state := 'trial';
        v_allowed := true;
        v_missing_expiry := true;
      elsif s.trial_ends_at >= now() then
        v_state := 'trial';
        v_allowed := true;
        v_effective_end := s.trial_ends_at;
      else
        v_state := 'expired';
      end if;
    elsif s.status in ('active', 'past_due') then
      if s.current_period_ends_at is null then
        -- Approved property whose expiry was never configured (approve_property
        -- provisions rows with null dates). Keep working, flag for review.
        v_state := 'active';
        v_allowed := true;
        v_missing_expiry := true;
      elsif s.current_period_ends_at >= now() then
        if s.current_period_ends_at < now() + interval '7 days' then
          v_state := 'expiring_soon';
        else
          v_state := 'active';
        end if;
        v_allowed := true;
      elsif s.grace_ends_at is not null and s.grace_ends_at >= now() then
        v_state := 'grace_period';
        v_allowed := true;
      else
        v_state := 'expired';
      end if;
    else
      v_state := 'expired';
    end if;
  end if;

  if v_state is null then
    v_state := 'no_subscription';
  end if;

  if s.property_id is not null and v_effective_end is null and s.status = 'trial' and s.trial_ends_at is not null then
    v_effective_end := s.trial_ends_at;
  end if;

  v_seconds := case
    when v_effective_end is null then null
    else greatest(0, floor(extract(epoch from (v_effective_end - now())))::bigint)
  end;
  v_seconds_of_grace := case
    when v_grace_end is null then null
    else greatest(0, floor(extract(epoch from (v_grace_end - now())))::bigint)
  end;

  return jsonb_build_object(
    'state', v_state,
    'allowed', v_allowed,
    'reason', case when v_allowed then v_state else 'subscription_' || v_state end,
    'property_id', p.id,
    'property_status', p.status,
    'package', p.package,
    'plan_code', v_plan_code,
    'subscription_status', s.status,
    'trial_ends_at', s.trial_ends_at,
    'period_ends_at', s.current_period_ends_at,
    'grace_ends_at', s.grace_ends_at,
    'manual_extension_until', s.manual_extension_until,
    'effective_end', v_effective_end,
    'seconds_remaining', v_seconds,
    'seconds_of_grace_remaining', v_seconds_of_grace,
    'missing_expiry', v_missing_expiry,
    'grace_invalid', v_grace_invalid,
    'evaluated_at', now()
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.fn_property_entitlement(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_property_entitlement(uuid) FROM anon, PUBLIC;

create or replace function public.fn_get_my_subscription_entitlement()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select public.fn_property_entitlement(null);
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_my_subscription_entitlement() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_get_my_subscription_entitlement() FROM anon, PUBLIC;

create or replace function public.fn_assert_property_operational(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent jsonb;
begin
  if public.is_platform_owner() then
    return;
  end if;
  v_ent := public.fn_property_entitlement(p_property_id);
  if coalesce((v_ent ->> 'allowed')::boolean, false) is not true then
    raise exception
      'Property operations are blocked: subscription state is %.',
      coalesce(v_ent ->> 'state', 'unknown')
      using errcode = 'P0001',
            detail = 'Renew the subscription or contact OliTechs support. '
                     || 'The property''s data is preserved.';
  end if;
end;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assert_property_operational(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_assert_property_operational(uuid) FROM anon, PUBLIC;

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
  v_ent jsonb;
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

  -- Bootstrap a missing subscription row for an approved, packaged property
  -- (unchanged legacy behavior so the row exists for platform management).
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

  -- THE CHANGE: the stored 'active' status no longer overrides elapsed dates.
  -- The computed entitlement is authoritative.
  v_ent := public.fn_property_entitlement(p_property_id);
  allowed := coalesce((v_ent ->> 'allowed')::boolean, false);

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
    'entitlement_state',v_ent ->> 'state',
    'grace_ends_at',s.grace_ends_at,
    'period_ends_at',s.current_period_ends_at,
    'trial_ends_at',s.trial_ends_at
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.fn_subscription_access(uuid,text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_subscription_access(uuid,text) FROM anon, PUBLIC;

COMMIT;