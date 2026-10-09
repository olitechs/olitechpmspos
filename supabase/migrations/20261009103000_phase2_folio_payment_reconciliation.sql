-- Phase 2: make front-desk payments reconcile with both booked room value and posted folio charges.
-- This supports deposits before check-in without inventing tender history.
create or replace function public.fn_record_front_desk_payment(
  p_property_id uuid,
  p_reservation_id uuid,
  p_amount numeric,
  p_method text,
  p_shift_id uuid default null
)
returns public.payments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
  v_payment public.payments;
  v_booking_total numeric;
  v_folio_charges numeric;
  v_paid_before numeric;
  v_expected_total numeric;
  v_outstanding numeric;
  v_paid_after numeric;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'Access denied.';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(trim(p_method), '') is null then raise exception 'Payment method is required.'; end if;

  select * into v_res
  from public.reservations
  where id = p_reservation_id and property_id = p_property_id
  for update;

  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.status = 'cancelled' then raise exception 'Cannot post a payment to a cancelled reservation.'; end if;
  if v_res.status = 'checked-out' then raise exception 'Reservation is already checked out.'; end if;

  v_booking_total := greatest(
    0,
    coalesce(nullif(v_res.total_amount, 0), coalesce(v_res.rate, 0) * greatest(1, v_res.departure - v_res.arrival))
  );
  select coalesce(sum(c.amount), 0) into v_folio_charges
  from public.folio_charges c where c.reservation_id = v_res.id;
  select coalesce(sum(p.amount), 0) into v_paid_before
  from public.payments p where p.reservation_id = v_res.id and p.status = 'posted';

  -- Before check-in the room charge may not have been posted yet. Use the booked
  -- room total as the minimum payable amount; once extra folio charges exist,
  -- the posted-charge total becomes authoritative if it is higher.
  v_expected_total := greatest(v_booking_total, v_folio_charges);
  v_outstanding := greatest(0, v_expected_total - v_paid_before);
  if p_amount > v_outstanding + 0.005 then
    raise exception 'Payment exceeds the current outstanding amount of %.', round(v_outstanding, 2);
  end if;

  insert into public.payments(property_id, reservation_id, amount, method, status, shift_id)
  values(p_property_id, p_reservation_id, round(p_amount, 2), trim(p_method), 'posted', p_shift_id)
  returning * into v_payment;

  v_paid_after := v_paid_before + v_payment.amount;
  update public.reservations
  set amount_paid = least(v_booking_total, v_paid_after),
      payment_status = case
        when v_booking_total > 0 and v_paid_after >= v_booking_total - 0.005 then 'fully_paid'
        when v_paid_after > 0 then 'partially_paid'
        else 'not_paid'
      end
  where id = v_res.id;

  return v_payment;
end;
$$;

revoke execute on function public.fn_record_front_desk_payment(uuid,uuid,numeric,text,uuid) from public, anon;
grant execute on function public.fn_record_front_desk_payment(uuid,uuid,numeric,text,uuid) to authenticated, service_role;

-- Keep the folio balance non-negative when a valid deposit precedes the first room charge.
create or replace view public.folio_totals as
select
  r.id as reservation_id,
  r.property_id,
  coalesce(sum(fc.amount), 0) as subtotal,
  coalesce((
    select sum(p.amount)
    from public.payments p
    where p.reservation_id = r.id and p.status = 'posted'
  ), 0) as paid,
  greatest(
    0,
    coalesce(sum(fc.amount), 0) - coalesce((
      select sum(p.amount)
      from public.payments p
      where p.reservation_id = r.id and p.status = 'posted'
    ), 0)
  ) as balance
from public.reservations r
left join public.folio_charges fc on fc.reservation_id = r.id
group by r.id, r.property_id;

alter view public.folio_totals set (security_invoker = true);

create or replace function public.fn_check_out_room(p_room_id uuid)
returns public.reservations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
  v_balance numeric;
  v_booking_total numeric;
begin
  select r.* into v_res
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id and rm.property_id = r.property_id
  where r.room_id = p_room_id
    and r.status = 'checked-in'
    and public.is_member_of_property(r.property_id)
  for update;

  if v_res.id is null then raise exception 'No checked-in reservation found for this room.'; end if;

  v_balance := greatest(
    0,
    coalesce((select sum(c.amount) from public.folio_charges c where c.reservation_id = v_res.id), 0)
    - coalesce((select sum(p.amount) from public.payments p where p.reservation_id = v_res.id and p.status = 'posted'), 0)
  );
  if v_balance > 0.005 then
    raise exception 'Cannot check out with an outstanding folio balance of %.', round(v_balance, 2);
  end if;

  v_booking_total := greatest(
    0,
    coalesce(nullif(v_res.total_amount, 0), coalesce(v_res.rate, 0) * greatest(1, v_res.departure - v_res.arrival))
  );

  -- Keep the reservation's constrained booking-payment fields valid. Extra folio
  -- charges and their payments remain in the separate payment/folio ledger.
  update public.reservations
  set status = 'checked-out',
      payment_status = case when v_booking_total > 0 then 'fully_paid' else 'not_paid' end,
      amount_paid = case when v_booking_total > 0 then v_booking_total else 0 end
  where id = v_res.id;

  update public.rooms set status = 'dirty'
  where id = p_room_id and property_id = v_res.property_id;

  if not exists (
    select 1 from public.housekeeping_tasks
    where room_id = p_room_id
      and task_type = 'checkout_clean'
      and status not in ('completed', 'cancelled')
  ) then
    insert into public.housekeeping_tasks(property_id, room_id, task_type, priority, status, reservation_id, notes, due_at)
    values(v_res.property_id, p_room_id, 'checkout_clean', 'high', 'pending', v_res.id, 'Checkout cleaning required', now());
  end if;

  return (select * from public.reservations where id = v_res.id);
end;
$$;

revoke execute on function public.fn_check_out_room(uuid) from public, anon;
grant execute on function public.fn_check_out_room(uuid) to authenticated, service_role;
