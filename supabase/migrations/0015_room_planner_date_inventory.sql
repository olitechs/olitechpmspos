-- OliTechs PMS/POS — Room Planner date-based inventory and closures
-- Critical rule: room reservation availability is DATE-RANGE based.
-- A reservation never changes the room's global operational status.

create table if not exists public.room_closures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default 'Closure',
  created_at timestamptz not null default now(),
  constraint room_closures_valid_range check (end_date > start_date)
);

create index if not exists room_closures_room_dates_idx
  on public.room_closures(property_id, room_id, start_date, end_date);

alter table public.room_closures enable row level security;
drop policy if exists room_closures_select on public.room_closures;
create policy room_closures_select on public.room_closures for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists room_closures_insert on public.room_closures;
create policy room_closures_insert on public.room_closures for insert
  with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists room_closures_update on public.room_closures;
create policy room_closures_update on public.room_closures for update
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists room_closures_delete on public.room_closures;
create policy room_closures_delete on public.room_closures for delete
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

-- One authoritative availability check used by create/edit/move operations.
create or replace function public.fn_check_room_availability(
  p_property_id uuid,
  p_room_id uuid,
  p_arrival date,
  p_departure date,
  p_exclude_reservation_id uuid default null
) returns table (
  available boolean,
  conflict_type text,
  conflict_id uuid,
  conflict_message text
)
language plpgsql
security invoker
as $$
declare
  v_room_status text;
  v_res public.reservations;
  v_closure public.room_closures;
begin
  if p_departure <= p_arrival then
    return query select false, 'invalid_dates'::text, null::uuid, 'Check-out must be after check-in.'::text;
    return;
  end if;

  select status::text into v_room_status
  from public.rooms
  where id = p_room_id and property_id = p_property_id and active = true;

  if v_room_status is null then
    return query select false, 'room'::text, null::uuid, 'Room not found or inactive.'::text;
    return;
  end if;

  -- Operational status is deliberately NOT used as reservation inventory.
  -- A room can be operationally booked/occupied while future dates remain free.

  select r.* into v_res
  from public.reservations r
  where r.property_id = p_property_id
    and r.room_id = p_room_id
    and r.id is distinct from p_exclude_reservation_id
    and r.status in ('booked','checked-in')
    and r.arrival < p_departure
    and p_arrival < r.departure
  order by r.arrival
  limit 1;

  if v_res.id is not null then
    return query select false, 'reservation'::text, v_res.id,
      format('Room is already reserved from %s to %s by %s.', v_res.arrival, v_res.departure, v_res.guest_name)::text;
    return;
  end if;

  select c.* into v_closure
  from public.room_closures c
  where c.property_id = p_property_id
    and c.room_id = p_room_id
    and c.start_date < p_departure
    and p_arrival < c.end_date
  order by c.start_date
  limit 1;

  if v_closure.id is not null then
    return query select false, 'closure'::text, v_closure.id,
      format('Room is closed from %s to %s (%s).', v_closure.start_date, v_closure.end_date, v_closure.reason)::text;
    return;
  end if;

  return query select true, null::text, null::uuid, null::text;
end;
$$;

-- Replace planner RPCs so room.status is never used as a global booking lock.
create or replace function public.fn_create_reservation_bundle(
  p_property_id uuid, p_room_ids uuid[], p_group_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_payment_status text, p_channel text, p_meal_plan text,
  p_adults int, p_kids_count int, p_kids_ages jsonb, p_total_amount numeric, p_amount_paid numeric, p_notes text
) returns setof public.reservations
language plpgsql security invoker
as $$
declare
  v_guest_id uuid; v_room_id uuid; v_group uuid := case when coalesce(array_length(p_room_ids,1),0) > 1 then coalesce(p_group_id, gen_random_uuid()) else null end;
  v_count int := greatest(coalesce(array_length(p_room_ids,1),0),1); v_total numeric := greatest(coalesce(p_total_amount,0),0); v_paid numeric := greatest(coalesce(p_amount_paid,0),0);
  v_share numeric; v_res public.reservations; v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'You do not have access to this property.'; end if;
  if nullif(trim(p_guest_name),'') is null then raise exception 'Guest name is required.'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if coalesce(p_adults,0) < 1 or p_adults > 10 then raise exception 'Adults must be between 1 and 10.'; end if;
  if coalesce(p_kids_count,0) < 0 or p_kids_count > 6 then raise exception 'Kids must be between 0 and 6.'; end if;
  if p_payment_status not in ('fully_paid','not_paid','partially_paid') then raise exception 'Invalid payment status.'; end if;
  if p_channel not in ('direct','booking_com','unknown') then raise exception 'Invalid reservation channel.'; end if;
  if p_meal_plan not in ('bed_only','bb','half_board','full_board') then raise exception 'Invalid meal plan.'; end if;
  if v_paid > v_total then raise exception 'Amount Paid cannot exceed Total Amount.'; end if;
  if p_payment_status = 'fully_paid' and v_paid <> v_total then raise exception 'Fully paid reservations must have Amount Paid equal to Total Amount.'; end if;
  if p_payment_status = 'partially_paid' and (v_paid >= v_total or (v_total > 0 and v_paid < v_total * 0.5)) then raise exception 'Partially paid reservations must be below total and at least 50% paid.'; end if;
  if p_payment_status = 'not_paid' and v_paid <> 0 then raise exception 'Not paid reservations must have Amount Paid set to zero.'; end if;
  if coalesce(array_length(p_room_ids,1),0) = 0 then raise exception 'At least one room is required.'; end if;
  if (select count(*) from unnest(p_room_ids) x) <> (select count(distinct x) from unnest(p_room_ids) x) then raise exception 'A room cannot be assigned twice.'; end if;

  for v_room_id in select unnest(p_room_ids) loop
    select a.available, a.conflict_type, a.conflict_id, a.conflict_message into v_ok, v_type, v_conflict, v_message
      from public.fn_check_room_availability(p_property_id, v_room_id, p_arrival, p_departure, null) a;
    if not coalesce(v_ok,false) then raise exception '%', coalesce(v_message, 'Room is unavailable for the selected dates.'); end if;
  end loop;

  if p_phone is not null and trim(p_phone) <> '' then
    select id into v_guest_id from public.guests where property_id = p_property_id and phone = p_phone limit 1;
  end if;
  if v_guest_id is null then insert into public.guests(property_id,name,phone) values(p_property_id,trim(p_guest_name),nullif(trim(p_phone),'')) returning id into v_guest_id; end if;

  v_share := round(v_total / v_count, 2);
  for v_room_id in select unnest(p_room_ids) loop
    insert into public.reservations(
      property_id, room_id, guest_id, guest_name, phone, arrival, departure, party_size, rate, status, notes,
      group_id, payment_status, channel, meal_plan, adults, children, kids_count, kids_ages, total_amount, amount_paid, special_requests
    ) values (
      p_property_id, v_room_id, v_guest_id, trim(p_guest_name), nullif(trim(p_phone),''), p_arrival, p_departure,
      coalesce(p_adults,1)+coalesce(p_kids_count,0), case when v_count=1 then v_total else v_share end, 'booked', p_notes,
      v_group, p_payment_status, p_channel, p_meal_plan, p_adults, p_kids_count, p_kids_count, coalesce(p_kids_ages,'[]'::jsonb),
      case when v_count=1 then v_total else v_share end,
      case when v_count=1 then v_paid else v_share * case when v_total > 0 then v_paid / v_total else 0 end end, p_notes
    ) returning * into v_res;
    return next v_res;
  end loop;
end;
$$;

create or replace function public.fn_update_planner_reservation(
  p_reservation_id uuid, p_room_id uuid, p_arrival date, p_departure date, p_guest_name text,
  p_payment_status text, p_channel text, p_meal_plan text, p_adults int, p_kids_count int,
  p_kids_ages jsonb, p_total_amount numeric, p_amount_paid numeric, p_notes text
) returns public.reservations
language plpgsql security invoker
as $$
declare v_old public.reservations; v_new public.reservations; v_guest_id uuid; v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  select * into v_old from public.reservations where id=p_reservation_id for update;
  if v_old.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_old.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if p_amount_paid > p_total_amount then raise exception 'Amount Paid cannot exceed Total Amount.'; end if;
  if p_payment_status = 'fully_paid' and p_amount_paid <> p_total_amount then raise exception 'Fully paid reservations must have Amount Paid equal to Total Amount.'; end if;
  if p_payment_status = 'partially_paid' and (p_amount_paid >= p_total_amount or (p_total_amount > 0 and p_amount_paid < p_total_amount * 0.5)) then raise exception 'Partially paid reservations must be below total and at least 50% paid.'; end if;
  if p_payment_status = 'not_paid' and p_amount_paid <> 0 then raise exception 'Not paid reservations must have Amount Paid set to zero.'; end if;

  select a.available, a.conflict_type, a.conflict_id, a.conflict_message into v_ok, v_type, v_conflict, v_message
    from public.fn_check_room_availability(v_old.property_id, p_room_id, p_arrival, p_departure, p_reservation_id) a;
  if not coalesce(v_ok,false) then raise exception '%', coalesce(v_message, 'Room is unavailable for the selected dates.'); end if;

  select id into v_guest_id from public.guests where id=v_old.guest_id;
  if v_guest_id is null then insert into public.guests(property_id,name) values(v_old.property_id,trim(p_guest_name)) returning id into v_guest_id;
  else update public.guests set name=trim(p_guest_name) where id=v_guest_id; end if;

  update public.reservations set room_id=p_room_id, arrival=p_arrival, departure=p_departure, guest_name=trim(p_guest_name), guest_id=v_guest_id,
    payment_status=p_payment_status, channel=p_channel, meal_plan=p_meal_plan, adults=p_adults, children=p_kids_count, kids_count=p_kids_count,
    kids_ages=coalesce(p_kids_ages,'[]'::jsonb), total_amount=p_total_amount, amount_paid=p_amount_paid, rate=p_total_amount, notes=p_notes, special_requests=p_notes
    where id=p_reservation_id returning * into v_new;
  return v_new;
end;
$$;

create or replace function public.fn_move_planner_reservation(p_reservation_id uuid, p_room_id uuid, p_arrival date, p_departure date)
returns public.reservations
language plpgsql security invoker
as $$
declare v public.reservations; v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  select a.available, a.conflict_type, a.conflict_id, a.conflict_message into v_ok, v_type, v_conflict, v_message
    from public.fn_check_room_availability(v.property_id,p_room_id,p_arrival,p_departure,p_reservation_id) a;
  if not coalesce(v_ok,false) then raise exception '%', coalesce(v_message, 'Room is unavailable for the selected dates.'); end if;
  update public.reservations set room_id=p_room_id, arrival=p_arrival, departure=p_departure where id=p_reservation_id returning * into v;
  return v;
end;
$$;

-- Legacy PMS function: route through the same date-based availability rules.
create or replace function public.fn_add_reservation(
  p_property_id uuid, p_room_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_party_size int, p_rate numeric
) returns public.reservations
language plpgsql security invoker as $$
declare v public.reservations;
begin
  select * into v from public.fn_create_reservation_bundle(
    p_property_id,array[p_room_id],null,p_guest_name,p_phone,p_arrival,p_departure,
    'not_paid','direct','bed_only',greatest(coalesce(p_party_size,1),1),0,'[]'::jsonb,coalesce(p_rate,0),0,null
  ) limit 1;
  return v;
end;
$$;

create or replace function public.fn_add_room_to_reservation_group(p_reservation_id uuid, p_room_id uuid)
returns public.reservations
language plpgsql security invoker as $$
declare v public.reservations; v_new public.reservations; v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null or v.group_id is null then raise exception 'Reservation is not part of a joint group.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if exists(select 1 from public.reservations r where r.group_id=v.group_id and r.room_id=p_room_id) then raise exception 'Room is already in this joint reservation.'; end if;
  select a.available, a.conflict_type, a.conflict_id, a.conflict_message into v_ok, v_type, v_conflict, v_message
    from public.fn_check_room_availability(v.property_id,p_room_id,v.arrival,v.departure,null) a;
  if not coalesce(v_ok,false) then raise exception '%', coalesce(v_message, 'Room is unavailable for the selected dates.'); end if;
  insert into public.reservations(property_id,room_id,guest_id,guest_name,phone,arrival,departure,party_size,rate,status,notes,group_id,payment_status,channel,meal_plan,adults,children,kids_count,kids_ages,total_amount,amount_paid,special_requests)
  values(v.property_id,p_room_id,v.guest_id,v.guest_name,v.phone,v.arrival,v.departure,v.party_size,0,'booked',v.notes,v.group_id,'not_paid',v.channel,v.meal_plan,v.adults,v.children,v.kids_count,v.kids_ages,0,0,v.special_requests)
  returning * into v_new;
  return v_new;
end;
$$;

notify pgrst, 'reload schema';

create or replace function public.fn_delete_planner_reservation(p_reservation_id uuid) returns void
language plpgsql security invoker as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  delete from public.reservations where id=p_reservation_id;
  -- Do not mutate rooms.status. It is operational/housekeeping state, not inventory.
end;
$$;

create or replace function public.fn_move_reservation_group(
  p_group_id uuid, p_moved_reservation_id uuid, p_target_room_id uuid, p_target_arrival date, p_target_departure date
) returns setof public.reservations
language plpgsql security invoker
as $$
declare
  v_moved public.reservations; v public.reservations; v_delta int;
  v_candidate_arrival date; v_candidate_departure date; v_candidate_room uuid;
  v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  select * into v_moved from public.reservations where id=p_moved_reservation_id and group_id=p_group_id for update;
  if v_moved.id is null then raise exception 'Joint reservation member not found.'; end if;
  if not public.is_member_of_property(v_moved.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_target_departure <= p_target_arrival then raise exception 'Check-out must be after check-in.'; end if;
  v_delta := p_target_arrival - v_moved.arrival;

  for v in select * from public.reservations where group_id=p_group_id order by id loop
    if v.id=p_moved_reservation_id then
      v_candidate_room := p_target_room_id; v_candidate_arrival := p_target_arrival; v_candidate_departure := p_target_departure;
    else
      v_candidate_room := v.room_id; v_candidate_arrival := v.arrival + v_delta; v_candidate_departure := v.departure + v_delta;
    end if;

    select a.available, a.conflict_type, a.conflict_id, a.conflict_message into v_ok, v_type, v_conflict, v_message
      from public.fn_check_room_availability(v.property_id,v_candidate_room,v_candidate_arrival,v_candidate_departure,v.id) a;
    if not coalesce(v_ok,false) then raise exception '%', coalesce(v_message, 'A room in this joint reservation is unavailable for the new dates.'); end if;

    if exists(select 1 from public.reservations x where x.group_id=p_group_id and x.id<>v.id and x.room_id=v_candidate_room) then
      raise exception 'A joint reservation member would use the same room as another member.';
    end if;
  end loop;

  for v in select * from public.reservations where group_id=p_group_id order by id for update loop
    if v.id=p_moved_reservation_id then
      update public.reservations set room_id=p_target_room_id, arrival=p_target_arrival, departure=p_target_departure where id=v.id returning * into v;
    else
      update public.reservations set arrival=arrival+v_delta, departure=departure+v_delta where id=v.id returning * into v;
    end if;
    return next v;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
