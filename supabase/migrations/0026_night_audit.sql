-- OliTechs PMS/POS v2 — business date, night audit and daily reconciliation

create table if not exists public.property_business_dates (
  property_id uuid primary key references public.properties(id) on delete cascade,
  business_date date not null default (now() at time zone 'Africa/Nairobi')::date,
  updated_at timestamptz not null default now()
);

create table if not exists public.night_audits (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  business_date date not null,
  next_business_date date not null,
  status text not null default 'closed' check (status in ('closed','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  started_by uuid not null references auth.users(id),
  total_revenue numeric(12,2) not null default 0,
  cash_revenue numeric(12,2) not null default 0,
  card_revenue numeric(12,2) not null default 0,
  mpesa_revenue numeric(12,2) not null default 0,
  room_revenue numeric(12,2) not null default 0,
  refunds numeric(12,2) not null default 0,
  voids numeric(12,2) not null default 0,
  discounts numeric(12,2) not null default 0,
  transaction_count integer not null default 0,
  cashier_variance numeric(12,2) not null default 0,
  notes text,
  unique(property_id, business_date)
);

create index if not exists night_audits_property_date_idx
  on public.night_audits(property_id, business_date desc);

alter table public.property_business_dates enable row level security;
alter table public.night_audits enable row level security;

drop policy if exists property_business_dates_select on public.property_business_dates;
create policy property_business_dates_select on public.property_business_dates
for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists night_audits_select on public.night_audits;
create policy night_audits_select on public.night_audits
for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_get_business_date(p_property_id uuid)
returns date
language plpgsql security definer set search_path=public
as $$
declare v_date date;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  select business_date into v_date from public.property_business_dates where property_id=p_property_id;
  if v_date is null then
    v_date := (now() at time zone 'Africa/Nairobi')::date;
    insert into public.property_business_dates(property_id,business_date)
    values(p_property_id,v_date)
    on conflict(property_id) do nothing;
  end if;
  return v_date;
end;
$$;
grant execute on function public.fn_get_business_date(uuid) to authenticated;

create or replace function public.fn_night_audit_precheck(p_property_id uuid, p_business_date date)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_open_shifts integer;
  v_pending integer;
  v_tx integer;
  v_revenue numeric;
begin
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')) then
    raise exception 'Manager access required.';
  end if;

  select count(*) into v_open_shifts from public.cashier_shifts where property_id=p_property_id and status='open';
  select count(*) into v_pending from public.cashier_adjustments where property_id=p_property_id and status='pending';

  select count(*), coalesce(sum(total),0)
    into v_tx,v_revenue
    from public.pos_receipts
    where property_id=p_property_id
      and status='posted'
      and (created_at at time zone 'Africa/Nairobi')::date=p_business_date;

  return jsonb_build_object(
    'business_date',p_business_date,
    'open_cashier_shifts',v_open_shifts,
    'pending_adjustments',v_pending,
    'transactions',v_tx,
    'revenue',v_revenue,
    'ready',v_open_shifts=0 and v_pending=0
  );
end;
$$;
grant execute on function public.fn_night_audit_precheck(uuid,date) to authenticated;

create or replace function public.fn_run_night_audit(
  p_property_id uuid,
  p_notes text default null
) returns public.night_audits
language plpgsql security definer set search_path=public
as $$
declare
  v_audit public.night_audits;
  v_date date;
  v_next date;
  v_open_shifts integer;
  v_pending integer;
  v_cash numeric := 0;
  v_card numeric := 0;
  v_mpesa numeric := 0;
  v_room numeric := 0;
  v_total numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_discounts numeric := 0;
  v_count integer := 0;
  v_variance numeric := 0;
begin
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')) then
    raise exception 'Manager access required.';
  end if;

  select business_date into v_date from public.property_business_dates where property_id=p_property_id for update;
  if v_date is null then
    v_date := (now() at time zone 'Africa/Nairobi')::date;
    insert into public.property_business_dates(property_id,business_date)
    values(p_property_id,v_date)
    on conflict(property_id) do nothing;
  end if;

  if exists(select 1 from public.night_audits where property_id=p_property_id and business_date=v_date and status='closed') then
    raise exception 'Night audit already completed for this business date.';
  end if;

  select count(*) into v_open_shifts from public.cashier_shifts where property_id=p_property_id and status='open';
  if v_open_shifts > 0 then raise exception 'Close all cashier shifts before running night audit.'; end if;

  select count(*) into v_pending from public.cashier_adjustments where property_id=p_property_id and status='pending';
  if v_pending > 0 then raise exception 'Resolve all pending cashier adjustments before night audit.'; end if;

  select
    coalesce(sum(case when payment_method='cash' then total else 0 end),0),
    coalesce(sum(case when payment_method='card' then total else 0 end),0),
    coalesce(sum(case when payment_method='mpesa' then total else 0 end),0),
    coalesce(sum(case when payment_method='room' then total else 0 end),0),
    coalesce(sum(total),0),
    count(*)
  into v_cash,v_card,v_mpesa,v_room,v_total,v_count
  from public.pos_receipts
  where property_id=p_property_id and status='posted'
    and (created_at at time zone 'Africa/Nairobi')::date=v_date;

  select coalesce(sum(case when adjustment_type='refund' then amount else 0 end),0),
         coalesce(sum(case when adjustment_type='void' then amount else 0 end),0),
         coalesce(sum(case when adjustment_type='discount' then amount else 0 end),0)
  into v_refunds,v_voids,v_discounts
  from public.cashier_adjustments
  where property_id=p_property_id and status='approved'
    and (created_at at time zone 'Africa/Nairobi')::date=v_date;

  select coalesce(sum(variance),0) into v_variance
  from public.cashier_shifts
  where property_id=p_property_id and status='closed'
    and (closed_at at time zone 'Africa/Nairobi')::date=v_date;

  v_next := v_date + 1;

  insert into public.night_audits(
    property_id,business_date,next_business_date,status,started_by,total_revenue,cash_revenue,
    card_revenue,mpesa_revenue,room_revenue,refunds,voids,discounts,transaction_count,
    cashier_variance,notes
  ) values(
    p_property_id,v_date,v_next,'closed',auth.uid(),v_total,v_cash,v_card,v_mpesa,v_room,
    v_refunds,v_voids,v_discounts,v_count,v_variance,p_notes
  ) returning * into v_audit;

  update public.property_business_dates
  set business_date=v_next,updated_at=now()
  where property_id=p_property_id;

  return v_audit;
end;
$$;
grant execute on function public.fn_run_night_audit(uuid,text) to authenticated;

create or replace function public.fn_night_audit_history(p_property_id uuid)
returns setof public.night_audits
language sql security definer set search_path=public
as $$
  select * from public.night_audits
  where property_id=p_property_id
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by business_date desc
  limit 90;
$$;
grant execute on function public.fn_night_audit_history(uuid) to authenticated;

notify pgrst,'reload schema';
