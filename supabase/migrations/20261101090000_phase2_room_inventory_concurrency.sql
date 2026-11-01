begin;

-- Serialize room-inventory writes per property. A property-level advisory lock
-- avoids lock-order deadlocks for multi-room/group reservations and closures.
-- The trigger checks are the final authority; UI availability checks are advisory.
create or replace function public.fn_guard_room_reservation_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_conflict_id uuid;
  v_closure_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.property_id is not distinct from old.property_id
     and new.room_id is not distinct from old.room_id
     and new.arrival is not distinct from old.arrival
     and new.departure is not distinct from old.departure
     and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status::text not in ('booked', 'checked-in') then
    return new;
  end if;

  if new.arrival is null or new.departure is null or new.departure <= new.arrival then
    raise exception using
      errcode = '22007',
      message = 'Check-out must be after check-in.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pms-room-inventory:' || new.property_id::text, 0)
  );

  select r.id
    into v_conflict_id
  from public.reservations r
  where r.property_id = new.property_id
    and r.room_id = new.room_id
    and r.id is distinct from new.id
    and r.status::text in ('booked', 'checked-in')
    and r.arrival < new.departure
    and new.arrival < r.departure
  order by r.arrival
  limit 1;

  if v_conflict_id is not null then
    raise exception using
      errcode = '23P01',
      message = format('Room is already reserved for an overlapping stay (reservation %s).', v_conflict_id);
  end if;

  select c.id
    into v_closure_id
  from public.room_closures c
  where c.property_id = new.property_id
    and c.room_id = new.room_id
    and c.start_date < new.departure
    and new.arrival < c.end_date
  order by c.start_date
  limit 1;

  if v_closure_id is not null then
    raise exception using
      errcode = '23P01',
      message = format('Room is closed for part of the selected stay (closure %s).', v_closure_id);
  end if;

  return new;
end;
$function$;

create or replace function public.fn_guard_room_closure_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_conflict_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.property_id is not distinct from old.property_id
     and new.room_id is not distinct from old.room_id
     and new.start_date is not distinct from old.start_date
     and new.end_date is not distinct from old.end_date then
    return new;
  end if;

  if new.start_date is null or new.end_date is null or new.end_date <= new.start_date then
    raise exception using
      errcode = '22007',
      message = 'Room closure end date must be after its start date.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pms-room-inventory:' || new.property_id::text, 0)
  );

  select r.id
    into v_conflict_id
  from public.reservations r
  where r.property_id = new.property_id
    and r.room_id = new.room_id
    and r.status::text in ('booked', 'checked-in')
    and r.arrival < new.end_date
    and new.start_date < r.departure
  order by r.arrival
  limit 1;

  if v_conflict_id is not null then
    raise exception using
      errcode = '23P01',
      message = format('Room closure overlaps an active reservation (reservation %s).', v_conflict_id);
  end if;

  return new;
end;
$function$;

drop trigger if exists reservations_room_inventory_overlap_guard on public.reservations;
create trigger reservations_room_inventory_overlap_guard
before insert or update of property_id, room_id, arrival, departure, status
on public.reservations
for each row execute function public.fn_guard_room_reservation_overlap();

drop trigger if exists room_closures_reservation_overlap_guard on public.room_closures;
create trigger room_closures_reservation_overlap_guard
before insert or update of property_id, room_id, start_date, end_date
on public.room_closures
for each row execute function public.fn_guard_room_closure_overlap();

-- Trigger-only functions must not be callable as general-purpose RPCs.
revoke all on function public.fn_guard_room_reservation_overlap() from public, anon, authenticated;
revoke all on function public.fn_guard_room_closure_overlap() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
