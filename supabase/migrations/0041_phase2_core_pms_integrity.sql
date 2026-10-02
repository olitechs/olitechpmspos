-- OliTechs PMS+POS — Phase 2 Core PMS integrity
-- 0041: authoritative reservation availability + folio ledger hardening.
-- Additive: existing UI, Room Planner behavior, POS, KDS, printers, Cashier
-- and Night Audit are preserved.

create index if not exists reservations_room_dates_idx
  on public.reservations(property_id, room_id, arrival, departure);
create index if not exists payments_reservation_created_idx
  on public.payments(reservation_id, created_at);

-- Serialize concurrent reservation writes for the same property/room. The
-- existing overlap trigger becomes the final database-level race protection.
create or replace function public.prevent_reservation_overlap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.property_id::text || ':' || new.room_id::text, 0)
  );

  if new.departure <= new.arrival then
    raise exception 'Departure date must be after arrival date.';
  end if;

  if not exists (
    select 1 from public.rooms r
    where r.id = new.room_id
      and r.property_id = new.property_id
      and coalesce(r.active, true) = true
  ) then
    raise exception 'Room does not belong to the reservation property or is inactive.';
  end if;

  if new.status in ('booked', 'checked-in') then
    if exists (
      select 1
      from public.reservations r
      where r.room_id = new.room_id
        and r.property_id = new.property_id
        and r.id <> new.id
        and r.status in ('booked', 'checked-in')
        and new.arrival < r.departure
        and new.departure > r.arrival
    ) then
      raise exception 'Room is already reserved for part of this stay.';
    end if;

    if exists (
      select 1 from public.room_closures c
      where c.property_id = new.property_id
        and c.room_id = new.room_id
        and c.start_date < new.departure
        and new.arrival < c.end_date
    ) then
      raise exception 'Room is closed for part of the selected stay.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_no_overlap on public.reservations;
create trigger reservations_no_overlap
before insert or update on public.reservations
for each row execute function public.prevent_reservation_overlap();

-- Server-authoritative availability endpoint for Room Rack/Planner consumers.
create or replace function public.fn_get_available_rooms(
  p_property_id uuid,
  p_arrival date,
  p_departure date,
  p_room_type_id uuid default null
)
returns setof public.rooms
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception 'You do not have access to this property.';
  end if;
  if p_departure <= p_arrival then
    raise exception 'Check-out must be after check-in.';
  end if;

  return query
  select r.*
  from public.rooms r
  where r.property_id = p_property_id
    and coalesce(r.active, true) = true
    and r.status not in ('maintenance','out_of_service','blocked')
    and (p_room_type_id is null or r.room_type_id = p_room_type_id)
    and not exists (
      select 1 from public.reservations x
      where x.property_id = p_property_id
        and x.room_id = r.id
        and x.status in ('booked','checked-in')
        and x.arrival < p_departure
        and p_arrival < x.departure
    )
    and not exists (
      select 1 from public.room_closures c
      where c.property_id = p_property_id
        and c.room_id = r.id
        and c.start_date < p_departure
        and p_arrival < c.end_date
    )
  order by r.number;
end;
$$;

-- Replace the planner creation function with the same production logic as
-- 0016 plus payment-ledger reconciliation for amount_paid.
-- OliTechs PMS/POS — Hotfix for Room Planner RAISE compilation
-- Replaces format-string RAISE usage with RAISE ... USING MESSAGE.

create or replace function public.fn_create_reservation_bundle(
  p_property_id uuid, p_room_ids uuid[], p_group_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_payment_status text, p_channel text, p_meal_plan text,
  p_adults int, p_kids_count int, p_kids_ages jsonb, p_total_amount numeric, p_amount_paid numeric, p_notes text
) returns setof public.reservations
language plpgsql security invoker
as $$
declare
  v_guest_id uuid;
  v_room_id uuid;
  v_group uuid := case when coalesce(array_length(p_room_ids,1),0) > 1 then coalesce(p_group_id,gen_random_uuid()) else null end;
  v_count int := greatest(coalesce(array_length(p_room_ids,1),0),1);
  v_total numeric := greatest(coalesce(p_total_amount,0),0);
  v_paid numeric := greatest(coalesce(p_amount_paid,0),0);
  v_share numeric;
  v_res public.reservations;
  v_ok boolean;
  v_type text;
  v_conflict uuid;
  v_message text;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then
    raise exception using message='You do not have access to this property.';
  end if;
  if nullif(trim(p_guest_name),'') is null then
    raise exception using message='Guest name is required.';
  end if;
  if p_departure <= p_arrival then
    raise exception using message='Check-out must be after check-in.';
  end if;
  if coalesce(p_adults,0) < 1 or p_adults > 10 then
    raise exception using message='Adults must be between 1 and 10.';
  end if;
  if coalesce(p_kids_count,0) < 0 or p_kids_count > 6 then
    raise exception using message='Kids must be between 0 and 6.';
  end if;
  if p_payment_status not in ('fully_paid','not_paid','partially_paid') then
    raise exception using message='Invalid payment status.';
  end if;
  if p_channel not in ('direct','booking_com','unknown') then
    raise exception using message='Invalid reservation channel.';
  end if;
  if p_meal_plan not in ('bed_only','bb','half_board','full_board') then
    raise exception using message='Invalid meal plan.';
  end if;
  if v_paid > v_total then
    raise exception using message='Amount Paid cannot exceed Total Amount.';
  end if;
  if p_payment_status='fully_paid' and v_paid<>v_total then
    raise exception using message='Fully paid reservations must have Amount Paid equal to Total Amount.';
  end if;
  if p_payment_status='partially_paid'
     and (v_paid>=v_total or (v_total>0 and v_paid<v_total*0.5)) then
    raise exception using message='Partially paid reservations must be below total and at least 50% paid.';
  end if;
  if p_payment_status='not_paid' and v_paid<>0 then
    raise exception using message='Not paid reservations must have Amount Paid set to zero.';
  end if;
  if coalesce(array_length(p_room_ids,1),0)=0 then
    raise exception using message='At least one room is required.';
  end if;
  if (select count(*) from unnest(p_room_ids) x) <>
     (select count(distinct x) from unnest(p_room_ids) x) then
    raise exception using message='A room cannot be assigned twice.';
  end if;

  for v_room_id in select unnest(p_room_ids) loop
    select a.available,a.conflict_type,a.conflict_id,a.conflict_message
      into v_ok,v_type,v_conflict,v_message
    from public.fn_check_room_availability(
      p_property_id,v_room_id,p_arrival,p_departure,null
    ) a;

    if not coalesce(v_ok,false) then
      raise exception using message=coalesce(
        v_message,
        'Room is unavailable for the selected dates.'
      );
    end if;
  end loop;

  if p_phone is not null and trim(p_phone)<>'' then
    select id into v_guest_id
    from public.guests
    where property_id=p_property_id and phone=p_phone
    limit 1;
  end if;

  if v_guest_id is null then
    insert into public.guests(property_id,name,phone)
    values(p_property_id,trim(p_guest_name),nullif(trim(p_phone),''))
    returning id into v_guest_id;
  end if;

  v_share:=round(v_total/v_count,2);

  for v_room_id in select unnest(p_room_ids) loop
    insert into public.reservations(
      property_id,room_id,guest_id,guest_name,phone,arrival,departure,party_size,
      rate,status,notes,group_id,payment_status,channel,meal_plan,adults,
      children,kids_count,kids_ages,total_amount,amount_paid,special_requests
    )
    values(
      p_property_id,v_room_id,v_guest_id,trim(p_guest_name),nullif(trim(p_phone),''),
      p_arrival,p_departure,coalesce(p_adults,1)+coalesce(p_kids_count,0),
      case when v_count=1 then v_total else v_share end,'booked',p_notes,
      v_group,p_payment_status,p_channel,p_meal_plan,p_adults,p_kids_count,p_kids_count,
      coalesce(p_kids_ages,'[]'::jsonb),
      case when v_count=1 then v_total else v_share end,
      case when v_count=1 then v_paid
           else v_share*case when v_total>0 then v_paid/v_total else 0 end end,
      p_notes
    )
    returning * into v_res;

    -- Reconcile the reservation's initial deposit into the authoritative payment ledger.
    if coalesce(v_res.amount_paid, 0) > 0 then
      insert into public.payments(property_id, reservation_id, amount, method)
      values (v_res.property_id, v_res.id, v_res.amount_paid, 'reservation_deposit');
    end if;

    return next v_res;
  end loop;
end;
$$;

notify pgrst, 'reload schema';


-- Folio writes go through RPCs so property_id is derived from the reservation
-- and payment/charge writes are transactionally checked server-side.
create or replace function public.fn_add_folio_charge(
  p_property_id uuid,
  p_reservation_id uuid,
  p_source text,
  p_description text,
  p_amount numeric
)
returns public.folio_charges
language plpgsql
security invoker
set search_path = public
as $$
declare v_res public.reservations; v_charge public.folio_charges;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.property_id <> p_property_id then raise exception 'Reservation does not belong to this property.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Charge amount must be greater than zero.'; end if;
  if p_source not in ('room','pos','other') then raise exception 'Invalid folio charge source.'; end if;
  if nullif(trim(p_description),'') is null then raise exception 'Charge description is required.'; end if;

  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
  values(v_res.property_id,v_res.id,p_source,trim(p_description),round(p_amount,2))
  returning * into v_charge;
  return v_charge;
end;
$$;

create or replace function public.fn_record_folio_payment(
  p_property_id uuid,
  p_reservation_id uuid,
  p_amount numeric,
  p_method text
)
returns public.payments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_res public.reservations;
  v_balance numeric;
  v_payment public.payments;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.property_id <> p_property_id then raise exception 'Reservation does not belong to this property.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if p_method not in ('cash','card','mpesa','bank_transfer','room_charge','reservation_deposit') then raise exception 'Invalid payment method.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text, 0));

  select coalesce((select sum(amount) from public.folio_charges where reservation_id=v_res.id),0)
       - coalesce((select sum(amount) from public.payments where reservation_id=v_res.id),0)
    into v_balance;

  if p_amount > greatest(v_balance,0) then
    raise exception 'Payment exceeds the outstanding folio balance of %.', round(greatest(v_balance,0),2);
  end if;

  insert into public.payments(property_id,reservation_id,amount,method)
  values(v_res.property_id,v_res.id,round(p_amount,2),p_method)
  returning * into v_payment;

  return v_payment;
end;
$$;

notify pgrst, 'reload schema';
