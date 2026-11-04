-- Phase 1 reservation registration expansion.
-- Additive only: the established reservation bundle remains the transactional
-- source of truth for availability, room locking, guest matching and payments.
begin;

alter table public.guests
  add column if not exists alternative_phone text,
  add column if not exists residence_country text,
  add column if not exists id_type text,
  add column if not exists guest_details jsonb not null default '{}'::jsonb;

alter table public.reservations
  add column if not exists booking_details jsonb not null default '{}'::jsonb;

-- Keep the existing transaction-scoped property/room lock, while explicitly
-- preventing reservations against rooms that are operationally unavailable.
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

-- New overload: persist guest/booking metadata in the same transaction as the
-- existing reservation bundle. The 16-argument RPC remains for older clients.
create or replace function public.fn_create_reservation_bundle(
  p_property_id uuid, p_room_ids uuid[], p_group_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_payment_status text, p_channel text, p_meal_plan text,
  p_adults int, p_kids_count int, p_kids_ages jsonb, p_total_amount numeric,
  p_amount_paid numeric, p_notes text, p_details jsonb
) returns setof public.reservations
language plpgsql security invoker set search_path = public
as $function$
declare
  v_res public.reservations;
  v_capacity integer;
  v_guest jsonb := coalesce(p_details->'guest', '{}'::jsonb);
  v_booking jsonb := coalesce(p_details->'booking', '{}'::jsonb);
  v_submission_id text := nullif(trim(v_booking->>'submissionId'), '');
  v_existing_count integer := 0;
  v_guest_by_email uuid;
  v_guest_by_phone uuid;
  v_existing_phone text;
  v_phone_for_bundle text := nullif(trim(p_phone), '');
  v_email text := nullif(lower(trim(v_guest->>'email')), '');
  v_lock_key text;
  v_room_count integer := cardinality(coalesce(p_room_ids, '{}'::uuid[]));
  v_room_index integer := 0;
  v_total_distributed numeric := 0;
  v_paid_distributed numeric := 0;
  v_room_total numeric := 0;
  v_room_payment numeric := 0;
  v_payment_method text := coalesce(nullif(trim(v_booking->>'depositMethod'), ''), 'cash');
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'You do not have access to this property.';
  end if;

  if v_submission_id is not null then
    if length(v_submission_id) > 128 then raise exception 'Invalid reservation submission identifier.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || ':reservation-submit:' || v_submission_id, 0));
    select count(*)::integer into v_existing_count
    from public.reservations r
    where r.property_id = p_property_id and r.booking_details->>'submissionId' = v_submission_id;
    if v_existing_count > 0 then
      return query select r.* from public.reservations r
      where r.property_id = p_property_id and r.booking_details->>'submissionId' = v_submission_id
      order by r.created_at, r.id;
      return;
    end if;
  end if;

  select coalesce(sum(coalesce(r.capacity, 2)), 0)::integer into v_capacity
  from public.rooms r
  where r.property_id = p_property_id and r.id = any(coalesce(p_room_ids, '{}'::uuid[])) and r.active = true;

  if v_capacity < coalesce(p_adults, 0) + coalesce(p_kids_count, 0) then
    raise exception 'Selected rooms do not have enough combined guest capacity.';
  end if;

  if coalesce(p_total_amount, 0) < 0 or coalesce(p_amount_paid, 0) < 0 or coalesce(p_amount_paid, 0) > coalesce(p_total_amount, 0) then
    raise exception 'Reservation total and deposit amounts are invalid.';
  end if;

  if nullif(v_booking->>'ratePlanId', '') is not null and not exists (
    select 1 from public.rate_plans rp
    where rp.id = (v_booking->>'ratePlanId')::uuid and rp.property_id = p_property_id and rp.active = true
  ) then
    raise exception 'Selected rate plan is not active for this property.';
  end if;

  -- Serialize guest matching by normalized email and phone. The legacy bundle
  -- matches by phone, so use the matched profile's primary phone when an email
  -- match exists; this prevents duplicate guest profiles on repeat bookings.
  for v_lock_key in
    select lock_key from unnest(array[
      case when v_email is not null then p_property_id::text || ':guest-email:' || v_email end,
      case when v_phone_for_bundle is not null then p_property_id::text || ':guest-phone:' || v_phone_for_bundle end
    ]) as lock_keys(lock_key)
    where lock_key is not null order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  end loop;

  if v_email is not null then
    select g.id into v_guest_by_email
    from public.guests g
    where g.property_id = p_property_id and lower(trim(g.email)) = v_email
    order by g.created_at, g.id limit 1;
  end if;

  if v_phone_for_bundle is not null then
    select g.id into v_guest_by_phone
    from public.guests g
    where g.property_id = p_property_id and g.phone = v_phone_for_bundle
    order by g.created_at, g.id limit 1;
  end if;

  if v_guest_by_email is not null and v_guest_by_phone is not null and v_guest_by_email <> v_guest_by_phone then
    raise exception 'The supplied email and phone belong to different guest profiles. Review the guest record before continuing.';
  end if;

  if v_guest_by_email is not null then
    select g.phone into v_existing_phone from public.guests g where g.id = v_guest_by_email for update;
    if nullif(trim(v_existing_phone), '') is not null then
      v_phone_for_bundle := v_existing_phone;
    elsif v_phone_for_bundle is not null then
      update public.guests set phone = v_phone_for_bundle where id = v_guest_by_email;
    end if;
  end if;

  for v_res in
    select * from public.fn_create_reservation_bundle(
      p_property_id, p_room_ids, p_group_id, p_guest_name, v_phone_for_bundle,
      p_arrival, p_departure, 'not_paid', p_channel, p_meal_plan,
      p_adults, p_kids_count, p_kids_ages, p_total_amount, 0, p_notes
    )
  loop
    update public.guests
    set email = coalesce(nullif(trim(v_guest->>'email'), ''), email),
        nationality = coalesce(nullif(trim(v_guest->>'nationality'), ''), nationality),
        id_number = coalesce(nullif(trim(v_guest->>'idNumber'), ''), id_number),
        address = coalesce(nullif(trim(v_guest->>'address'), ''), address),
        notes = coalesce(nullif(trim(v_guest->>'notes'), ''), notes),
        alternative_phone = coalesce(nullif(trim(v_guest->>'alternativePhone'), ''),
          case when nullif(trim(p_phone), '') is not null and nullif(trim(p_phone), '') is distinct from phone then nullif(trim(p_phone), '') else alternative_phone end),
        residence_country = coalesce(nullif(trim(v_guest->>'residenceCountry'), ''), residence_country),
        id_type = coalesce(nullif(trim(v_guest->>'idType'), ''), id_type),
        guest_details = coalesce(guest_details, '{}'::jsonb) || v_guest
    where id = v_res.guest_id and property_id = p_property_id;

    v_room_index := v_room_index + 1;
    if v_room_index < v_room_count then
      v_room_total := round(coalesce(p_total_amount, 0) / greatest(1, v_room_count), 2);
      v_total_distributed := v_total_distributed + v_room_total;
      v_room_payment := round(coalesce(p_amount_paid, 0) / greatest(1, v_room_count), 2);
      v_paid_distributed := v_paid_distributed + v_room_payment;
    else
      v_room_total := greatest(0, coalesce(p_total_amount, 0) - v_total_distributed);
      v_room_payment := greatest(0, coalesce(p_amount_paid, 0) - v_paid_distributed);
    end if;

    update public.reservations
    set phone = nullif(trim(p_phone), ''),
        total_amount = v_room_total,
        amount_paid = 0,
        payment_status = 'not_paid',
        booking_details = coalesce(booking_details, '{}'::jsonb) || v_booking || jsonb_build_object('submissionId', v_submission_id),
        rate_plan_id = coalesce(nullif(v_booking->>'ratePlanId', '')::uuid, rate_plan_id),
        rate = round(
          coalesce(nullif((v_booking->>'accommodationSubtotal')::numeric, 0), p_total_amount)
          / greatest(1, (p_departure - p_arrival) * cardinality(p_room_ids)), 2
        )
    where id = v_res.id and property_id = p_property_id
    returning * into v_res;

    -- A received deposit is a real, posted front-desk payment, not just a
    -- reservation balance field. Any failure rolls back the entire booking.
    if v_room_payment > 0 then
      perform public.fn_record_front_desk_payment(
        p_property_id, v_res.id, v_room_payment, v_payment_method, null
      );
      select * into v_res from public.reservations where id = v_res.id;
    end if;

    return next v_res;
  end loop;
end;
$function$;

revoke execute on function public.fn_create_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text,jsonb) from public, anon;
grant execute on function public.fn_create_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text,jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
