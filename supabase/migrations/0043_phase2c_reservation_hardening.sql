-- OliTechs PMS/POS — Phase 2C reservation workflow hardening
-- Keeps the existing planner RPC signature while tightening validation and
-- preventing reservation amount_paid from drifting away from the payment ledger.

create or replace function public.fn_update_planner_reservation(
  p_reservation_id uuid, p_room_id uuid, p_arrival date, p_departure date, p_guest_name text,
  p_payment_status text, p_channel text, p_meal_plan text, p_adults int, p_kids_count int,
  p_kids_ages jsonb, p_total_amount numeric, p_amount_paid numeric, p_notes text
) returns public.reservations
language plpgsql security invoker
as $$
declare
  v_old public.reservations;
  v_new public.reservations;
  v_guest_id uuid;
  v_ok boolean;
  v_type text;
  v_conflict uuid;
  v_message text;
  v_ledger_paid numeric := 0;
begin
  select * into v_old
  from public.reservations
  where id = p_reservation_id
  for update;

  if v_old.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_old.property_id) and not public.is_platform_owner() then
    raise exception 'Access denied.';
  end if;

  if nullif(trim(p_guest_name), '') is null then raise exception 'Guest name is required.'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if coalesce(p_adults, 0) < 1 or p_adults > 10 then raise exception 'Adults must be between 1 and 10.'; end if;
  if coalesce(p_kids_count, 0) < 0 or p_kids_count > 6 then raise exception 'Kids must be between 0 and 6.'; end if;
  if p_payment_status not in ('fully_paid','not_paid','partially_paid') then raise exception 'Invalid payment status.'; end if;
  if p_channel not in ('direct','booking_com','unknown') then raise exception 'Invalid reservation channel.'; end if;
  if p_meal_plan not in ('bed_only','bb','half_board','full_board') then raise exception 'Invalid meal plan.'; end if;
  if coalesce(p_total_amount, 0) < 0 or coalesce(p_amount_paid, 0) < 0 then raise exception 'Reservation amounts cannot be negative.'; end if;
  if p_amount_paid > p_total_amount then raise exception 'Amount Paid cannot exceed Total Amount.'; end if;

  select coalesce(sum(amount), 0)
    into v_ledger_paid
  from public.payments
  where reservation_id = v_old.id
    and property_id = v_old.property_id;

  if v_ledger_paid > 0 and abs(v_ledger_paid - coalesce(p_amount_paid, 0)) > 0.005 then
    raise exception 'Reservation payment total is controlled by the payment ledger. Record payments through Folio/Cashier.';
  end if;

  if p_payment_status = 'fully_paid' and p_amount_paid <> p_total_amount then
    raise exception 'Fully paid reservations must have Amount Paid equal to Total Amount.';
  end if;

  if p_payment_status = 'partially_paid'
     and (p_amount_paid >= p_total_amount or (p_total_amount > 0 and p_amount_paid < p_total_amount * 0.5)) then
    raise exception 'Partially paid reservations must be below total and at least 50% paid.';
  end if;

  if p_payment_status = 'not_paid' and p_amount_paid <> 0 then
    raise exception 'Not paid reservations must have Amount Paid set to zero.';
  end if;

  select a.available, a.conflict_type, a.conflict_id, a.conflict_message
    into v_ok, v_type, v_conflict, v_message
  from public.fn_check_room_availability(
    v_old.property_id,
    p_room_id,
    p_arrival,
    p_departure,
    p_reservation_id
  ) a;

  if not coalesce(v_ok, false) then
    raise exception '%', coalesce(v_message, 'Room is unavailable for the selected dates.');
  end if;

  select id into v_guest_id
  from public.guests
  where id = v_old.guest_id
    and property_id = v_old.property_id;

  if v_guest_id is null then
    insert into public.guests(property_id, name)
    values(v_old.property_id, trim(p_guest_name))
    returning id into v_guest_id;
  else
    update public.guests
    set name = trim(p_guest_name)
    where id = v_guest_id;
  end if;

  update public.reservations
  set room_id = p_room_id,
      arrival = p_arrival,
      departure = p_departure,
      guest_name = trim(p_guest_name),
      guest_id = v_guest_id,
      payment_status = p_payment_status,
      channel = p_channel,
      meal_plan = p_meal_plan,
      adults = p_adults,
      children = p_kids_count,
      kids_count = p_kids_count,
      kids_ages = coalesce(p_kids_ages, '[]'::jsonb),
      total_amount = p_total_amount,
      amount_paid = p_amount_paid,
      rate = p_total_amount,
      notes = p_notes,
      special_requests = p_notes
  where id = p_reservation_id
  returning * into v_new;

  return v_new;
end;
$$;

notify pgrst, 'reload schema';
