-- Phase 3 — Front Office operational room-status reconciliation.
-- Keep rooms available for future reservations; booked/occupied are current-day
-- operational states. Housekeeping states remain authoritative.
--
-- The legacy reservation functions still update rooms.status='booked'. This
-- trigger normalizes that write using the active reservation dates, so the
-- existing booking/move/delete/check-in workflow remains intact.

create or replace function public.fn_sync_booked_room_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_checked_in boolean;
  v_has_current_booking boolean;
begin
  if new.status <> 'booked' then
    return new;
  end if;

  select exists (
    select 1
    from public.reservations r
    where r.room_id = new.id
      and r.status = 'checked-in'
      and r.arrival <= (now() at time zone 'Africa/Nairobi')::date
      and r.departure > (now() at time zone 'Africa/Nairobi')::date
  ) into v_has_checked_in;

  if v_has_checked_in then
    update public.rooms set status = 'occupied'
    where id = new.id and status = 'booked';
    return new;
  end if;

  select exists (
    select 1
    from public.reservations r
    where r.room_id = new.id
      and r.status = 'booked'
      and r.arrival <= (now() at time zone 'Africa/Nairobi')::date
      and r.departure > (now() at time zone 'Africa/Nairobi')::date
  ) into v_has_current_booking;

  if not v_has_current_booking then
    update public.rooms set status = 'available'
    where id = new.id and status = 'booked';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_booked_room_status on public.rooms;
create trigger trg_sync_booked_room_status
after update of status on public.rooms
for each row
when (new.status = 'booked')
execute function public.fn_sync_booked_room_status();

update public.rooms r
set status = 'available'
where r.status = 'booked'
  and not exists (
    select 1
    from public.reservations x
    where x.room_id = r.id
      and x.status in ('booked','checked-in')
      and x.arrival <= (now() at time zone 'Africa/Nairobi')::date
      and x.departure > (now() at time zone 'Africa/Nairobi')::date
  );

revoke execute on function public.fn_sync_booked_room_status() from public, anon, authenticated;
notify pgrst, 'reload schema';
