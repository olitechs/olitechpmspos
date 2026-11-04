-- Phase 2 lifecycle concurrency hardening.
-- Forward-only migration. Validate on a disposable PostgreSQL clone before production.
begin;

create or replace function public.fn_check_room_availability(
  p_property_id uuid, p_room_id uuid, p_arrival date, p_departure date,
  p_exclude_reservation_id uuid default null
)
returns table(available boolean, conflict_type text, conflict_id uuid, conflict_message text)
language plpgsql set search_path = public
as $function$
declare
  v_room_status text;
  v_res public.reservations;
  v_closure public.room_closures;
begin
  if p_departure <= p_arrival then
    return query select false, 'invalid_dates'::text, null::uuid, 'Check-out must be after check-in.'::text;
    return;
  end if;

  -- The transaction-scoped lock makes every caller that uses this availability
  -- function serialize on the same property/room pair until its transaction ends.
  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || p_room_id::text, 0)
  );

  select status::text into v_room_status
  from public.rooms
  where id = p_room_id and property_id = p_property_id and active = true;

  if v_room_status is null then
    return query select false, 'room'::text, null::uuid, 'Room not found or inactive.'::text;
    return;
  end if;

  select r.* into v_res
  from public.reservations r
  where r.property_id = p_property_id
    and r.room_id = p_room_id
    and r.id is distinct from p_exclude_reservation_id
    and r.status in ('booked','checked-in')
    and r.arrival < p_departure
    and p_arrival < r.departure
  order by r.arrival limit 1;

  if v_res.id is not null then
    return query select false, 'reservation'::text, v_res.id,
      format('Room is already reserved from %s to %s by %s.', v_res.arrival, v_res.departure, v_res.guest_name)::text;
    return;
  end if;

  select c.* into v_closure
  from public.room_closures c
  where c.property_id = p_property_id and c.room_id = p_room_id
    and c.start_date < p_departure and p_arrival < c.end_date
  order by c.start_date limit 1;

  if v_closure.id is not null then
    return query select false, 'closure'::text, v_closure.id,
      format('Room is closed from %s to %s (%s).', v_closure.start_date, v_closure.end_date, v_closure.reason)::text;
    return;
  end if;

  return query select true, null::text, null::uuid, null::text;
end;
$function$;

create or replace function public.fn_check_in_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql security invoker set search_path = public
as $function$
declare
  v_res public.reservations;
begin
  -- Acquire the row lock before checking status to avoid stale concurrent reads.
  select r.* into v_res
  from public.reservations r
  where r.id = p_reservation_id
    and public.is_member_of_property(r.property_id)
  for update;

  if v_res.id is null then raise exception 'Reservation not found or not allowed.'; end if;
  if v_res.status <> 'booked' then raise exception 'Reservation is not in a bookable state.'; end if;
  if v_res.arrival >= v_res.departure then raise exception 'Reservation dates are invalid.'; end if;
  if not exists (
    select 1 from public.rooms rm
    where rm.id = v_res.room_id and rm.property_id = v_res.property_id
      and rm.status in ('available','booked')
  ) then raise exception 'Assigned room is not available for check-in.'; end if;

  update public.reservations set status = 'checked-in'
  where id = v_res.id returning * into v_res;
  update public.rooms set status = 'occupied'
  where id = v_res.room_id and property_id = v_res.property_id;

  if not exists (
    select 1 from public.folio_charges
    where reservation_id = v_res.id and source = 'room'
  ) then
    insert into public.folio_charges(property_id,reservation_id,source,description,amount)
    values (v_res.property_id,v_res.id,'room','Room charge',
      v_res.rate * greatest(1,(v_res.departure-v_res.arrival)));
  end if;
  return v_res;
end;
$function$;

revoke execute on function public.fn_check_room_availability(uuid,uuid,date,date,uuid) from public, anon;
grant execute on function public.fn_check_room_availability(uuid,uuid,date,date,uuid) to authenticated, service_role;
revoke execute on function public.fn_check_in_reservation(uuid) from public, anon;
grant execute on function public.fn_check_in_reservation(uuid) to authenticated, service_role;

commit;
