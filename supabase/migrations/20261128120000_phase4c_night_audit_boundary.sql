-- Phase 4C-1 — Night Audit as a reconciled financial boundary.
--
-- Forward-only correction layer. This migration does not edit or renumber any
-- applied migration file. It keeps the existing Night Audit RPC signatures as
-- compatibility wrappers and adds canonical Phase 4C RPCs for explicit
-- reconciliation, request-key replay, failed attempts, audit rows and audited
-- override evidence.
--
-- Deployment note:
--   1. Apply only after re-running the applied-state preflight in
--      docs/audit/PHASE4_GOVERNANCE_BASELINE.md against a staging database.
--   2. Database changes deploy before the web client changes that call the
--      canonical RPC. The compatibility wrapper lets older clients keep
--      closing with a deterministic request key.
--   3. No applied migration is rewritten, no migration is renumbered, and no
--      destructive DDL, data backfill or employee reassignment is performed.
--   4. A failed Night Audit attempt no longer blocks accommodation posting;
--      fn_post_accommodation_charges is forward-corrected to treat only
--      status='closed' as a closed business date.
--   5. The legacy two-argument RPC replays by property, actor and notes because
--      it has no request key. Callers closing multiple dates with identical
--      notes must move to the canonical request-key RPC.

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue and additive night_audits columns
-- ---------------------------------------------------------------------------

insert into public.employee_permission_codes (code, workspace, label, sensitive, sort_order)
values
  ('nightaudit.run', 'backoffice', 'Run and close the nightly audit', true, 47),
  ('nightaudit.override', 'backoffice', 'Override a blocked night audit reconciliation', true, 48)
on conflict (code) do nothing;

alter table public.night_audits add column if not exists request_key text;
alter table public.night_audits add column if not exists request_fingerprint text;
alter table public.night_audits add column if not exists reconciliation_snapshot jsonb;
alter table public.night_audits add column if not exists override_by uuid;
alter table public.night_audits add column if not exists override_at timestamptz;
alter table public.night_audits add column if not exists override_reason text;
alter table public.night_audits add column if not exists override_grant_id uuid;

create unique index if not exists night_audits_property_request_key_uniq
  on public.night_audits(property_id, request_key)
  where request_key is not null;

create index if not exists night_audits_property_status_date_idx
  on public.night_audits(property_id, status, business_date desc);

-- ---------------------------------------------------------------------------
-- 2. One authority helper for run and posting paths
-- ---------------------------------------------------------------------------

create or replace function public.fn_phase4c_night_audit_permission(p_property_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if p_property_id is null then
    return false;
  end if;

  if public.fn_employee_has_permission(p_property_id, 'nightaudit.run') then
    return true;
  end if;

  -- Legacy manager catalogue remains valid during the migration window so the
  -- new permission code does not silently lock out existing managers.
  if public.fn_has_permission(p_property_id, 'nightaudit.run') then
    return true;
  end if;

  return false;
end;
$function$;

revoke all on function public.fn_phase4c_night_audit_permission(uuid) from public, anon;
grant execute on function public.fn_phase4c_night_audit_permission(uuid) to authenticated;

create or replace function public.fn_phase4c_night_audit_override(
  p_property_id uuid,
  p_grant_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_staff_id uuid;
begin
  if p_property_id is null then
    return false;
  end if;

  if public.fn_employee_has_permission(p_property_id, 'nightaudit.override') then
    return true;
  end if;

  if p_grant_id is null then
    return false;
  end if;

  v_staff_id := public.current_staff_id(p_property_id);

  -- A grant belongs to the employee who requested it. Accept it through the
  -- active PIN staff session, or through the staff record signed in as the
  -- current user. Never let one employee spend another employee's grant.
  return exists (
    select 1
    from public.module_access_grants g
    where g.id = p_grant_id
      and g.property_id = p_property_id
      and g.permission_code = 'nightaudit.override'
      and g.revoked_at is null
      and g.expires_at > now()
      and (
        g.staff_id = v_staff_id
        or exists (
          select 1
          from public.staff s
          where s.id = g.staff_id
            and s.property_id = p_property_id
            and s.user_id = auth.uid()
            and s.is_active = true
        )
      )
  );
end;
$function$;

revoke all on function public.fn_phase4c_night_audit_override(uuid, uuid) from public, anon;
grant execute on function public.fn_phase4c_night_audit_override(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Server-authoritative reconciliation snapshot
-- ---------------------------------------------------------------------------

create or replace function public.fn_phase4c_reconciliation_snapshot(
  p_property_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_room_folio numeric := 0;
  v_room_payments numeric := 0;
  v_room_excluded numeric := 0;
  v_pos_subtotal numeric := 0;
  v_pos_total numeric := 0;
  v_pos_tax numeric := 0;
  v_pos_discount numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_split_total numeric := 0;
  v_split_allocated numeric := 0;
  v_cash_tender numeric := 0;
  v_card_tender numeric := 0;
  v_mpesa_tender numeric := 0;
  v_room_tender numeric := 0;
  v_cashier_variance numeric := 0;
  v_receipt_count integer := 0;
  v_snapshot jsonb;
begin
  if not public.fn_phase4c_night_audit_permission(p_property_id) then
    raise exception 'Missing employee permission: nightaudit.run';
  end if;
  if p_property_id is null or p_business_date is null then
    raise exception 'Property and business date are required.' using errcode = '22023';
  end if;

  -- Accommodation revenue is recognised from non-reversed room folio lines.
  -- Payments are counted only when they can be attributed to those lines:
  -- direct allocations, or unallocated payments on room-only reservations.
  with room_charges as (
    select c.id, c.reservation_id, c.amount
    from public.folio_charges c
    where c.property_id = p_property_id
      and c.source = 'room'
      and c.reversal_of_id is null
      and not exists (
        select 1 from public.folio_charges rev where rev.reversal_of_id = c.id
      )
      and (c.created_at at time zone 'Africa/Nairobi')::date = p_business_date
  ),
  mixed_reservations as (
    select distinct c.reservation_id
    from public.folio_charges c
    where c.property_id = p_property_id
      and c.source <> 'room'
      and c.reversal_of_id is null
      and not exists (
        select 1 from public.folio_charges rev where rev.reversal_of_id = c.id
      )
      and c.reservation_id in (select reservation_id from room_charges)
  ),
  room_payments as (
    select p.amount
    from public.payments p
    where p.property_id = p_property_id
      and p.status = 'posted'
      and (p.created_at at time zone 'Africa/Nairobi')::date = p_business_date
      and (
        p.folio_charge_id in (select id from room_charges)
        or (
          p.folio_charge_id is null
          and p.reservation_id in (select reservation_id from room_charges)
          and p.reservation_id not in (select reservation_id from mixed_reservations)
        )
      )
  ),
  excluded_payments as (
    select p.amount
    from public.payments p
    where p.property_id = p_property_id
      and p.status = 'posted'
      and (p.created_at at time zone 'Africa/Nairobi')::date = p_business_date
      and p.reservation_id in (select reservation_id from room_charges)
      and not (
        p.folio_charge_id in (select id from room_charges)
        or (
          p.folio_charge_id is null
          and p.reservation_id not in (select reservation_id from mixed_reservations)
        )
      )
  )
  select
    (select coalesce(sum(amount), 0) from room_charges),
    (select coalesce(sum(amount), 0) from room_payments),
    (select coalesce(sum(amount), 0) from excluded_payments)
  into v_room_folio, v_room_payments, v_room_excluded;

  -- POS totals come only from posted receipts. Voided receipts stay in a
  -- separate bucket and are never included in posted revenue.
  select
    coalesce(sum(r.subtotal), 0),
    coalesce(sum(r.total), 0),
    coalesce(sum(r.vat), 0),
    coalesce(sum(r.discount_amount), 0),
    count(*)
  into v_pos_subtotal, v_pos_total, v_pos_tax, v_pos_discount, v_receipt_count
  from public.pos_receipts r
  where r.property_id = p_property_id
    and r.status = 'posted'
    and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  select coalesce(sum(f.amount), 0)
  into v_refunds
  from public.cashier_refunds f
  where f.property_id = p_property_id
    and (f.created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  select coalesce(sum(r.total), 0)
  into v_voids
  from public.pos_receipts r
  where r.property_id = p_property_id
    and r.status = 'voided'
    and (coalesce(r.voided_at, r.created_at) at time zone 'Africa/Nairobi')::date = p_business_date;

  select coalesce(sum(r.total), 0)
  into v_split_total
  from public.pos_receipts r
  where r.property_id = p_property_id
    and r.status = 'posted'
    and lower(coalesce(r.payment_method, '')) = 'split'
    and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  select coalesce(sum(a.amount), 0)
  into v_split_allocated
  from public.pos_receipt_payments a
  join public.pos_receipts r on r.id = a.receipt_id
  where a.property_id = p_property_id
    and r.property_id = p_property_id
    and r.status = 'posted'
    and lower(coalesce(r.payment_method, '')) = 'split'
    and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  -- Tenders are counted from split allocations where they exist, and from the
  -- receipt-level method for direct (non-split) receipts.
  with tenders as (
    select lower(r.payment_method) as method, sum(r.total) as amount
    from public.pos_receipts r
    where r.property_id = p_property_id
      and r.status = 'posted'
      and lower(coalesce(r.payment_method, '')) <> 'split'
      and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date
    group by 1
    union all
    select lower(a.payment_method) as method, sum(a.amount) as amount
    from public.pos_receipt_payments a
    join public.pos_receipts r on r.id = a.receipt_id
    where a.property_id = p_property_id
      and r.property_id = p_property_id
      and r.status = 'posted'
      and lower(coalesce(r.payment_method, '')) = 'split'
      and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date
    group by 1
  )
  select
    coalesce(sum(amount) filter (where method = 'cash'), 0),
    coalesce(sum(amount) filter (where method = 'card'), 0),
    coalesce(sum(amount) filter (where method = 'mpesa'), 0),
    coalesce(sum(amount) filter (where method = 'room'), 0)
  into v_cash_tender, v_card_tender, v_mpesa_tender, v_room_tender
  from tenders;

  select coalesce(sum(cs.variance), 0)
  into v_cashier_variance
  from public.cashier_shifts cs
  where cs.property_id = p_property_id
    and cs.status = 'closed'
    and (cs.closed_at at time zone 'Africa/Nairobi')::date = p_business_date;

  v_snapshot := jsonb_build_object(
    'business_date', p_business_date,
    'room_folio_revenue', round(v_room_folio, 2),
    'room_posted_payments', round(v_room_payments, 2),
    'room_payments_excluded_from_variance', round(v_room_excluded, 2),
    'room_revenue_variance', round(v_room_folio - v_room_payments, 2),
    'pos_subtotal', round(v_pos_subtotal, 2),
    'pos_posted_total', round(v_pos_total, 2),
    'pos_tax', round(v_pos_tax, 2),
    'discounts', round(v_pos_discount, 2),
    'refunds', round(v_refunds, 2),
    'voids_excluded', round(v_voids, 2),
    'pos_room_tender', round(v_room_tender, 2),
    'cash_revenue', round(v_cash_tender, 2),
    'card_revenue', round(v_card_tender, 2),
    'mpesa_revenue', round(v_mpesa_tender, 2),
    'pos_tax_discount_variance', round(v_pos_total - (v_pos_subtotal - v_pos_discount + v_pos_tax), 2),
    'pos_split_tender_total', round(v_split_total, 2),
    'pos_split_tender_allocated', round(v_split_allocated, 2),
    'pos_split_tender_variance', round(v_split_allocated - v_split_total, 2),
    'cashier_variance', round(v_cashier_variance, 2),
    'posted_receipt_count', v_receipt_count
  );

  v_snapshot := v_snapshot || jsonb_build_object(
    'blocking_variance',
      (v_snapshot ->> 'room_revenue_variance')::numeric <> 0
      or (v_snapshot ->> 'pos_tax_discount_variance')::numeric <> 0
      or (v_snapshot ->> 'pos_split_tender_variance')::numeric <> 0,
    'blocking_reason', case
      when (v_snapshot ->> 'room_revenue_variance')::numeric <> 0
        then 'Room folio revenue does not reconcile to posted room payments.'
      when (v_snapshot ->> 'pos_tax_discount_variance')::numeric <> 0
        then 'POS posted total does not reconcile to subtotal, discount and tax.'
      when (v_snapshot ->> 'pos_split_tender_variance')::numeric <> 0
        then 'Split tender allocations do not reconcile to split receipts.'
      else null
    end
  );

  return v_snapshot;
end;
$function$;

revoke all on function public.fn_phase4c_reconciliation_snapshot(uuid, date) from public, anon;
grant execute on function public.fn_phase4c_reconciliation_snapshot(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Precheck with reconciliation and blocking variance
-- ---------------------------------------------------------------------------

create or replace function public.fn_night_audit_precheck(p_property_id uuid, p_business_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_open_shifts integer;
  v_pending integer;
  v_snapshot jsonb;
begin
  if not public.fn_phase4c_night_audit_permission(p_property_id) then
    raise exception 'Missing employee permission: nightaudit.run';
  end if;

  select count(*) into v_open_shifts
  from public.cashier_shifts
  where property_id = p_property_id and status = 'open';

  select count(*) into v_pending
  from public.cashier_adjustments
  where property_id = p_property_id and status = 'pending';

  v_snapshot := public.fn_phase4c_reconciliation_snapshot(p_property_id, p_business_date);

  return jsonb_build_object(
    'business_date', p_business_date,
    'open_cashier_shifts', v_open_shifts,
    'pending_adjustments', v_pending,
    'transactions', (v_snapshot ->> 'posted_receipt_count')::integer,
    'revenue', (v_snapshot ->> 'pos_posted_total')::numeric,
    'reconciliation', v_snapshot,
    'blocking_variance', (v_snapshot ->> 'blocking_variance')::boolean,
    'ready', v_open_shifts = 0
      and v_pending = 0
      and not (v_snapshot ->> 'blocking_variance')::boolean
  );
end;
$function$;

revoke all on function public.fn_night_audit_precheck(uuid, date) from public, anon;
grant execute on function public.fn_night_audit_precheck(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Canonical close RPC with request key, failed rows and audited override
-- ---------------------------------------------------------------------------

create or replace function public.fn_phase4c_run_night_audit(
  p_property_id uuid,
  p_request_key text,
  p_business_date date default null,
  p_notes text default null,
  p_override_reason text default null,
  p_override_grant_id uuid default null
)
returns public.night_audits
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_fingerprint text;
  v_existing public.night_audits;
  v_row public.night_audits;
  v_result public.night_audits;
  v_current_date date;
  v_date date;
  v_next date;
  v_open_shifts integer;
  v_pending integer;
  v_snapshot jsonb;
  v_blocked boolean;
  v_has_override boolean;
  v_values jsonb;
begin
  if not public.fn_phase4c_night_audit_permission(p_property_id) then
    raise exception 'Missing employee permission: nightaudit.run';
  end if;
  if p_property_id is null or v_request_key = '' then
    raise exception 'A night audit request key is required.' using errcode = '22023';
  end if;

  v_fingerprint := md5(concat_ws('|',
    'phase4c',
    p_property_id::text,
    coalesce(p_business_date::text, ''),
    coalesce(p_notes, ''),
    coalesce(p_override_reason, ''),
    coalesce(p_override_grant_id::text, '')
  ));

  -- Serialise retries for the same request key before checking for a replay.
  perform pg_advisory_xact_lock(hashtextextended(
    p_property_id::text || ':night-audit-request:' || v_request_key, 0
  ));

  -- Ambiguous retry: replay only an identical request, never a modified one.
  select * into v_existing
  from public.night_audits
  where property_id = p_property_id and request_key = v_request_key;
  if v_existing.id is not null then
    if coalesce(v_existing.request_fingerprint, '') <> v_fingerprint then
      raise exception 'Night audit request key was reused with a different payload.' using errcode = '22023';
    end if;
    return v_existing;
  end if;

  select business_date into v_current_date
  from public.property_business_dates
  where property_id = p_property_id
  for update;

  if v_current_date is null then
    v_current_date := (now() at time zone 'Africa/Nairobi')::date;
    insert into public.property_business_dates(property_id, business_date)
    values (p_property_id, v_current_date)
    on conflict (property_id) do nothing;
  end if;

  v_date := coalesce(p_business_date, v_current_date);
  if v_date <> v_current_date then
    raise exception 'Night audit can only close the current business date.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.night_audits
    where property_id = p_property_id and business_date = v_date and status = 'closed'
  ) then
    raise exception 'Night audit already completed for this business date.';
  end if;

  select * into v_row
  from public.night_audits
  where property_id = p_property_id and business_date = v_date
  for update;

  select count(*) into v_open_shifts
  from public.cashier_shifts
  where property_id = p_property_id and status = 'open';
  if v_open_shifts > 0 then
    raise exception 'Close all cashier shifts before running night audit.';
  end if;

  select count(*) into v_pending
  from public.cashier_adjustments
  where property_id = p_property_id and status = 'pending';
  if v_pending > 0 then
    raise exception 'Resolve all pending cashier adjustments before night audit.';
  end if;

  v_snapshot := public.fn_phase4c_reconciliation_snapshot(p_property_id, v_date);
  v_blocked := (v_snapshot ->> 'blocking_variance')::boolean;
  v_has_override := public.fn_phase4c_night_audit_override(p_property_id, p_override_grant_id);

  v_values := jsonb_build_object(
    'request_key', v_request_key,
    'request_fingerprint', v_fingerprint,
    'reconciliation_snapshot', v_snapshot,
    'notes', p_notes,
    'started_by', auth.uid(),
    'completed_at', now()
  );

  if v_blocked and not v_has_override then
    if v_row.id is not null then
      update public.night_audits
      set status = 'failed',
          request_key = v_request_key,
          request_fingerprint = v_fingerprint,
          reconciliation_snapshot = v_snapshot,
          notes = p_notes,
          started_by = auth.uid(),
          completed_at = now(),
          override_by = null,
          override_at = null,
          override_reason = null,
          override_grant_id = null
      where id = v_row.id
      returning * into v_result;
    else
      insert into public.night_audits(
        property_id, business_date, next_business_date, status, started_by,
        request_key, request_fingerprint, reconciliation_snapshot, notes, completed_at
      )
      values (
        p_property_id, v_date, v_date + 1, 'failed', auth.uid(),
        v_request_key, v_fingerprint, v_snapshot, p_notes, now()
      )
      returning * into v_result;
    end if;

    insert into public.audit_logs(actor_id, property_id, action, new_value, entity_type, entity_id)
    values (
      auth.uid(), p_property_id, 'night_audit_failed',
      v_values || jsonb_build_object(
        'business_date', v_date,
        'reason', v_snapshot ->> 'blocking_reason',
        'night_audit_id', v_result.id
      ),
      'night_audit', v_result.id
    );

    return v_result;
  end if;

  if v_blocked and v_has_override
     and nullif(btrim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'An override reason is required for a blocked night audit.' using errcode = '22023';
  end if;

  v_next := v_date + 1;
  v_values := v_values || jsonb_build_object(
    'business_date', v_date,
    'next_business_date', v_next,
    'status', 'closed',
    'override_by', case when v_blocked then auth.uid() else null end,
    'override_at', case when v_blocked then now() else null end,
    'override_reason', case when v_blocked then btrim(p_override_reason) else null end,
    'override_grant_id', case when v_blocked then p_override_grant_id else null end,
    'total_revenue', (v_snapshot ->> 'pos_posted_total')::numeric + (v_snapshot ->> 'room_folio_revenue')::numeric,
    'cash_revenue', (v_snapshot ->> 'cash_revenue')::numeric,
    'card_revenue', (v_snapshot ->> 'card_revenue')::numeric,
    'mpesa_revenue', (v_snapshot ->> 'mpesa_revenue')::numeric,
    'room_revenue', (v_snapshot ->> 'room_folio_revenue')::numeric,
    'refunds', (v_snapshot ->> 'refunds')::numeric,
    'voids', (v_snapshot ->> 'voids_excluded')::numeric,
    'discounts', (v_snapshot ->> 'discounts')::numeric,
    'transaction_count', (v_snapshot ->> 'posted_receipt_count')::integer,
    'cashier_variance', (v_snapshot ->> 'cashier_variance')::numeric
  );

  if v_row.id is not null then
    update public.night_audits
    set status = 'closed',
        next_business_date = v_next,
        started_at = now(),
        completed_at = now(),
        started_by = auth.uid(),
        total_revenue = (v_values ->> 'total_revenue')::numeric,
        cash_revenue = (v_values ->> 'cash_revenue')::numeric,
        card_revenue = (v_values ->> 'card_revenue')::numeric,
        mpesa_revenue = (v_values ->> 'mpesa_revenue')::numeric,
        room_revenue = (v_values ->> 'room_revenue')::numeric,
        refunds = (v_values ->> 'refunds')::numeric,
        voids = (v_values ->> 'voids')::numeric,
        discounts = (v_values ->> 'discounts')::numeric,
        transaction_count = (v_values ->> 'transaction_count')::integer,
        cashier_variance = (v_values ->> 'cashier_variance')::numeric,
        notes = p_notes,
        request_key = v_request_key,
        request_fingerprint = v_fingerprint,
        reconciliation_snapshot = v_snapshot,
        override_by = (v_values ->> 'override_by')::uuid,
        override_at = (v_values ->> 'override_at')::timestamptz,
        override_reason = v_values ->> 'override_reason',
        override_grant_id = (v_values ->> 'override_grant_id')::uuid
    where id = v_row.id
    returning * into v_result;
  else
    insert into public.night_audits(
      property_id, business_date, next_business_date, status, started_by,
      total_revenue, cash_revenue, card_revenue, mpesa_revenue, room_revenue,
      refunds, voids, discounts, transaction_count, cashier_variance, notes,
      request_key, request_fingerprint, reconciliation_snapshot,
      override_by, override_at, override_reason, override_grant_id, completed_at
    )
    values (
      p_property_id, v_date, v_next, 'closed', auth.uid(),
      (v_values ->> 'total_revenue')::numeric,
      (v_values ->> 'cash_revenue')::numeric,
      (v_values ->> 'card_revenue')::numeric,
      (v_values ->> 'mpesa_revenue')::numeric,
      (v_values ->> 'room_revenue')::numeric,
      (v_values ->> 'refunds')::numeric,
      (v_values ->> 'voids')::numeric,
      (v_values ->> 'discounts')::numeric,
      (v_values ->> 'transaction_count')::integer,
      (v_values ->> 'cashier_variance')::numeric,
      p_notes, v_request_key, v_fingerprint, v_snapshot,
      (v_values ->> 'override_by')::uuid,
      (v_values ->> 'override_at')::timestamptz,
      v_values ->> 'override_reason',
      (v_values ->> 'override_grant_id')::uuid,
      now()
    )
    returning * into v_result;
  end if;

  update public.property_business_dates
  set business_date = v_next, updated_at = now()
  where property_id = p_property_id;

  insert into public.audit_logs(actor_id, property_id, action, new_value, entity_type, entity_id)
  values (
    auth.uid(), p_property_id, 'night_audit_closed',
    v_values || jsonb_build_object('night_audit_id', v_result.id),
    'night_audit', v_result.id
  );

  if v_blocked then
    insert into public.audit_logs(actor_id, property_id, action, new_value, entity_type, entity_id)
    values (
      auth.uid(), p_property_id, 'night_audit_variance_override',
      jsonb_build_object(
        'night_audit_id', v_result.id,
        'business_date', v_date,
        'reason', btrim(p_override_reason),
        'grant_id', p_override_grant_id,
        'blocking_reason', v_snapshot ->> 'blocking_reason'
      ),
      'night_audit', v_result.id
    );
  end if;

  return v_result;
end;
$function$;

revoke all on function public.fn_phase4c_run_night_audit(uuid, text, date, text, text, uuid) from public, anon;
grant execute on function public.fn_phase4c_run_night_audit(uuid, text, date, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Compatibility wrapper for existing clients
-- ---------------------------------------------------------------------------

create or replace function public.fn_run_night_audit(p_property_id uuid, p_notes text default null)
returns public.night_audits
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_request_key text;
begin
  if not public.fn_phase4c_night_audit_permission(p_property_id) then
    raise exception 'Missing employee permission: nightaudit.run';
  end if;

  -- The legacy signature has no request key. Derive a stable per-property,
  -- per-actor and per-notes key so an ambiguous retry after the business date
  -- has advanced still replays the original close. A caller that needs to close
  -- two days with identical notes must use the canonical request-key RPC.
  v_request_key := 'legacy-' || md5(concat_ws('|',
    p_property_id::text,
    coalesce(p_notes, ''),
    coalesce(auth.uid()::text, '')
  ));

  return public.fn_phase4c_run_night_audit(
    p_property_id,
    v_request_key,
    null,
    p_notes
  );
end;
$function$;

revoke all on function public.fn_run_night_audit(uuid, text) from public, anon;
grant execute on function public.fn_run_night_audit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Accommodation posting: forward-correct closed-date and permission check
-- ---------------------------------------------------------------------------

create or replace function public.fn_post_accommodation_charges(
  p_property_id uuid,
  p_business_date date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  r public.reservations;
  v_business_date date;
  v_nights integer;
  v_rate numeric;
  v_board_amount numeric;
  v_room_number text;
  v_board_label text;
  v_posted integer := 0;
  v_supplements integer := 0;
  v_skipped integer := 0;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Access denied.';
  end if;
  if not public.fn_phase4c_night_audit_permission(p_property_id) then
    raise exception 'Night audit permission is required to post accommodation.';
  end if;

  v_business_date := coalesce(p_business_date, public.fn_current_business_date(p_property_id));
  if v_business_date > public.fn_current_business_date(p_property_id) then
    raise exception 'Accommodation cannot be posted for a future business date.';
  end if;

  -- A failed close is an investigation state, not a closed financial boundary.
  if exists (
    select 1 from public.night_audits
     where property_id = p_property_id
       and business_date = v_business_date
       and status = 'closed'
  ) then
    raise exception 'Business date % is closed; accommodation cannot be posted.', v_business_date;
  end if;

  for r in
    select res.* from public.reservations res
     where res.property_id = p_property_id
       and res.status in ('checked-in', 'booked', 'confirmed')
       and res.arrival <= v_business_date
       and res.departure > v_business_date
     order by res.arrival, res.id
  loop
    v_nights := greatest(1, r.departure - r.arrival);
    v_rate := coalesce(nullif(r.rate, 0), round(coalesce(r.total_amount, 0) / v_nights, 2));
    if v_rate is null or v_rate <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select rm.number::text into v_room_number from public.rooms rm where rm.id = r.room_id;

    if not exists (
      select 1 from public.folio_charges f
       where f.property_id = p_property_id
         and f.idempotency_key = 'night:' || r.id::text || ':' || v_business_date::text
    ) then
      perform public.fn_post_folio_charge(
        p_property_id, r.id, 'accommodation',
        'Accommodation ' || v_business_date::text || ' · Room ' || coalesce(v_room_number, '—'),
        1, v_rate, v_room_number,
        'night:' || r.id::text || ':' || v_business_date::text
      );
      v_posted := v_posted + 1;
    end if;

    v_board_amount := null;
    select bs.nightly_amount into v_board_amount
      from public.board_supplements bs
     where bs.property_id = p_property_id
       and bs.meal_plan = r.meal_plan
       and bs.active
       and (bs.room_type_id is null
            or bs.room_type_id = (select rm.room_type_id from public.rooms rm where rm.id = r.room_id))
     order by bs.room_type_id nulls last
     limit 1;

    if coalesce(v_board_amount, 0) > 0 then
      v_board_label := case r.meal_plan
        when 'bb' then 'Bed & breakfast'
        when 'half_board' then 'Half board'
        when 'full_board' then 'Full board'
        else 'Board'
      end;
      if not exists (
        select 1 from public.folio_charges f
         where f.property_id = p_property_id
           and f.idempotency_key = 'night-board:' || r.id::text || ':' || v_business_date::text
      ) then
        perform public.fn_post_folio_charge(
          p_property_id, r.id, 'accommodation',
          v_board_label || ' supplement ' || v_business_date::text || ' · Room ' || coalesce(v_room_number, '—'),
          1, v_board_amount, v_room_number,
          'night-board:' || r.id::text || ':' || v_business_date::text
        );
        v_supplements := v_supplements + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'businessDate', v_business_date,
    'accommodationPosted', v_posted,
    'boardSupplementsPosted', v_supplements,
    'skippedWithoutRate', v_skipped
  );
end;
$function$;

revoke all on function public.fn_post_accommodation_charges(uuid, date) from public, anon;
grant execute on function public.fn_post_accommodation_charges(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Built-in role template reconciliation (no employee reassignment)
-- ---------------------------------------------------------------------------

do $phase4c_roles$
declare
  v_property record;
  v_before text[];
  v_after text[];
begin
  for v_property in select id from public.properties loop
    select permission_codes into v_before
    from public.employee_roles
    where property_id = v_property.id
      and name = 'Property Manager'
      and is_system = true;

    if found and not coalesce(v_before, '{}'::text[]) @> array['nightaudit.run']::text[] then
      v_after := coalesce(v_before, '{}'::text[]) || array['nightaudit.run']::text[];

      update public.employee_roles
      set permission_codes = v_after, updated_at = now()
      where property_id = v_property.id
        and name = 'Property Manager'
        and is_system = true;

      insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
      values (
        null, 'phase4c_role_template_reconciled', v_property.id,
        jsonb_build_object('name', 'Property Manager', 'permission_codes', to_jsonb(v_before)),
        jsonb_build_object('name', 'Property Manager', 'permission_codes', to_jsonb(v_after))
      );
    end if;
  end loop;
end;
$phase4c_roles$;

create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id, 'Cashier', 'pos',
      array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']::text[],
      'POS cashier workspace', true),
    (p_property_id, 'Waiter', 'pos',
      array['pos.access','pos.open_shift','pos.process_sale']::text[],
      'Restaurant waiter workspace', true),
    (p_property_id, 'Storekeeper', 'store', public.fn_phase3_stores_role_codes('storekeeper'),
      'Issues and receives stock. Cannot approve requisitions, see costs or manage cost centres.', true),
    (p_property_id, 'Store Manager', 'store', public.fn_phase3_stores_role_codes('store_manager'),
      'Full Stores supervision, including approvals, costs and cost centres.', true),
    (p_property_id, 'Department Requester', 'store',
      array['stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive']::text[],
      'Requests stock for a department and confirms receipt.', true),
    (p_property_id, 'Receptionist', 'frontoffice',
      array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment']::text[],
      'Front Office workspace', true),
    (p_property_id, 'Accountant', 'backoffice',
      array['back_office.access','back_office.reports.view','back_office.billing.manage','stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view']::text[],
      'Financial reports, accounting and cost visibility.', true),
    (p_property_id, 'Auditor', 'backoffice',
      array['back_office.access','back_office.reports.view','stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view']::text[],
      'Read-only operational and cost reporting; no billing or stock writes.', true),
    (p_property_id, 'Property Manager', 'backoffice',
      array['back_office.access','back_office.reports.view','back_office.employees.manage','back_office.settings.manage','pos.access','front_office.access','stores.access','nightaudit.run']::text[],
      'Assigned management modules, including Night Audit.', true)
  on conflict (property_id, name) do nothing;
end;
$function$;

notify pgrst, 'reload schema';
