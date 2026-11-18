-- OliTechs PMS+POS — Subscription expiry reconciliation (Phase 5)
--
-- Phase 4 already blocks an expired property at request time: the entitlement
-- engine, every RLS helper, the RPC gate and the row write guards all read the
-- database clock. That remains the non-negotiable backstop.
--
-- This phase adds the scheduled half. An hourly job moves subscriptions whose
-- paid period (and any configured grace) has elapsed into the stored
-- 'suspended' state, so the platform dashboard, the renewal queue, exports and
-- support conversations are accurate without anyone signing in first.
--
-- LOCKED DESIGN DECISIONS — each one is deliberate:
--
--   1. ONLY property_subscriptions.status is written. properties.status is
--      never touched, so a renewal restores access immediately and an operator
--      suspension stays distinguishable from an expiry suspension in the audit
--      trail and the subscription_events log.
--   2. Only rows with an explicit current_period_ends_at are actioned. A null
--      expiry is a data gap, not an expiry: it is reported as `missing_expiry`
--      and left untouched, and the engine keeps that property working. Nothing
--      here invents a date.
--   3. grace_ends_at before current_period_ends_at is an impossible
--      configuration: reported as `grace_invalid`, never actioned.
--   4. A live manual_extension_until wins over elapsed dates and excludes the
--      row. An expired manual extension does not.
--   5. Properties whose properties.status is not 'active' are already blocked
--      by the engine (property state dominates the subscription row) and are
--      reported as `property_not_active`, not actioned — that decision belongs
--      to the platform.
--   6. Trials are reported (`trial_expired`, or `trial_missing_end` when no
--      trial end was ever set) but not written: the engine already denies an
--      elapsed trial, and this job deliberately only acts on paid-period rows
--      with explicit dates.
--   7. Idempotent. The event key is
--      (provider='system_reconcile', 'suspension_<property>_<period end>'), so
--      replaying the job, overlapping runs or a manual re-run all record one
--      event per billing period. The status update itself is naturally
--      idempotent (suspended -> suspended).
--   8. Dry run is supported so the platform can preview exactly what the next
--      scheduled run will do.
--   9. No business data is deleted, moved or archived — the subscription row's
--      plan, dates, modules and any manual extension are preserved verbatim.
--
-- ADDITIVE ONLY. All comparisons are timestamptz against now() on the database
-- clock, never the browser clock.

create or replace function public.platform_reconcile_subscription_suspensions(
  p_dry_run boolean default false,
  p_property_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_suspended jsonb := '[]'::jsonb;
  v_flags jsonb := '[]'::jsonb;
  v_examined integer := 0;
  v_suspended_count integer := 0;
  v_flagged_count integer := 0;
  v_event_id text;
  v_overdue_days integer;
begin
  -- Platform owner, or a scheduled/system caller (pg_cron, service role).
  -- A signed-in browser request always carries auth.uid(), so this exemption
  -- is unreachable from a user session; anon has no EXECUTE grant at all.
  if auth.uid() is not null and not public.is_platform_owner() then
    raise exception 'Only a platform owner can reconcile subscription status.'
      using errcode = '42501';
  end if;

  if p_property_id is not null
     and not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.' using errcode = '22023';
  end if;

  for v_row in
    select s.*, p.name as property_name, p.status as property_status
    from public.property_subscriptions s
    join public.properties p on p.id = s.property_id
    where p_property_id is null or s.property_id = p_property_id
    order by s.property_id
    for update of s
  loop
    v_examined := v_examined + 1;

    -- An explicit platform decision (or an earlier run of this job) stands.
    if v_row.status in ('suspended', 'cancelled') then
      continue;
    end if;

    -- Property-level state already dominates the subscription row.
    if v_row.property_status is distinct from 'active' then
      v_flagged_count := v_flagged_count + 1;
      v_flags := v_flags || jsonb_build_object(
        'property_id', v_row.property_id,
        'property_name', v_row.property_name,
        'flag', 'property_not_active',
        'detail', format('properties.status is %s; the entitlement engine already blocks this property.', v_row.property_status),
        'subscription_status', v_row.status,
        'current_period_ends_at', v_row.current_period_ends_at
      );
      continue;
    end if;

    -- Trials use trial_ends_at, not the billing period end. Report and stop:
    -- the engine already denies an elapsed trial, and this job only writes
    -- paid-period rows.
    if v_row.status = 'trial' then
      if v_row.trial_ends_at is null then
        v_flagged_count := v_flagged_count + 1;
        v_flags := v_flags || jsonb_build_object(
          'property_id', v_row.property_id,
          'property_name', v_row.property_name,
          'flag', 'trial_missing_end',
          'detail', 'No trial end date is configured, so the trial never expires on its own. Set a real trial end or convert it to a paid period.',
          'subscription_status', v_row.status
        );
      elsif v_row.trial_ends_at < now() then
        v_flagged_count := v_flagged_count + 1;
        v_flags := v_flags || jsonb_build_object(
          'property_id', v_row.property_id,
          'property_name', v_row.property_name,
          'flag', 'trial_expired',
          'detail', 'The trial has elapsed and the engine already denies access. Convert to a paid period or cancel it.',
          'subscription_status', v_row.status,
          'trial_ends_at', v_row.trial_ends_at
        );
      end if;
      continue;
    end if;

    -- Data gap: no expiry on file. Report, never invent.
    if v_row.current_period_ends_at is null then
      v_flagged_count := v_flagged_count + 1;
      v_flags := v_flags || jsonb_build_object(
        'property_id', v_row.property_id,
        'property_name', v_row.property_name,
        'flag', 'missing_expiry',
        'detail', 'No subscription expiry is configured. The property keeps working and must be given a real period end by the platform.',
        'subscription_status', v_row.status,
        'plan_code', v_row.plan_code
      );
      continue;
    end if;

    -- Impossible configuration: grace before expiry. Report, never act.
    if v_row.grace_ends_at is not null
       and v_row.grace_ends_at < v_row.current_period_ends_at then
      v_flagged_count := v_flagged_count + 1;
      v_flags := v_flags || jsonb_build_object(
        'property_id', v_row.property_id,
        'property_name', v_row.property_name,
        'flag', 'grace_invalid',
        'detail', 'grace_ends_at is before current_period_ends_at. The entitlement engine ignores it; correct the dates.',
        'subscription_status', v_row.status,
        'current_period_ends_at', v_row.current_period_ends_at,
        'grace_ends_at', v_row.grace_ends_at
      );
      continue;
    end if;

    -- A live audited extension wins over elapsed dates.
    if v_row.manual_extension_until is not null
       and v_row.manual_extension_until >= now() then
      continue;
    end if;

    -- Only paid-period statuses are actioned.
    if v_row.status not in ('active', 'past_due') then
      continue;
    end if;

    -- Paid period still running.
    if v_row.current_period_ends_at >= now() then
      continue;
    end if;

    -- Configured grace still running (explicit per-row grace end).
    if v_row.grace_ends_at is not null and v_row.grace_ends_at >= now() then
      continue;
    end if;

    v_overdue_days := greatest(0, floor(extract(epoch from (
      now() - coalesce(v_row.grace_ends_at, v_row.current_period_ends_at)
    )) / 86400)::integer);

    v_suspended_count := v_suspended_count + 1;
    v_suspended := v_suspended || jsonb_build_object(
      'property_id', v_row.property_id,
      'property_name', v_row.property_name,
      'action', case when p_dry_run then 'would_suspend' else 'suspended' end,
      'previous_status', v_row.status,
      'current_period_ends_at', v_row.current_period_ends_at,
      'grace_ends_at', v_row.grace_ends_at,
      'days_past_due', v_overdue_days
    );

    if p_dry_run then
      continue;
    end if;

    -- The ONLY write to the subscription row: the stored status. Dates, plan,
    -- modules and any manual extension are preserved exactly as they are.
    update public.property_subscriptions
       set status = 'suspended',
           updated_at = now(),
           updated_by = auth.uid()
     where property_id = v_row.property_id;

    insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
    values (
      auth.uid(),
      'property_subscription_suspended_expired',
      v_row.property_id,
      to_jsonb(v_row),
      jsonb_build_object(
        'status', 'suspended',
        'previous_status', v_row.status,
        'current_period_ends_at', v_row.current_period_ends_at,
        'grace_ends_at', v_row.grace_ends_at,
        'days_past_due', v_overdue_days,
        'source', 'scheduled_reconciliation'
      )
    );

    v_event_id := 'suspension_' || v_row.property_id::text || '_'
                  || to_char(v_row.current_period_ends_at, 'YYYYMMDDHH24MISS');

    insert into public.subscription_events(
      property_id, event_type, provider, external_event_id, payload, status, processed_at
    )
    values (
      v_row.property_id,
      'subscription_suspended',
      'system_reconcile',
      v_event_id,
      jsonb_build_object(
        'previous_status', v_row.status,
        'current_period_ends_at', v_row.current_period_ends_at,
        'grace_ends_at', v_row.grace_ends_at,
        'days_past_due', v_overdue_days,
        'actor', auth.uid()
      ),
      'processed',
      now()
    )
    on conflict (provider, external_event_id) do nothing;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', coalesce(p_dry_run, false),
    'evaluated_at', now(),
    'properties_examined', v_examined,
    'suspended_count', v_suspended_count,
    'flagged_count', v_flagged_count,
    'suspended', v_suspended,
    'flags', v_flags
  );
end;
$$;

grant execute on function public.platform_reconcile_subscription_suspensions(boolean, uuid)
  to authenticated, service_role;
revoke execute on function public.platform_reconcile_subscription_suspensions(boolean, uuid)
  from anon, public;

-- ---------------------------------------------------------------------------
-- Hourly schedule.
--
-- Request-time enforcement never depends on this job, so the migration must
-- apply on databases where pg_cron is unavailable or cannot be enabled from a
-- migration (Supabase enables it from the dashboard). Every failure path is a
-- warning, never an error, and the platform console can still run the RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise warning 'pg_cron is not available; subscription reconciliation must be scheduled externally.';
    return;
  end if;

  begin
    create extension if not exists pg_cron;
  exception when others then
    raise warning 'pg_cron could not be enabled (%); subscription reconciliation must be scheduled externally.', sqlerrm;
    return;
  end;

  begin
    -- cron.schedule upserts on the job name, so re-running this migration
    -- keeps exactly one job instead of stacking duplicates.
    select cron.schedule(
      'olitechs_subscription_reconcile',
      '5 * * * *',
      $job$select public.platform_reconcile_subscription_suspensions(false);$job$
    ) into v_job_id;

    raise notice 'subscription reconciliation scheduled as pg_cron job %', v_job_id;
  exception when others then
    raise warning 'subscription reconciliation could not be scheduled (%); run it from the platform console instead.', sqlerrm;
  end;
end;
$$;

notify pgrst,'reload schema';
