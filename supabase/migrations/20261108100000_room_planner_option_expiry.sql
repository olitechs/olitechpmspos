-- Room Planner option reservations expire 24 hours after creation.
-- Expiry is stored server-side; the planner and availability RPCs reconcile expired
-- options to cancelled, so expired options no longer block room inventory.
begin;

alter table public.reservations
  add column if not exists option_expires_at timestamptz;

create index if not exists reservations_option_expiry_idx
  on public.reservations(property_id, option_expires_at)
  where option_expires_at is not null and status = 'booked';

create or replace function public.fn_expire_room_planner_options(p_property_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_expired_count integer := 0;
  v_rooms uuid[];
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'You do not have access to this property.';
  end if;

  with expired as (
    update public.reservations r
       set status = 'cancelled'
     where r.property_id = p_property_id
       and r.status = 'booked'
       and r.option_expires_at is not null
       and r.option_expires_at <= now()
    returning r.room_id
  )
  select count(*)::integer, coalesce(array_agg(distinct room_id), '{}'::uuid[])
    into v_expired_count, v_rooms
    from expired;

  if cardinality(v_rooms) > 0 then
    update public.rooms rm
       set status = 'available'
     where rm.property_id = p_property_id
       and rm.id = any(v_rooms)
       and rm.status = 'booked'
       and not exists (
         select 1 from public.reservations r
          where r.property_id = p_property_id
            and r.room_id = rm.id
            and r.status in ('booked','checked-in')
       );
  end if;

  return v_expired_count;
end;
$function$;

create or replace function public.fn_set_reservation_option(
  p_reservation_id uuid,
  p_optioned boolean
) returns public.reservations
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_res public.reservations;
begin
  select r.* into v_res
    from public.reservations r
   where r.id = p_reservation_id
   for update;

  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then
    raise exception 'Access denied.';
  end if;
  if v_res.status <> 'booked' then
    raise exception 'Only a booked reservation can be optioned or confirmed.';
  end if;

  if coalesce(p_optioned, false) then
    if v_res.option_expires_at is not null then
      if v_res.option_expires_at <= now() then
        perform public.fn_expire_room_planner_options(v_res.property_id);
        raise exception 'This option has expired. Create a new reservation option if needed.';
      end if;
      return v_res; -- Repeated requests never extend the original 24-hour window.
    end if;

    update public.reservations
       set option_expires_at = now() + interval '24 hours'
     where id = p_reservation_id
     returning * into v_res;
  else
    if v_res.option_expires_at is not null and v_res.option_expires_at <= now() then
      perform public.fn_expire_room_planner_options(v_res.property_id);
      raise exception 'This option has expired and can no longer be confirmed.';
    end if;
    update public.reservations
       set option_expires_at = null
     where id = p_reservation_id
     returning * into v_res;
  end if;

  return v_res;
end;
$function$;

-- The optioned create path wraps the established transactional reservation bundle.
-- Existing validation, room locks, guest matching, payment ledger and booking metadata
-- remain authoritative. The expiry is applied in the same database transaction.
create or replace function public.fn_create_optioned_reservation_bundle(
  p_property_id uuid, p_room_ids uuid[], p_group_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_payment_status text, p_channel text, p_meal_plan text,
  p_adults integer, p_kids_count integer, p_kids_ages jsonb, p_total_amount numeric,
  p_amount_paid numeric, p_notes text, p_details jsonb
) returns setof public.reservations
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_res public.reservations;
  v_reservation_id uuid;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'You do not have access to this property.';
  end if;

  for v_res in
    select * from public.fn_create_reservation_bundle(
      p_property_id, p_room_ids, p_group_id, p_guest_name, p_phone,
      p_arrival, p_departure, p_payment_status, p_channel, p_meal_plan,
      p_adults, p_kids_count, p_kids_ages, p_total_amount, p_amount_paid,
      p_notes, p_details
    )
  loop
    v_reservation_id := v_res.id;
    update public.reservations
       set option_expires_at = coalesce(option_expires_at, now() + interval '24 hours')
     where id = v_reservation_id
       and property_id = p_property_id
       and status = 'booked'
       and option_expires_at is null
     returning * into v_res;
    if not found then
      select r.* into v_res
        from public.reservations r
       where r.id = v_reservation_id and r.property_id = p_property_id;
    end if;
    return next v_res;
  end loop;
end;
$function$;

-- Every availability check first reconciles expired options before testing overlap.
create or replace function public.fn_check_room_availability(
  p_property_id uuid, p_room_id uuid, p_arrival date, p_departure date,
  p_exclude_reservation_id uuid default null
)
returns table(available boolean, conflict_type text, conflict_id uuid, conflict_message text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_room_status text;
  v_res public.reservations;
  v_closure public.room_closures;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'Access denied.';
  end if;
  if p_departure <= p_arrival then
    return query select false, 'invalid_dates'::text, null::uuid, 'Check-out must be after check-in.'::text;
    return;
  end if;

  perform public.fn_expire_room_planner_options(p_property_id);
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || ':' || p_room_id::text, 0));

  select status::text into v_room_status
    from public.rooms
   where id = p_room_id and property_id = p_property_id and active = true;

  if v_room_status is null then
    return query select false, 'room'::text, null::uuid, 'Room not found or inactive.'::text;
    return;
  end if;
  if v_room_status in ('maintenance','out_of_service','blocked') then
    return query select false, 'room_status'::text, null::uuid,
      format('Room cannot be booked while its operational status is %s.', replace(v_room_status, '_', ' '))::text;
    return;
  end if;

  select r.* into v_res
    from public.reservations r
   where r.property_id = p_property_id
     and r.room_id = p_room_id
     and r.id is distinct from p_exclude_reservation_id
     and r.status in ('booked','checked-in')
     and r.arrival < p_departure and p_arrival < r.departure
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

-- Dedicated audit record for option creation and explicit confirmation.
create or replace function public.fn_audit_room_planner_option_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  if old.option_expires_at is not distinct from new.option_expires_at then return new; end if;

  insert into public.audit_logs(
    actor_id, property_id, action, old_value, new_value,
    entity_type, entity_id, related_reservation_id
  )
  values (
    auth.uid(),
    new.property_id,
    case when new.option_expires_at is null
      then 'pms_reservation_option_confirmed'
      else 'pms_reservation_option_created' end,
    jsonb_build_object('reservation_id', new.id, 'option_expires_at', old.option_expires_at),
    jsonb_build_object('reservation_id', new.id, 'option_expires_at', new.option_expires_at, 'validity_hours', 24),
    'reservation', new.id, new.id
  );

  return new;
end;
$function$;

drop trigger if exists trg_audit_room_planner_option_change on public.reservations;
create trigger trg_audit_room_planner_option_change
after update of option_expires_at on public.reservations
for each row execute function public.fn_audit_room_planner_option_change();

revoke all on function public.fn_expire_room_planner_options(uuid) from public, anon;
revoke all on function public.fn_set_reservation_option(uuid, boolean) from public, anon;
revoke all on function public.fn_create_optioned_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text,jsonb) from public, anon;
revoke all on function public.fn_audit_room_planner_option_change() from public, anon;

grant execute on function public.fn_expire_room_planner_options(uuid) to authenticated, service_role;
grant execute on function public.fn_set_reservation_option(uuid, boolean) to authenticated, service_role;
grant execute on function public.fn_create_optioned_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text,jsonb) to authenticated, service_role;
grant execute on function public.fn_audit_room_planner_option_change() to authenticated, service_role;
grant execute on function public.fn_check_room_availability(uuid,uuid,date,date,uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
