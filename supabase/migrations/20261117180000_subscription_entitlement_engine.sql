-- OliTechs PMS+POS — Subscription entitlement engine (Phase 2)
--
-- ONE authoritative evaluator for every subscription access decision.
-- Migration 0042 / 20261012160000 made `active` subscription status override
-- expiry dates entirely, so an expired subscription still granted access.
-- This migration replaces that rule with a computed entitlement:
--
--   state           meaning
--   platform_owner  OliTechs platform admin (always allowed)
--   pending         property not yet approved (blocked)
--   trial           within valid trial (allowed)
--   active          paid period valid (allowed)
--   expiring_soon   paid period valid, ending within 7 days (allowed)
--   grace_period    paid period elapsed, configured grace still valid (allowed)
--   manually_extended  platform admin granted an audited extension (allowed)
--   expired         period and grace both elapsed (blocked)
--   suspended       operational access blocked (platform decision or property state)
--   cancelled       subscription cancelled (blocked)
--   no_subscription no subscription row for a non-packaged property (blocked)
--
-- Deliberate legacy-compatibility decision: an ACTIVE property with an
-- assigned package but a missing/never-set expiry is reported as state
-- 'active' with missing_expiry=true instead of being locked out. Those rows
-- are flagged for the platform reconciliation report (Phase 10) and the
-- platform admin sets a real expiry for them; automatic suspension never
-- invents dates (see Phase 5 job: it only suspends rows with explicit dates).
--
-- ADDITIVE ONLY: no existing table or column is dropped; the stored
-- `status` column keeps its historical meaning for display/audit. Nothing
-- here trusts the browser: all decisions derive from database values.

alter table public.property_subscriptions
  add column if not exists manual_extension_until timestamptz;

-- ---------------------------------------------------------------------------
-- fn_property_entitlement — the single entitlement evaluator.
-- p_property_id null resolves the caller's own primary membership.
-- ---------------------------------------------------------------------------
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

grant execute on function public.fn_property_entitlement(uuid) to authenticated;
revoke execute on function public.fn_property_entitlement(uuid) from anon, public;

-- Caller's own entitlement, for the auth session build.
create or replace function public.fn_get_my_subscription_entitlement()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select public.fn_property_entitlement(null);
$$;

grant execute on function public.fn_get_my_subscription_entitlement() to authenticated;
revoke execute on function public.fn_get_my_subscription_entitlement() from anon, public;

-- ---------------------------------------------------------------------------
-- Hard gate for operational RPCs and jobs: raises unless the property may
-- operate. Platform admins are always exempt. Used from Phase 4 onward.
-- ---------------------------------------------------------------------------
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

grant execute on function public.fn_assert_property_operational(uuid) to authenticated;
revoke execute on function public.fn_assert_property_operational(uuid) from anon, public;

-- ---------------------------------------------------------------------------
-- fn_subscription_access — same signature and module normalization as the
-- production function (20261012160000), but the date/status decision now
-- comes from the entitlement engine. RLS helpers (can_backoffice,
-- can_store_write, fn_subscription_module_allowed, ...) delegate here, so
-- this single change propagates server-side enforcement everywhere.
-- ---------------------------------------------------------------------------
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

grant execute on function public.fn_subscription_access(uuid,text) to authenticated;
revoke execute on function public.fn_subscription_access(uuid,text) from anon, public;

-- ---------------------------------------------------------------------------
-- platform_update_subscription — overload adding an audited manual extension.
-- The existing 7-argument signature keeps working unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.platform_update_subscription(
  p_property_id uuid,
  p_plan_code text,
  p_status text,
  p_trial_ends_at timestamptz default null,
  p_current_period_ends_at timestamptz default null,
  p_grace_ends_at timestamptz default null,
  p_enabled_modules text[] default '{}',
  p_manual_extension_until timestamptz default null,
  p_override_reason text default null
)
returns public.property_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.property_subscriptions;
  v_old public.property_subscriptions;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage subscriptions.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.';
  end if;

  if p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'Invalid subscription status.';
  end if;

  -- Impossible date combinations are rejected for NEW writes. Existing rows
  -- are handled by the reconciliation report, not silently rewritten.
  if p_current_period_ends_at is not null and p_trial_ends_at is not null
     and p_trial_ends_at > p_current_period_ends_at then
    raise exception 'Trial end date cannot be after the subscription period end.'
      using errcode = '22023';
  end if;
  if p_grace_ends_at is not null and p_current_period_ends_at is not null
     and p_grace_ends_at < p_current_period_ends_at then
    raise exception
      'Grace period must end on or after the subscription period end.'
      using errcode = '22023',
            hint = 'Set the grace period to expiry + the configured grace duration, or clear it.';
  end if;
  if p_manual_extension_until is not null
     and (p_override_reason is null or length(btrim(p_override_reason)) < 10) then
    raise exception 'A manual extension requires a reason of at least 10 characters.'
      using errcode = '22023';
  end if;

  select * into v_old from public.property_subscriptions where property_id = p_property_id;

  insert into public.property_subscriptions(
    property_id,plan_code,status,trial_ends_at,current_period_ends_at,
    grace_ends_at,enabled_modules,manual_extension_until,updated_by
  )
  values(
    p_property_id,
    coalesce(nullif(trim(p_plan_code), ''), 'starter'),
    p_status,
    p_trial_ends_at,
    p_current_period_ends_at,
    p_grace_ends_at,
    coalesce(p_enabled_modules, '{}'),
    p_manual_extension_until,
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    trial_ends_at = excluded.trial_ends_at,
    current_period_ends_at = excluded.current_period_ends_at,
    grace_ends_at = excluded.grace_ends_at,
    enabled_modules = excluded.enabled_modules,
    manual_extension_until = excluded.manual_extension_until,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_subscription;

  insert into public.audit_logs(
    actor_id, action, property_id, old_value, new_value
  )
  values(
    auth.uid(),
    'property_subscription_updated',
    p_property_id,
    to_jsonb(v_old),
    jsonb_build_object(
      'plan_code', v_subscription.plan_code,
      'status', v_subscription.status,
      'trial_ends_at', v_subscription.trial_ends_at,
      'current_period_ends_at', v_subscription.current_period_ends_at,
      'grace_ends_at', v_subscription.grace_ends_at,
      'enabled_modules', v_subscription.enabled_modules,
      'manual_extension_until', v_subscription.manual_extension_until,
      'override_reason', p_override_reason
    )
  );

  -- Manual extensions are first-class subscription events (idempotent per
  -- request is not needed here: each call is an explicit admin decision).
  if p_manual_extension_until is not null then
    insert into public.subscription_events(
      property_id, event_type, provider, external_event_id, payload, status, processed_at
    )
    values(
      p_property_id,
      'manual_extension',
      'platform_admin',
      'manual_extension_' || p_property_id || '_' || to_char(p_manual_extension_until, 'YYYYMMDDHH24MISS'),
      jsonb_build_object(
        'manual_extension_until', p_manual_extension_until,
        'reason', p_override_reason,
        'actor', auth.uid()
      ),
      'processed',
      now()
    )
    on conflict (provider, external_event_id) do nothing;
  end if;

  return v_subscription;
end;
$$;

grant execute on function public.platform_update_subscription(
  uuid,text,text,timestamptz,timestamptz,timestamptz,text[],timestamptz,text
) to authenticated;
revoke execute on function public.platform_update_subscription(
  uuid,text,text,timestamptz,timestamptz,timestamptz,text[],timestamptz,text
) from anon, public;

notify pgrst,'reload schema';
