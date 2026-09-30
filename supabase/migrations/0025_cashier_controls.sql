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
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
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
  v_is_manager boolean := false;
  v_target_status text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_amount <= 0 or nullif(trim(p_reason),'') is null then raise exception 'Amount and reason are required.'; end if;
  if p_adjustment_type not in ('refund','void','discount') then raise exception 'Invalid adjustment type.'; end if;
  if p_target_type not in ('pos_receipt','payment') then raise exception 'Invalid target type.'; end if;

  v_role := public.current_staff_role(p_property_id);
  v_is_manager := public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or v_role in ('hotel_admin','super_admin','fb_manager');

  if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then
    raise exception 'Only authorised cashier staff can request transaction adjustments.';
  elsif v_role is null and not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can request transaction adjustments.';
  end if;

  if p_target_type = 'pos_receipt' then
    select property_id, total, status into v_property, v_total, v_target_status
    from public.pos_receipts where id = p_target_id;
  else
    select property_id, amount, status into v_property, v_total, v_target_status
    from public.payments where id = p_target_id;
  end if;

  if v_property is null or v_property <> p_property_id then raise exception 'Transaction not found.'; end if;
  if v_target_status <> 'posted' then raise exception 'Only posted transactions can be adjusted.'; end if;
  if p_amount > v_total then raise exception 'Adjustment exceeds transaction amount.'; end if;

  insert into public.cashier_adjustments(
    property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by,status
  ) values(
    p_property_id,p_shift_id,p_adjustment_type,p_target_type,p_target_id,p_amount,p_reason,auth.uid(),
    case when v_is_manager then auth.uid() else null end,
    case when v_is_manager then 'approved' else 'pending' end
  ) returning * into v_adjustment;

  if v_is_manager and p_adjustment_type = 'void' then
    if p_target_type = 'pos_receipt' then
      update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=p_reason where id=p_target_id and status='posted';
    else
      update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=p_reason where id=p_target_id and status='posted';
    end if;
  end if;

  return v_adjustment;
end;
$$;
grant execute on function public.fn_record_cashier_adjustment(uuid,uuid,text, text,uuid,numeric,text) to authenticated;

create or replace function public.fn_approve_cashier_adjustment(
  p_adjustment_id uuid,
  p_approve boolean,
  p_reason text default null
) returns public.cashier_adjustments
language plpgsql security definer set search_path = public
as $$
declare
  v_adjustment public.cashier_adjustments;
  v_role text;
  v_manager boolean;
begin
  select * into v_adjustment from public.cashier_adjustments where id=p_adjustment_id for update;
  if v_adjustment.id is null then raise exception 'Adjustment not found.'; end if;
  v_role := public.current_staff_role(v_adjustment.property_id);
  v_manager := public.is_platform_owner()
    or public.property_role(v_adjustment.property_id) in ('owner','admin','manager')
    or v_role in ('hotel_admin','super_admin','fb_manager');
  if not v_manager then raise exception 'Manager approval is required.'; end if;
  if v_adjustment.status <> 'pending' then raise exception 'Adjustment is already decided.'; end if;

  update public.cashier_adjustments
  set status=case when p_approve then 'approved' else 'rejected' end,
      approved_by=case when p_approve then auth.uid() else null end,
      reason=case when nullif(trim(p_reason),'') is not null then reason || ' | Approval note: ' || trim(p_reason) else reason end
  where id=p_adjustment_id returning * into v_adjustment;

  if p_approve and v_adjustment.adjustment_type='void' then
    if v_adjustment.target_type='pos_receipt' then
      update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=v_adjustment.reason where id=v_adjustment.target_id and status='posted';
    else
      update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=v_adjustment.reason where id=v_adjustment.target_id and status='posted';
    end if;
  end if;
  return v_adjustment;
end;
$$;
grant execute on function public.fn_approve_cashier_adjustment(uuid,boolean,text) to authenticated;

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


create or replace function public.fn_record_pos_sale(
  p_property_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_reservation_id uuid default null
) returns public.pos_receipts
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_res_property uuid;
  v_room_id uuid;
  v_room_number text;
  v_guest_name text;
  v_folio_charge_id uuid;
  v_shift_id uuid;
  v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_payment_method not in ('cash','card','mpesa','room') then raise exception 'Unknown payment method.'; end if;
  if p_total <= 0 then raise exception 'Total must be greater than zero.'; end if;

  select id into v_shift_id
  from public.cashier_shifts
  where property_id = p_property_id and opened_by = auth.uid() and status = 'open'
  order by opened_at desc limit 1;

  if p_payment_method in ('cash','card','mpesa') and v_shift_id is null then
    raise exception 'Open a cashier shift before recording a payment.';
  end if;

  if p_payment_method = 'room' then
    if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
    v_role := public.current_staff_role(p_property_id);
    if v_role is not null then
      if v_role not in ('hotel_admin','super_admin','cashier') then raise exception 'Only an authorised cashier can charge a restaurant bill to a room.'; end if;
    elsif not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
      raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.';
    end if;
    select r.property_id, r.room_id, rm.number::text, r.guest_name
      into v_res_property, v_room_id, v_room_number, v_guest_name
      from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id;
    if v_res_property is null or v_res_property <> p_property_id then raise exception 'Reservation not found.'; end if;
    insert into public.folio_charges(property_id,reservation_id,source,description,amount)
      values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale') || ' — Table ' || coalesce(p_table_number,''),p_total)
      returning id into v_folio_charge_id;
  end if;

  insert into public.pos_receipts(
    property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,items,
    subtotal,discount_amount,vat,total,payment_method,folio_charge_id,created_by,shift_id
  ) values (
    p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,
    coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),coalesce(p_vat,0),
    p_total,p_payment_method,v_folio_charge_id,auth.uid(),v_shift_id
  ) returning * into v_receipt;
  return v_receipt;
end;
$$;
grant execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid) to authenticated;
