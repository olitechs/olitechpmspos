-- OliTechs PMS+POS — Phase 2 Core PMS transaction completion
-- 0042: atomic front-desk check-in/out and cashier-linked folio payments.

create or replace function public.fn_check_in_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
  v_room_status text;
begin
  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;

  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if v_res.status <> 'booked' then raise exception 'Reservation is not in a bookable state.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_res.property_id::text || ':' || v_res.room_id::text, 0));

  select status::text into v_room_status
  from public.rooms
  where id = v_res.room_id and property_id = v_res.property_id
  for update;

  if v_room_status is null then raise exception 'Room not found.'; end if;
  if v_room_status in ('maintenance','out_of_service','blocked','dirty','cleaning') then
    raise exception 'Room is not ready for check-in.';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.room_id = v_res.room_id
      and r.property_id = v_res.property_id
      and r.id <> v_res.id
      and r.status = 'checked-in'
      and r.arrival < v_res.departure
      and v_res.arrival < r.departure
  ) then
    raise exception 'Room is occupied by another active stay.';
  end if;

  update public.reservations
  set status = 'checked-in'
  where id = v_res.id
  returning * into v_res;

  update public.rooms
  set status = 'occupied'
  where id = v_res.room_id and property_id = v_res.property_id;

  -- Room revenue is posted exactly once because the reservation can only
  -- transition into checked-in once.
  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
  select v_res.property_id,v_res.id,'room','Room charge',
         round(v_res.rate * greatest(1,(v_res.departure-v_res.arrival)),2)
  where not exists (
    select 1 from public.folio_charges
    where reservation_id=v_res.id and source='room' and description='Room charge'
  );

  return v_res;
end;
$$;

create or replace function public.fn_check_out_room(p_room_id uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
begin
  select r.* into v_res
  from public.reservations r
  where r.room_id = p_room_id
    and r.status = 'checked-in'
  order by r.created_at desc
  limit 1
  for update;

  if v_res.id is null then raise exception 'No checked-in guest is assigned to this room.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_res.property_id::text || ':' || v_res.room_id::text, 0));

  update public.reservations
  set status='checked-out'
  where id=v_res.id;

  update public.rooms
  set status='dirty'
  where id=p_room_id and property_id=v_res.property_id;
end;
$$;

drop function if exists public.fn_record_folio_payment(uuid, uuid, numeric, text);

create or replace function public.fn_record_folio_payment(
  p_property_id uuid,
  p_reservation_id uuid,
  p_amount numeric,
  p_method text,
  p_shift_id uuid default null
)
returns public.payments
language plpgsql security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
  v_balance numeric;
  v_payment public.payments;
  v_shift_property uuid;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.property_id <> p_property_id then raise exception 'Reservation does not belong to this property.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_method not in ('cash','card','mpesa','bank_transfer','room_charge','reservation_deposit') then raise exception 'Invalid payment method.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text, 0));

  if p_shift_id is not null then
    select property_id into v_shift_property from public.cashier_shifts where id=p_shift_id;
    if v_shift_property is null or v_shift_property <> v_res.property_id then raise exception 'Cashier shift does not belong to this property.'; end if;
  end if;

  select coalesce((select sum(amount) from public.folio_charges where reservation_id=v_res.id),0)
       - coalesce((select sum(amount) from public.payments where reservation_id=v_res.id),0)
    into v_balance;

  if p_amount > greatest(v_balance,0) then
    raise exception 'Payment exceeds the outstanding folio balance of %.', round(greatest(v_balance,0),2);
  end if;

  insert into public.payments(property_id,reservation_id,amount,method,shift_id)
  values(v_res.property_id,v_res.id,round(p_amount,2),p_method,p_shift_id)
  returning * into v_payment;

  update public.reservations
  set amount_paid = coalesce(amount_paid,0) + round(p_amount,2),
      payment_status = case
        when coalesce(amount_paid,0) + round(p_amount,2) >= coalesce(total_amount,0) then 'fully_paid'
        when coalesce(amount_paid,0) + round(p_amount,2) > 0 then 'partially_paid'
        else 'not_paid'
      end
  where id=v_res.id;

  return v_payment;
end;
$$;

notify pgrst, 'reload schema';
