-- OliTechs PMS/POS — Production Room Planner reservations
-- Adds payment/channel/meal/group metadata and transactional planner operations.

alter table public.reservations add column if not exists group_id uuid;
alter table public.reservations add column if not exists payment_status text not null default 'not_paid';
alter table public.reservations add column if not exists channel text not null default 'direct';
alter table public.reservations add column if not exists meal_plan text not null default 'bed_only';
alter table public.reservations add column if not exists kids_count int not null default 0;
alter table public.reservations add column if not exists kids_ages jsonb not null default '[]'::jsonb;
alter table public.reservations add column if not exists total_amount numeric(12,2) not null default 0;
alter table public.reservations add column if not exists amount_paid numeric(12,2) not null default 0;
alter table public.reservations add column if not exists special_requests text;

update public.reservations
set total_amount = coalesce(nullif(total_amount, 0), rate * greatest(1, departure - arrival)),
    amount_paid = coalesce(amount_paid, 0),
    kids_count = coalesce(kids_count, children, 0),
    payment_status = case
      when coalesce(nullif(total_amount, 0), rate * greatest(1, departure - arrival)) > 0
           and coalesce(amount_paid, 0) >= coalesce(nullif(total_amount, 0), rate * greatest(1, departure - arrival)) then 'fully_paid'
      when coalesce(amount_paid, 0) > 0 then 'partially_paid'
      else 'not_paid'
    end
where true;

alter table public.reservations drop constraint if exists reservations_payment_status_check;
alter table public.reservations add constraint reservations_payment_status_check check (payment_status in ('fully_paid','not_paid','partially_paid'));
alter table public.reservations drop constraint if exists reservations_channel_check;
alter table public.reservations add constraint reservations_channel_check check (channel in ('direct','booking_com','unknown'));
alter table public.reservations drop constraint if exists reservations_meal_plan_check;
alter table public.reservations add constraint reservations_meal_plan_check check (meal_plan in ('bed_only','bb','half_board','full_board'));
alter table public.reservations drop constraint if exists reservations_kids_count_check;
alter table public.reservations add constraint reservations_kids_count_check check (kids_count between 0 and 6);
alter table public.reservations drop constraint if exists reservations_amounts_check;
alter table public.reservations add constraint reservations_amounts_check check (total_amount >= 0 and amount_paid >= 0 and amount_paid <= total_amount);

create index if not exists reservations_group_idx on public.reservations(property_id, group_id);
create index if not exists reservations_planner_dates_idx on public.reservations(property_id, room_id, arrival, departure) where status in ('booked','checked-in');

-- Normalise legacy status to the planner's canonical booking status values in the API mapping.

create or replace function public.fn_create_reservation_bundle(
  p_property_id uuid,
  p_room_ids uuid[],
  p_group_id uuid,
  p_guest_name text,
  p_phone text,
  p_arrival date,
  p_departure date,
  p_payment_status text,
  p_channel text,
  p_meal_plan text,
  p_adults int,
  p_kids_count int,
  p_kids_ages jsonb,
  p_total_amount numeric,
  p_amount_paid numeric,
  p_notes text
) returns setof public.reservations
language plpgsql
security invoker
as $$
declare
  v_guest_id uuid;
  v_room_id uuid;
  v_group uuid := case when coalesce(array_length(p_room_ids,1),0) > 1 then coalesce(p_group_id, gen_random_uuid()) else null end;
  v_count int := greatest(coalesce(array_length(p_room_ids,1),0), 1);
  v_total numeric := greatest(coalesce(p_total_amount,0),0);
  v_paid numeric := greatest(coalesce(p_amount_paid,0),0);
  v_share numeric;
  v_index int := 0;
  v_res public.reservations;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'You do not have access to this property.';
  end if;
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
    if not exists (select 1 from public.rooms where id = v_room_id and property_id = p_property_id and active = true) then
      raise exception 'One or more selected rooms are not available in this property.';
    end if;
    if exists (
      select 1 from public.reservations r
      where r.room_id = v_room_id and r.status in ('booked','checked-in')
        and r.arrival < p_departure and p_arrival < r.departure
    ) then
      raise exception 'Room is already booked for part of those dates.';
    end if;
  end loop;

  if p_phone is not null and trim(p_phone) <> '' then
    select id into v_guest_id from public.guests where property_id = p_property_id and phone = p_phone limit 1;
  end if;
  if v_guest_id is null then
    insert into public.guests(property_id,name,phone) values(p_property_id,trim(p_guest_name),nullif(trim(p_phone),'')) returning id into v_guest_id;
  end if;

  v_share := round(v_total / v_count, 2);
  for v_room_id in select unnest(p_room_ids) loop
    v_index := v_index + 1;
    insert into public.reservations(
      property_id, room_id, guest_id, guest_name, phone, arrival, departure, party_size, rate, status, notes,
      group_id, payment_status, channel, meal_plan, adults, children, kids_count, kids_ages, total_amount, amount_paid, special_requests
    ) values (
      p_property_id, v_room_id, v_guest_id, trim(p_guest_name), nullif(trim(p_phone),''), p_arrival, p_departure,
      coalesce(p_adults,1)+coalesce(p_kids_count,0), case when v_count=1 then v_total else v_share end, 'booked', p_notes,
      v_group, p_payment_status, p_channel, p_meal_plan, p_adults, p_kids_count, p_kids_count, coalesce(p_kids_ages,'[]'::jsonb),
      case when v_count=1 then v_total else v_share end,
      case when v_count=1 then v_paid else v_share * case when v_total > 0 then v_paid / v_total else 0 end end,
      p_notes
    ) returning * into v_res;
    update public.rooms set status = 'booked' where id = v_room_id and property_id = p_property_id and status = 'available';
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
declare v_old public.reservations; v_new public.reservations; v_guest_id uuid;
begin
  select * into v_old from public.reservations where id = p_reservation_id for update;
  if v_old.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_old.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if p_amount_paid > p_total_amount then raise exception 'Amount Paid cannot exceed Total Amount.'; end if;
  if p_payment_status = 'fully_paid' and p_amount_paid <> p_total_amount then raise exception 'Fully paid reservations must have Amount Paid equal to Total Amount.'; end if;
  if p_payment_status = 'partially_paid' and (p_amount_paid >= p_total_amount or (p_total_amount > 0 and p_amount_paid < p_total_amount * 0.5)) then raise exception 'Partially paid reservations must be below total and at least 50% paid.'; end if;
  if p_payment_status = 'not_paid' and p_amount_paid <> 0 then raise exception 'Not paid reservations must have Amount Paid set to zero.'; end if;
  if not exists (select 1 from public.rooms where id=p_room_id and property_id=v_old.property_id and active=true) then raise exception 'Target room not found or inactive.'; end if;
  if exists (select 1 from public.reservations r where r.id<>p_reservation_id and r.room_id=p_room_id and r.status in ('booked','checked-in') and r.arrival<p_departure and p_arrival<r.departure) then
    raise exception 'Room is already booked for part of those dates.';
  end if;
  select id into v_guest_id from public.guests where id=v_old.guest_id;
  if v_guest_id is null then
    insert into public.guests(property_id,name) values(v_old.property_id,trim(p_guest_name)) returning id into v_guest_id;
  else
    update public.guests set name=trim(p_guest_name) where id=v_guest_id;
  end if;
  update public.reservations set room_id=p_room_id, arrival=p_arrival, departure=p_departure, guest_name=trim(p_guest_name), guest_id=v_guest_id,
    payment_status=p_payment_status, channel=p_channel, meal_plan=p_meal_plan, adults=p_adults, children=p_kids_count, kids_count=p_kids_count,
    kids_ages=coalesce(p_kids_ages,'[]'::jsonb), total_amount=p_total_amount, amount_paid=p_amount_paid, rate=p_total_amount, notes=p_notes, special_requests=p_notes
    where id=p_reservation_id returning * into v_new;
  if v_old.room_id <> p_room_id then
    if not exists(select 1 from public.reservations where room_id=v_old.room_id and status in ('booked','checked-in')) then update public.rooms set status='available' where id=v_old.room_id; end if;
    update public.rooms set status='booked' where id=p_room_id and status='available';
  end if;
  return v_new;
end;
$$;

create or replace function public.fn_delete_planner_reservation(p_reservation_id uuid) returns void
language plpgsql security invoker as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  delete from public.reservations where id=p_reservation_id;
  if not exists(select 1 from public.reservations where room_id=v.room_id and status in ('booked','checked-in')) then update public.rooms set status='available' where id=v.room_id; end if;
end;
$$;

create or replace function public.fn_move_planner_reservation(p_reservation_id uuid, p_room_id uuid, p_arrival date, p_departure date) returns public.reservations
language plpgsql security invoker as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if exists(select 1 from public.reservations r where r.id<>p_reservation_id and r.room_id=p_room_id and r.status in ('booked','checked-in') and r.arrival<p_departure and p_arrival<r.departure) then
    raise exception 'Room is already booked for part of those dates.';
  end if;
  if not exists(select 1 from public.rooms where id=p_room_id and property_id=v.property_id and active=true) then raise exception 'Target room not found or inactive.'; end if;
  update public.reservations set room_id=p_room_id, arrival=p_arrival, departure=p_departure where id=p_reservation_id returning * into v;
  if not exists(select 1 from public.reservations where room_id=v.room_id and status in ('booked','checked-in')) then update public.rooms set status='available' where id=v.room_id; end if;
  update public.rooms set status='booked' where id=p_room_id and status='available';
  return v;
end;
$$;

create or replace function public.fn_move_reservation_group(
  p_group_id uuid, p_moved_reservation_id uuid, p_target_room_id uuid, p_target_arrival date, p_target_departure date
) returns setof public.reservations
language plpgsql security invoker
as $$
declare v_moved public.reservations; v public.reservations; v_delta int; v_candidate_arrival date; v_candidate_departure date; v_candidate_room uuid;
begin
  select * into v_moved from public.reservations where id=p_moved_reservation_id and group_id=p_group_id for update;
  if v_moved.id is null then raise exception 'Joint reservation member not found.'; end if;
  if not public.is_member_of_property(v_moved.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_target_departure <= p_target_arrival then raise exception 'Check-out must be after check-in.'; end if;
  if not exists(select 1 from public.rooms where id=p_target_room_id and property_id=v_moved.property_id and active=true) then raise exception 'Target room not found or inactive.'; end if;
  v_delta := p_target_arrival - v_moved.arrival;

  -- Validate every resulting member placement before changing anything.
  for v in select * from public.reservations where group_id=p_group_id order by id loop
    if v.id=p_moved_reservation_id then
      v_candidate_room := p_target_room_id; v_candidate_arrival := p_target_arrival; v_candidate_departure := p_target_departure;
    else
      v_candidate_room := v.room_id; v_candidate_arrival := v.arrival + v_delta; v_candidate_departure := v.departure + v_delta;
    end if;
    if exists(
      select 1 from public.reservations r
      where r.id <> v.id and r.group_id is distinct from p_group_id and r.room_id=v_candidate_room and r.status in ('booked','checked-in')
        and r.arrival < v_candidate_departure and v_candidate_arrival < r.departure
    ) then raise exception 'A room in this joint reservation is already booked for the new dates.'; end if;
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

-- Keep legacy booking UI functional while using the production overlap rules.
create or replace function public.fn_add_reservation(
  p_property_id uuid, p_room_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_party_size int, p_rate numeric
) returns public.reservations
language plpgsql security invoker as $$
declare v public.reservations;
begin
  select * into v from public.fn_create_reservation_bundle(
    p_property_id, array[p_room_id], null, p_guest_name, p_phone, p_arrival, p_departure,
    case when coalesce(p_rate,0) <= 0 then 'not_paid' else 'not_paid' end, 'direct', 'bed_only', greatest(coalesce(p_party_size,1),1), 0, '[]'::jsonb,
    coalesce(p_rate,0), 0, null
  ) limit 1;
  return v;
end;
$$;

notify pgrst, 'reload schema';

create or replace function public.fn_add_room_to_reservation_group(p_reservation_id uuid, p_room_id uuid)
returns public.reservations
language plpgsql security invoker as $$
declare v public.reservations; v_new public.reservations;
begin
  select * into v from public.reservations where id=p_reservation_id for update;
  if v.id is null or v.group_id is null then raise exception 'Reservation is not part of a joint group.'; end if;
  if not public.is_member_of_property(v.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if not exists(select 1 from public.rooms where id=p_room_id and property_id=v.property_id and active=true) then raise exception 'Room not found or inactive.'; end if;
  if exists(select 1 from public.reservations r where r.group_id=v.group_id and r.room_id=p_room_id) then raise exception 'Room is already in this joint reservation.'; end if;
  if exists(select 1 from public.reservations r where r.room_id=p_room_id and r.status in ('booked','checked-in') and r.arrival<v.departure and v.arrival<r.departure) then raise exception 'Room is already booked for part of those dates.'; end if;
  insert into public.reservations(property_id,room_id,guest_id,guest_name,phone,arrival,departure,party_size,rate,status,notes,group_id,payment_status,channel,meal_plan,adults,children,kids_count,kids_ages,total_amount,amount_paid,special_requests)
  values(v.property_id,p_room_id,v.guest_id,v.guest_name,v.phone,v.arrival,v.departure,v.party_size,0,'booked',v.notes,v.group_id,'not_paid',v.channel,v.meal_plan,v.adults,v.children,v.kids_count,v.kids_ages,0,0,v.special_requests)
  returning * into v_new;
  update public.rooms set status='booked' where id=p_room_id and status='available';
  return v_new;
end;
$$;

create or replace function public.fn_split_reservation_group(p_group_id uuid)
returns void language plpgsql security invoker as $$
declare v_property uuid;
begin
  select property_id into v_property from public.reservations where group_id=p_group_id limit 1;
  if v_property is null then raise exception 'Joint reservation group not found.'; end if;
  if not public.is_member_of_property(v_property) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  update public.reservations set group_id=null where group_id=p_group_id;
end;
$$;

notify pgrst, 'reload schema';
