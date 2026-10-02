-- OliTechs PMS/POS — Phase 2F open-check settlement integrity
-- Adds atomic settlement, persisted payment allocations and table-session linkage.
-- Existing POS/KDS/printer/PMS workflows remain intact.

alter table public.pos_receipts
  add column if not exists table_session_id uuid references public.pos_table_sessions(id) on delete set null;

create unique index if not exists pos_receipts_table_session_unique
  on public.pos_receipts(table_session_id)
  where table_session_id is not null;

alter table public.pos_receipts
  drop constraint if exists pos_receipts_payment_method_check;

alter table public.pos_receipts
  add constraint pos_receipts_payment_method_check
  check (payment_method in ('cash','card','mpesa','room','split'));

create table if not exists public.pos_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  pos_receipt_id uuid not null references public.pos_receipts(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  method text not null check (method in ('cash','card','mpesa','room')),
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_payment_allocations_property_idx
  on public.pos_payment_allocations(property_id, created_at desc);
create index if not exists pos_payment_allocations_receipt_idx
  on public.pos_payment_allocations(pos_receipt_id);

create table if not exists public.pos_check_audit_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_session_id uuid references public.pos_table_sessions(id) on delete set null,
  pos_receipt_id uuid references public.pos_receipts(id) on delete set null,
  event_type text not null check (event_type in ('opened','items_added','round_fired','bill_printed','settled','reopened','voided')),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_check_audit_property_idx
  on public.pos_check_audit_events(property_id, created_at desc);
create index if not exists pos_check_audit_session_idx
  on public.pos_check_audit_events(table_session_id, created_at desc);

alter table public.pos_check_audit_events enable row level security;

drop policy if exists pos_check_audit_select on public.pos_check_audit_events;
create policy pos_check_audit_select
  on public.pos_check_audit_events for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

alter table public.pos_payment_allocations enable row level security;

drop policy if exists pos_payment_allocations_select on public.pos_payment_allocations;
create policy pos_payment_allocations_select
  on public.pos_payment_allocations for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_payment_allocations_insert on public.pos_payment_allocations;
create policy pos_payment_allocations_insert
  on public.pos_payment_allocations for insert
  with check (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_settle_pos_table_session(
  p_property_id uuid,
  p_table_session_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_allocations jsonb
) returns public.pos_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.pos_table_sessions;
  v_receipt public.pos_receipts;
  v_shift_id uuid;
  v_reservation public.reservations;
  v_folio_charge_id uuid;
  v_room_number text;
  v_method text;
  v_allocation jsonb;
  v_amount numeric;
  v_sum numeric := 0;
  v_session_subtotal numeric := 0;
  v_expected_vat numeric := 0;
  v_allocation_count integer := 0;
  v_room_count integer := 0;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  if p_total <= 0 then
    raise exception 'Total must be greater than zero.';
  end if;

  select * into v_session
  from public.pos_table_sessions
  where id = p_table_session_id
    and property_id = p_property_id
  for update;

  if v_session.id is null then
    raise exception 'Open table session not found.';
  end if;

  select coalesce(sum(
    coalesce((line->>'price')::numeric, 0) * coalesce((line->>'qty')::numeric, 0)
  ), 0)
    into v_session_subtotal
  from jsonb_array_elements(coalesce(v_session.order_lines, '[]'::jsonb)) line;

  if abs(round(coalesce(p_subtotal,0),2) - round(v_session_subtotal,2)) > 0.009 then
    raise exception 'Settlement subtotal does not match the persisted open check.';
  end if;

  if coalesce(p_discount_amount,0) < 0 or coalesce(p_discount_amount,0) > v_session_subtotal then
    raise exception 'Invalid discount amount.';
  end if;

  v_expected_vat := round((v_session_subtotal - coalesce(p_discount_amount,0)) * 0.16, 2);
  if abs(round(coalesce(p_vat,0),2) - v_expected_vat) > 0.009 then
    raise exception 'Settlement VAT does not match the current tax calculation.';
  end if;

  if abs(round(p_total,2) - round(v_session_subtotal - coalesce(p_discount_amount,0) + coalesce(p_vat,0),2)) > 0.009 then
    raise exception 'Settlement total does not match the persisted open check.';
  end if;




-- Reconcile split-payment allocations in cashier shift controls.
create or replace function public.fn_close_cashier_shift(
  p_shift_id uuid,
  p_closing_cash_count numeric,
  p_notes text default null
) returns public.cashier_shifts
language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.cashier_shifts;
  v_cash_sales numeric := 0;
  v_cash_payments numeric := 0;
  v_refunds numeric := 0;
begin
  if p_closing_cash_count < 0 then raise exception 'Closing cash count cannot be negative.'; end if;

  select * into v_shift from public.cashier_shifts where id = p_shift_id for update;
  if v_shift.id is null then raise exception 'Cashier shift not found.'; end if;
  if not (
    public.is_platform_owner()
    or v_shift.opened_by = auth.uid()
    or public.property_role(v_shift.property_id) in ('owner','admin','manager')
    or public.current_staff_role(v_shift.property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then raise exception 'Not allowed.'; end if;
  if v_shift.status <> 'open' then raise exception 'Cashier shift is already closed.'; end if;

  select coalesce(sum(a.amount),0) into v_cash_sales
  from public.pos_payment_allocations a
  join public.pos_receipts r on r.id = a.pos_receipt_id
  where r.shift_id = p_shift_id and r.status = 'posted' and a.method = 'cash';

  select coalesce(sum(r.total),0) into v_cash_sales
  from public.pos_receipts r
  where r.shift_id = p_shift_id
    and r.payment_method = 'cash'
    and r.status = 'posted'
    and not exists (select 1 from public.pos_payment_allocations a where a.pos_receipt_id = r.id);

  select coalesce(sum(amount),0) into v_cash_payments
  from public.payments
  where shift_id = p_shift_id and method = 'cash' and status = 'posted';

  select coalesce(sum(amount),0) into v_refunds
  from public.cashier_adjustments
  where shift_id = p_shift_id and adjustment_type = 'refund' and status = 'approved';

  v_shift.expected_cash := v_shift.opening_float + v_cash_sales + v_cash_payments - v_refunds;
  v_shift.closing_cash_count := p_closing_cash_count;
  v_shift.variance := p_closing_cash_count - v_shift.expected_cash;
  v_shift.status := 'closed';
  v_shift.closed_at := now();
  v_shift.closing_notes := p_notes;

  update public.cashier_shifts set
    expected_cash = v_shift.expected_cash,
    closing_cash_count = v_shift.closing_cash_count,
    variance = v_shift.variance,
    status = 'closed',
    closed_at = v_shift.closed_at,
    closing_notes = v_shift.closing_notes
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;
grant execute on function public.fn_close_cashier_shift(uuid,numeric,text) to authenticated;

create or replace function public.fn_cashier_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_property uuid;
  v_opening numeric := 0;
  v_cash numeric := 0;
  v_card numeric := 0;
  v_mpesa numeric := 0;
  v_room numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_discounts numeric := 0;
  v_expected numeric := 0;
begin
  select property_id, opening_float into v_property, v_opening from public.cashier_shifts where id = p_shift_id;
  if v_property is null then raise exception 'Cashier shift not found.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(v_property) in ('owner','admin','manager')
    or public.current_staff_role(v_property) in ('hotel_admin','super_admin','cashier','fb_manager')
  ) then raise exception 'Not allowed.'; end if;

  select
    coalesce(sum(case when a.method='cash' then a.amount else 0 end),0),
    coalesce(sum(case when a.method='card' then a.amount else 0 end),0),
    coalesce(sum(case when a.method='mpesa' then a.amount else 0 end),0),
    coalesce(sum(case when a.method='room' then a.amount else 0 end),0)
  into v_cash, v_card, v_mpesa, v_room
  from public.pos_payment_allocations a
  join public.pos_receipts r on r.id=a.pos_receipt_id
  where r.shift_id=p_shift_id and r.status='posted';

  select
    v_cash + coalesce(sum(case when r.payment_method='cash' then r.total else 0 end),0),
    v_card + coalesce(sum(case when r.payment_method='card' then r.total else 0 end),0),
    v_mpesa + coalesce(sum(case when r.payment_method='mpesa' then r.total else 0 end),0),
    v_room + coalesce(sum(case when r.payment_method='room' then r.total else 0 end),0)
  into v_cash, v_card, v_mpesa, v_room
  from public.pos_receipts r
  where r.shift_id=p_shift_id and r.status='posted'
    and not exists (select 1 from public.pos_payment_allocations a where a.pos_receipt_id=r.id);

  select coalesce(sum(amount),0) into v_refunds from public.cashier_adjustments where shift_id=p_shift_id and adjustment_type='refund' and status='approved';
  select coalesce(sum(amount),0) into v_voids from public.cashier_adjustments where shift_id=p_shift_id and adjustment_type='void' and status='approved';
  select coalesce(sum(amount),0) into v_discounts from public.cashier_adjustments where shift_id=p_shift_id and adjustment_type='discount' and status='approved';

  v_expected := v_opening + v_cash - v_refunds;

  return jsonb_build_object(
    'shift_id', p_shift_id,
    'opening_float', v_opening,
    'cash_sales', v_cash,
    'card_sales', v_card,
    'mpesa_sales', v_mpesa,
    'room_charges', v_room,
    'refunds', v_refunds,
    'voids', v_voids,
    'discounts', v_discounts,
    'expected_cash', v_expected
  );
end;
$$;
grant execute on function public.fn_cashier_shift_summary(uuid) to authenticated;

-- Reconcile split-payment allocations in daily POS payment reporting.
create or replace function public.fn_daily_pos_summary(
  p_property_id uuid,
  p_business_date date default (now() at time zone 'Africa/Nairobi')::date
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_total numeric(12,2) := 0;
  v_transactions integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_hourly jsonb := '[]'::jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  select coalesce(sum(total), 0), count(*)::integer
  into v_total, v_transactions
  from public.pos_receipts
  where property_id = p_property_id
    and status = 'posted'
    and (created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  select coalesce(jsonb_agg(row_to_json(x) order by x.amount desc), '[]'::jsonb)
  into v_payments
  from (
    with payment_rows as (
      select a.pos_receipt_id, a.method, a.amount
      from public.pos_payment_allocations a
      join public.pos_receipts r on r.id=a.pos_receipt_id
      where r.property_id=p_property_id and r.status='posted'
        and (r.created_at at time zone 'Africa/Nairobi')::date=p_business_date
      union all
      select r.id, r.payment_method, r.total
      from public.pos_receipts r
      where r.property_id=p_property_id and r.status='posted'
        and (r.payment_method <> 'split')
        and (r.created_at at time zone 'Africa/Nairobi')::date=p_business_date
        and not exists (select 1 from public.pos_payment_allocations a where a.pos_receipt_id=r.id)
    )
    select method, count(distinct pos_receipt_id)::integer as transactions, round(sum(amount),2) as amount
    from payment_rows
    group by method
  ) x;

  with expanded as (
    select
      coalesce(nullif(item->>'name', ''), 'Unnamed item') as name,
      coalesce((item->>'qty')::numeric, 0) as qty,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'total')::numeric, 0) as item_total
    from public.pos_receipts r
    cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) item
    where r.property_id = p_property_id and r.status='posted'
      and (r.created_at at time zone 'Africa/Nairobi')::date=p_business_date
  ),
  normalized as (
    select name,
      sum(case when qty > 0 then qty when quantity > 0 then quantity else 1 end) as qty,
      sum(case when item_total > 0 then item_total when price > 0 then price * case when qty > 0 then qty when quantity > 0 then quantity else 1 end else 0 end) as revenue
    from expanded group by name
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.revenue desc), '[]'::jsonb)
  into v_items
  from (
    select name, round(qty,2) as qty, round(revenue,2) as revenue
    from normalized order by revenue desc limit 10
  ) x;

  select coalesce(jsonb_agg(row_to_json(x) order by x.hour), '[]'::jsonb)
  into v_hourly
  from (
    select extract(hour from (created_at at time zone 'Africa/Nairobi'))::integer as hour,
      round(sum(total),2) as revenue, count(*)::integer as transactions
    from public.pos_receipts
    where property_id=p_property_id and status='posted'
      and (created_at at time zone 'Africa/Nairobi')::date=p_business_date
    group by extract(hour from (created_at at time zone 'Africa/Nairobi'))
    order by hour
  ) x;

  return jsonb_build_object(
    'business_date', p_business_date,
    'total_revenue', v_total,
    'transactions', v_transactions,
    'average_check', case when v_transactions>0 then round(v_total/v_transactions,2) else 0 end,
    'payment_breakdown', v_payments,
    'top_items', v_items,
    'hourly_revenue', v_hourly
  );
end;
$$;
grant execute on function public.fn_daily_pos_summary(uuid,date) to authenticated;

notify pgrst, 'reload schema';
