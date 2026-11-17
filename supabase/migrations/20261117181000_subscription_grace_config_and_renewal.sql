-- OliTechs PMS+POS — Grace-period configuration and renewal (Phase 3)
--
-- Correctness rules implemented here:
--   1. The grace period must BEGIN after the subscription expiry. Phase 2's
--      engine already ignores impossible grace dates and flags them; this
--      migration rejects them on new writes (done in the Phase 2 overload)
--      and provides the single source for HOW LONG grace lasts.
--   2. Grace duration comes from platform configuration — NOT from the
--      frontend and NOT invented in code. Until the platform admin
--      configures `grace_days`, no automatic grace is granted at all
--      (an expired period is blocked immediately). Configuring it later
--      takes effect for future renewals.
--   3. Renewal updates the period end, recomputes the grace end from the
--      configured duration, clears any manual extension, restores the
--      stored status to 'active', and records an audited event. Renewal IS
--      the confirmed payment/renewal operation per the existing workflow
--      (platform admin performs and confirms it); no unconfirmed payment
--      can activate a property.
--
-- ADDITIVE ONLY. All comparisons are timestamptz against now() on the
-- database clock — never the browser clock.

create table if not exists public.platform_grace_config (
  id integer primary key default 1 check (id = 1),
  grace_days integer check (grace_days is null or grace_days between 0 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.platform_grace_config enable row level security;

drop policy if exists platform_grace_config_select on public.platform_grace_config;
create policy platform_grace_config_select
on public.platform_grace_config for select
using (true);

-- Writes happen only through the audited RPC below; no direct table grants.
revoke all on public.platform_grace_config from anon, authenticated;

-- Idempotent seed row with NO grace configured (grace_days null = no
-- automatic grace; explicit grace_ends_at values on subscriptions still
-- apply until changed by the platform).
insert into public.platform_grace_config (id, grace_days)
values (1, null)
on conflict (id) do nothing;

create or replace function public.fn_configured_grace_days()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select grace_days from public.platform_grace_config where id = 1;
$$;

-- Default grace end for a given period end (null when unconfigured so the
-- caller can decide: no invented grace).
create or replace function public.fn_default_grace_end(p_period_end timestamptz)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select case
    when p_period_end is null or public.fn_configured_grace_days() is null then null
    else p_period_end + make_interval(days => public.fn_configured_grace_days())
  end;
$$;

create or replace function public.platform_set_grace_period_days(
  p_grace_days integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can configure the grace period.' using errcode = '42501';
  end if;
  if p_grace_days is null or p_grace_days < 0 or p_grace_days > 365 then
    raise exception 'Grace days must be between 0 and 365 (or omitted to disable automatic grace).' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required.' using errcode = '22023';
  end if;

  select grace_days into v_old from public.platform_grace_config where id = 1;

  insert into public.platform_grace_config (id, grace_days, updated_at, updated_by)
  values (1, p_grace_days, now(), auth.uid())
  on conflict (id) do update
    set grace_days = excluded.grace_days,
        updated_at = now(),
        updated_by = excluded.updated_by;

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values(
    auth.uid(),
    'platform_grace_config_updated',
    null,
    jsonb_build_object('grace_days', v_old),
    jsonb_build_object('grace_days', p_grace_days, 'reason', btrim(p_reason))
  );

  return p_grace_days;
end;
$$;

grant execute on function public.platform_set_grace_period_days(integer, text) to authenticated;
revoke execute on function public.platform_set_grace_period_days(integer, text) from anon, public;

-- ---------------------------------------------------------------------------
-- platform_renew_subscription — the confirmed renewal path.
--
-- Extends the billing period to the new end, recomputes grace from the
-- configured duration (explicit per-renewal grace still possible), restores
-- operational status, clears any manual extension, writes audit + event.
-- ---------------------------------------------------------------------------
create or replace function public.platform_renew_subscription(
  p_property_id uuid,
  p_new_period_end timestamptz,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.property_subscriptions;
  v_row public.property_subscriptions;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can renew subscriptions.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.';
  end if;
  if p_new_period_end is null or p_new_period_end <= now() then
    raise exception 'The new period end must be in the future.' using errcode = '22023';
  end if;
  if p_note is null or length(btrim(p_note)) < 5 then
    raise exception 'A renewal note of at least 5 characters is required (payment reference or reason).' using errcode = '22023';
  end if;

  select * into v_old from public.property_subscriptions where property_id = p_property_id
    for update;

  insert into public.property_subscriptions(
    property_id, plan_code, status, trial_ends_at, current_period_ends_at,
    grace_ends_at, enabled_modules, manual_extension_until, updated_by
  )
  values(
    p_property_id,
    coalesce(v_old.plan_code, 'starter'),
    'active',
    v_old.trial_ends_at,
    p_new_period_end,
    public.fn_default_grace_end(p_new_period_end),
    coalesce(v_old.enabled_modules, '{}'),
    null,
    auth.uid()
  )
  on conflict (property_id) do update set
    status = 'active',
    current_period_ends_at = excluded.current_period_ends_at,
    grace_ends_at = excluded.grace_ends_at,
    manual_extension_until = null,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_row;

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values(
    auth.uid(),
    'property_subscription_renewed',
    p_property_id,
    to_jsonb(v_old),
    jsonb_build_object(
      'previous_period_ends_at', v_old.current_period_ends_at,
      'new_period_ends_at', p_new_period_end,
      'new_grace_ends_at', v_row.grace_ends_at,
      'previous_status', v_old.status,
      'new_status', 'active',
      'note', btrim(p_note)
    )
  );

  insert into public.subscription_events(
    property_id, event_type, provider, external_event_id, payload, status, processed_at
  )
  values(
    p_property_id,
    'subscription_renewed',
    'platform_admin',
    'renewal_' || p_property_id || '_' || to_char(p_new_period_end, 'YYYYMMDDHH24MISS'),
    jsonb_build_object(
      'previous_period_ends_at', v_old.current_period_ends_at,
      'new_period_ends_at', p_new_period_end,
      'grace_ends_at', v_row.grace_ends_at,
      'note', btrim(p_note),
      'actor', auth.uid()
    ),
    'processed',
    now()
  )
  on conflict (provider, external_event_id) do nothing;

  return jsonb_build_object(
    'subscription', to_jsonb(v_row),
    'entitlement', public.fn_property_entitlement(p_property_id)
  );
end;
$$;

grant execute on function public.platform_renew_subscription(uuid, timestamptz, text) to authenticated;
revoke execute on function public.platform_renew_subscription(uuid, timestamptz, text) from anon, public;

notify pgrst,'reload schema';
