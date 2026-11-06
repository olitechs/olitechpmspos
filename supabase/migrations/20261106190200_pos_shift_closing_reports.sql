-- POS shift opening/closing, active-table protection and accurate sales summaries.
alter table public.pos_receipts
  add column if not exists covers integer not null default 1
  check (covers between 1 and 1000);

alter table public.pos_shifts
  add column if not exists counted_cash numeric(12,2),
  add column if not exists cash_variance numeric(12,2),
  add column if not exists gross_sales numeric(12,2) not null default 0,
  add column if not exists refunds_total numeric(12,2) not null default 0,
  add column if not exists voided_total numeric(12,2) not null default 0,
  add column if not exists total_sales numeric(12,2) not null default 0,
  add column if not exists total_receipts integer not null default 0,
  add column if not exists total_covers integer not null default 0;

-- Persist guest covers with the receipt without rewriting the existing sale ledger function.
drop function if exists public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb
);

create or replace function public.fn_record_pos_sale_with_vat_snapshot(
  p_property_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_reservation_id uuid default null,
  p_shift_id uuid default null,
  p_waiter text default null,
  p_discount_id uuid default null,
  p_discount_name text default null,
  p_idempotency_key text default null,
  p_payment_allocations jsonb default null,
  p_vat_snapshot jsonb default null,
  p_covers integer default 1
)
returns public.pos_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if p_covers is null or p_covers < 1 or p_covers > 1000 then
    raise exception 'Guest covers must be between 1 and 1000.';
  end if;

  v_receipt := public.fn_record_pos_sale(
    p_property_id, p_table_number, p_order_number, p_items, p_subtotal,
    p_discount_amount, p_vat, p_total, p_payment_method, p_reservation_id,
    p_shift_id, p_waiter, p_discount_id, p_discount_name,
    p_idempotency_key, p_payment_allocations
  );

  update public.pos_receipts
  set vat_snapshot = coalesce(vat_snapshot, p_vat_snapshot),
      covers = greatest(1, least(p_covers, 1000))
  where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, integer
) from public, anon;
grant execute on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, integer
) to authenticated;

-- Only one shift may be open for a property. Serialize concurrent shift opens.
create or replace function public.fn_open_pos_shift(
  p_property_id uuid,
  p_opening_cash numeric default 0,
  p_notes text default null
)
returns public.pos_shifts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shift public.pos_shifts;
  v_date date := (now() at time zone 'Africa/Nairobi')::date;
  v_seq integer;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_opening_cash < 0 then raise exception 'Opening cash cannot be negative.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff', 'fb_manager', 'receptionist', 'front_desk', 'manager', 'property_manager', 'general_manager')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
        and lower(coalesce(s.role, '')) in ('hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff', 'fb_manager', 'receptionist', 'front_desk', 'manager', 'property_manager', 'general_manager')
    )
  ) then raise exception 'Authorised POS staff access required to open a shift.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text, 0));
  if exists (
    select 1 from public.pos_shifts
    where property_id = p_property_id and status = 'open'
  ) then
    raise exception 'A POS shift is already open. Close the existing shift before opening another.';
  end if;

  select count(*) + 1 into v_seq
  from public.pos_shifts
  where property_id = p_property_id and date = v_date;

  insert into public.pos_shifts(property_id, shift_no, opened_by, opening_cash, date, notes)
  values (
    p_property_id,
    'SHIFT-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0'),
    auth.uid(),
    coalesce(p_opening_cash, 0),
    v_date,
    p_notes
  )
  returning * into v_shift;

  return v_shift;
end;
$$;

create or replace function public.fn_current_pos_shift(p_property_id uuid)
returns public.pos_shifts
language sql
security definer
set search_path = public, pg_temp
as $$
  select *
  from public.pos_shifts
  where property_id = p_property_id
    and status = 'open'
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by opened_at desc
  limit 1
$$;

revoke all on function public.fn_open_pos_shift(uuid, numeric, text) from public, anon;
revoke all on function public.fn_current_pos_shift(uuid) from public, anon;
grant execute on function public.fn_open_pos_shift(uuid, numeric, text) to authenticated;
grant execute on function public.fn_current_pos_shift(uuid) to authenticated;

-- Refuse to close until the entire floor is cleared. Reconcile split tender rows,
-- subtract refunds by their actual settlement method, and persist the full summary.
drop function if exists public.fn_close_pos_shift(uuid, numeric, text, boolean);
create or replace function public.fn_close_pos_shift(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_notes text default null,
  p_manager_approved boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shift public.pos_shifts;
  v_cash numeric := 0;
  v_mpesa numeric := 0;
  v_card numeric := 0;
  v_room numeric := 0;
  v_bank numeric := 0;
  v_other numeric := 0;
  v_cash_refund numeric := 0;
  v_mpesa_refund numeric := 0;
  v_card_refund numeric := 0;
  v_room_refund numeric := 0;
  v_bank_refund numeric := 0;
  v_other_refund numeric := 0;
  v_gross numeric := 0;
  v_refunds numeric := 0;
  v_voided numeric := 0;
  v_total numeric := 0;
  v_count integer := 0;
  v_covers integer := 0;
  v_expected numeric := 0;
  v_variance numeric := 0;
  v_open_tables text;
begin
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Counted cash cannot be negative.';
  end if;

  select * into v_shift
  from public.pos_shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then raise exception 'Shift not found.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(v_shift.property_id) in ('owner', 'admin', 'manager', 'cashier')
    or public.current_staff_role(v_shift.property_id) in ('hotel_admin', 'super_admin', 'cashier', 'fb_manager', 'manager', 'admin', 'owner', 'property_manager', 'general_manager')
    or exists (
      select 1 from public.staff s
      where s.property_id = v_shift.property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
        and lower(coalesce(s.role, '')) in ('hotel_admin', 'super_admin', 'cashier', 'fb_manager', 'manager', 'admin', 'owner', 'property_manager', 'general_manager')
    )
  ) then raise exception 'Only cashier, manager or admin can close a shift.'; end if;
  if v_shift.status <> 'open' then raise exception 'Shift is already closed.'; end if;

  select string_agg(
    'Table ' || coalesce(nullif(table_number, ''), table_key),
    ', ' order by table_number
  )
  into v_open_tables
  from public.pos_table_sessions
  where property_id = v_shift.property_id
    and status <> 'closed';

  if v_open_tables is not null then
    raise exception 'Cannot close the shift. Clear or settle these tables first: %', v_open_tables;
  end if;

  if exists (
    select 1
    from public.pos_receipts r
    left join (
      select receipt_id, sum(amount) as allocated_amount
      from public.pos_receipt_payments
      where property_id = v_shift.property_id
      group by receipt_id
    ) a on a.receipt_id = r.id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
      and abs(coalesce(a.allocated_amount, 0) - r.total) > 0.01
  ) then
    raise exception 'Cannot close the shift: one or more split-payment receipts do not reconcile to their receipt totals.';
  end if;

  with method_rows as (
    select r.id as receipt_id,
      case
        when r.payment_method in ('room', 'room_charge') then 'room_charge'
        when r.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then r.payment_method
        else 'other'
      end as payment_method,
      r.total as amount
    from public.pos_receipts r
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method <> 'split'
    union all
    select r.id as receipt_id,
      case
        when rp.payment_method in ('room', 'room_charge') then 'room_charge'
        when rp.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then rp.payment_method
        else 'other'
      end as payment_method,
      rp.amount
    from public.pos_receipts r
    join public.pos_receipt_payments rp
      on rp.receipt_id = r.id and rp.property_id = r.property_id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
  )
  select
    coalesce(sum(amount) filter (where payment_method = 'cash'), 0),
    coalesce(sum(amount) filter (where payment_method = 'mpesa'), 0),
    coalesce(sum(amount) filter (where payment_method = 'card'), 0),
    coalesce(sum(amount) filter (where payment_method = 'room_charge'), 0),
    coalesce(sum(amount) filter (where payment_method = 'bank'), 0),
    coalesce(sum(amount) filter (where payment_method = 'other'), 0)
  into v_cash, v_mpesa, v_card, v_room, v_bank, v_other
  from method_rows;

  select
    coalesce(sum(case when method_key = 'cash' then amount else 0 end), 0),
    coalesce(sum(case when method_key = 'mpesa' then amount else 0 end), 0),
    coalesce(sum(case when method_key = 'card' then amount else 0 end), 0),
    coalesce(sum(case when method_key = 'room_charge' then amount else 0 end), 0),
    coalesce(sum(case when method_key = 'bank' then amount else 0 end), 0),
    coalesce(sum(case when method_key = 'other' then amount else 0 end), 0)
  into v_cash_refund, v_mpesa_refund, v_card_refund, v_room_refund, v_bank_refund, v_other_refund
  from (
    select cr.amount,
      case
        when coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, '')) in ('room', 'room_charge') then 'room_charge'
        when coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, '')) in ('cash', 'mpesa', 'card', 'bank', 'other') then coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, ''))
        else 'other'
      end as method_key
    from public.cashier_refunds cr
    join public.pos_receipts r on r.id = cr.receipt_id and r.property_id = cr.property_id
    where cr.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
  ) refund_rows;

  select
    coalesce(sum(total) filter (where status = 'posted'), 0),
    coalesce(sum(total) filter (where status = 'voided'), 0),
    count(*) filter (where status = 'posted'),
    coalesce(sum(covers) filter (where status = 'posted'), 0)
  into v_gross, v_voided, v_count, v_covers
  from public.pos_receipts
  where property_id = v_shift.property_id
    and (pos_shift_id = p_shift_id or shift_id = p_shift_id);

  v_refunds := v_cash_refund + v_mpesa_refund + v_card_refund + v_room_refund + v_bank_refund + v_other_refund;
  v_cash := v_cash - v_cash_refund;
  v_mpesa := v_mpesa - v_mpesa_refund;
  v_card := v_card - v_card_refund;
  v_room := v_room - v_room_refund;
  v_bank := v_bank - v_bank_refund;
  v_other := v_other - v_other_refund;
  v_total := v_gross - v_refunds;

  if abs(v_total - (v_cash + v_mpesa + v_card + v_room + v_bank + v_other)) > 0.01 then
    raise exception 'Shift payment reconciliation failed. Review payment and refund allocations before closing.';
  end if;

  v_expected := v_shift.opening_cash + v_cash;
  v_variance := p_counted_cash - v_expected;

  if abs(v_variance) > 500 and (
    not p_manager_approved
    or not (
      public.is_platform_owner()
      or public.property_role(v_shift.property_id) in ('owner', 'admin', 'manager')
      or public.current_staff_role(v_shift.property_id) in ('hotel_admin', 'super_admin', 'fb_manager', 'manager', 'admin', 'owner', 'property_manager', 'general_manager')
    )
  ) then
    raise exception 'Manager approval is required for a cash variance above KES 500.';
  end if;

  update public.pos_shifts
  set closed_by = auth.uid(),
      closed_at = now(),
      status = 'closed',
      notes = coalesce(p_notes, notes),
      counted_cash = p_counted_cash,
      cash_variance = v_variance,
      gross_sales = v_gross,
      refunds_total = v_refunds,
      voided_total = v_voided,
      total_sales = v_total,
      total_receipts = v_count,
      total_covers = v_covers
  where id = p_shift_id
  returning * into v_shift;

  delete from public.pos_shift_payments where shift_id = p_shift_id;

  with method_rows as (
    select r.id as receipt_id,
      case
        when r.payment_method in ('room', 'room_charge') then 'room_charge'
        when r.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then r.payment_method
        else 'other'
      end as payment_method,
      r.total as amount
    from public.pos_receipts r
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method <> 'split'
    union all
    select r.id as receipt_id,
      case
        when rp.payment_method in ('room', 'room_charge') then 'room_charge'
        when rp.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then rp.payment_method
        else 'other'
      end as payment_method,
      rp.amount
    from public.pos_receipts r
    join public.pos_receipt_payments rp
      on rp.receipt_id = r.id and rp.property_id = r.property_id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
  ),
  refund_rows as (
    select
      case
        when coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, '')) in ('room', 'room_charge') then 'room_charge'
        when coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, '')) in ('cash', 'mpesa', 'card', 'bank', 'other') then coalesce(nullif(cr.settlement_method, ''), nullif(cr.method, ''))
        else 'other'
      end as payment_method,
      sum(cr.amount) as amount
    from public.cashier_refunds cr
    join public.pos_receipts r on r.id = cr.receipt_id and r.property_id = cr.property_id
    where cr.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
    group by 1
  ),
  gross_by_method as (
    select payment_method, sum(amount) as amount, count(distinct receipt_id) as transaction_count
    from method_rows group by payment_method
  ),
  methods(payment_method) as (
    values ('cash'), ('mpesa'), ('card'), ('bank'), ('room_charge'), ('other')
  )
  insert into public.pos_shift_payments(shift_id, payment_method, amount, transaction_count)
  select p_shift_id, methods.payment_method,
    coalesce(gross_by_method.amount, 0) - coalesce(refund_rows.amount, 0),
    coalesce(gross_by_method.transaction_count, 0)
  from methods
  left join gross_by_method using (payment_method)
  left join refund_rows using (payment_method);

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'opening_cash', v_shift.opening_cash,
    'gross_sales', v_gross,
    'refunds', v_refunds,
    'voided_value', v_voided,
    'cash', v_cash,
    'mpesa', v_mpesa,
    'card', v_card,
    'bank', v_bank,
    'room_charge', v_room,
    'other', v_other,
    'total_sales', v_total,
    'total_transactions', v_count,
    'total_covers', v_covers,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'variance', v_variance
  );
end;
$$;

revoke all on function public.fn_close_pos_shift(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.fn_close_pos_shift(uuid, numeric, text, boolean) to authenticated;

notify pgrst, 'reload schema';
