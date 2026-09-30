-- OliTechs PMS/POS v2 — cashier shifts, reconciliation and controlled adjustments

alter table public.pos_receipts
  add column if not exists status text not null default 'posted'
    check (status in ('posted','voided')),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

alter table public.payments
  add column if not exists status text not null default 'posted'
    check (status in ('posted','voided')),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

create table if not exists public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  opening_float numeric(12,2) not null default 0 check (opening_float >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closing_cash_count numeric(12,2),
  expected_cash numeric(12,2),
  variance numeric(12,2),
  closing_notes text
);
create index if not exists cashier_shifts_property_idx on public.cashier_shifts(property_id, opened_at desc);
create unique index if not exists cashier_shifts_open_user_idx
  on public.cashier_shifts(property_id, opened_by) where status = 'open';

alter table public.pos_receipts add column if not exists shift_id uuid references public.cashier_shifts(id) on delete set null;
alter table public.payments add column if not exists shift_id uuid references public.cashier_shifts(id) on delete set null;
create index if not exists pos_receipts_shift_idx on public.pos_receipts(shift_id, created_at desc);
create index if not exists payments_shift_idx on public.payments(shift_id, created_at desc);

create table if not exists public.cashier_adjustments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  shift_id uuid references public.cashier_shifts(id) on delete set null,
  adjustment_type text not null check (adjustment_type in ('refund','void','discount')),
  target_type text not null check (target_type in ('pos_receipt','payment')),
  target_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  status text not null default 'approved' check (status in ('approved','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists cashier_adjustments_property_idx on public.cashier_adjustments(property_id, created_at desc);
create index if not exists cashier_adjustments_target_idx on public.cashier_adjustments(target_type, target_id);

alter table public.cashier_shifts enable row level security;
alter table public.cashier_adjustments enable row level security;

drop policy if exists cashier_shifts_select on public.cashier_shifts;
create policy cashier_shifts_select on public.cashier_shifts for select using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager')
  or opened_by = auth.uid()
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')
);

drop policy if exists cashier_adjustments_select on public.cashier_adjustments;
create policy cashier_adjustments_select on public.cashier_adjustments for select using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')
);

create or replace function public.fn_open_cashier_shift(
  p_property_id uuid,
  p_opening_float numeric default 0
) returns public.cashier_shifts
language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.cashier_shifts;
  v_staff_id uuid;
  v_role text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if p_opening_float < 0 then raise exception 'Opening float cannot be negative.'; end if;

  v_role := public.current_staff_role(p_property_id);
  if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then
    raise exception 'Only authorised cashier staff can open a cashier shift.';
  end if;
  if v_role is null and not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can open a cashier shift.';
  end if;

  if exists (select 1 from public.cashier_shifts where property_id = p_property_id and opened_by = auth.uid() and status = 'open') then
    raise exception 'You already have an open cashier shift.';
  end if;

  v_staff_id := public.current_staff_id(p_property_id);
  insert into public.cashier_shifts(property_id, staff_id, opened_by, opening_float)
  values (p_property_id, v_staff_id, auth.uid(), p_opening_float)
  returning * into v_shift;
  return v_shift;
end;
$$;
grant execute on function public.fn_open_cashier_shift(uuid,numeric) to authenticated;

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

  select coalesce(sum(total),0) into v_cash_sales
  from public.pos_receipts
  where shift_id = p_shift_id and payment_method = 'cash' and status = 'posted';

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

create or replace function public.fn_record_cashier_adjustment(
  p_property_id uuid,
  p_shift_id uuid,
  p_adjustment_type text,
  p_target_type text,
  p_target_id uuid,
  p_amount numeric,
  p_reason text
) returns public.cashier_adjustments
language plpgsql security definer set search_path = public
as $$
declare
  v_adjustment public.cashier_adjustments;
  v_role text;
  v_property uuid;
  v_total numeric;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_amount <= 0 or nullif(trim(p_reason),'') is null then raise exception 'Amount and reason are required.'; end if;
  if p_adjustment_type not in ('refund','void','discount') then raise exception 'Invalid adjustment type.'; end if;
  if p_target_type not in ('pos_receipt','payment') then raise exception 'Invalid target type.'; end if;

  v_role := public.current_staff_role(p_property_id);
  if v_role is not null then
    if v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then raise exception 'Only authorised cashier staff can adjust transactions.'; end if;
  elsif not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can adjust transactions.';
  end if;

  if p_target_type = 'pos_receipt' then
    select property_id, total into v_property, v_total from public.pos_receipts where id = p_target_id;
  else
    select property_id, amount into v_property, v_total from public.payments where id = p_target_id;
  end if;
  if v_property is null or v_property <> p_property_id then raise exception 'Transaction not found.'; end if;
  if p_amount > v_total then raise exception 'Adjustment exceeds transaction amount.'; end if;

  if p_adjustment_type = 'void' and p_target_type = 'pos_receipt' then
    update public.pos_receipts set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_target_id and status = 'posted';
  elsif p_adjustment_type = 'void' and p_target_type = 'payment' then
    update public.payments set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason where id = p_target_id and status = 'posted';
  end if;

  insert into public.cashier_adjustments(property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by)
  values(p_property_id,p_shift_id,p_adjustment_type,p_target_type,p_target_id,p_amount,p_reason,auth.uid(),auth.uid())
  returning * into v_adjustment;
  return v_adjustment;
end;
$$;
grant execute on function public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text) to authenticated;

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
    coalesce(sum(case when payment_method='cash' and status='posted' then total else 0 end),0),
    coalesce(sum(case when payment_method='card' and status='posted' then total else 0 end),0),
    coalesce(sum(case when payment_method='mpesa' and status='posted' then total else 0 end),0),
    coalesce(sum(case when payment_method='room' and status='posted' then total else 0 end),0)
  into v_cash, v_card, v_mpesa, v_room
  from public.pos_receipts where shift_id = p_shift_id;

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

notify pgrst, 'reload schema';
