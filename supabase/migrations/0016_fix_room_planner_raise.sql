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

    return next v_res;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
