create or replace function public.fn_walk_in_check_in(p_property_id uuid,p_room_id uuid,p_guest_name text,p_phone text,p_check_in date,p_check_out date,p_party_size integer,p_rate numeric)
returns public.reservations language plpgsql security invoker set search_path=public as $$
declare v_guest_id uuid; v_res public.reservations;
begin
  if not public.is_member_of_property(p_property_id) then raise exception 'Not allowed.'; end if;
  if nullif(trim(p_guest_name),'') is null then raise exception 'Guest name is required.'; end if;
  if p_check_out<=p_check_in then raise exception 'Check-out must be after check-in.'; end if;
  if coalesce(p_party_size,0)<1 then raise exception 'Party size must be at least 1.'; end if;
  if coalesce(p_rate,0)<0 then raise exception 'Rate cannot be negative.'; end if;
  if not exists(select 1 from public.rooms where id=p_room_id and property_id=p_property_id and status='available') then raise exception 'Room is not available.'; end if;
  v_guest_id:=public.fn_upsert_guest(p_property_id,trim(p_guest_name),nullif(trim(p_phone),''));
  insert into public.reservations(property_id,room_id,guest_id,guest_name,phone,arrival,departure,party_size,rate,status,total_amount,amount_paid,payment_status)
  values(p_property_id,p_room_id,v_guest_id,trim(p_guest_name),nullif(trim(p_phone),''),p_check_in,p_check_out,coalesce(p_party_size,1),coalesce(p_rate,0),'checked-in',coalesce(p_rate,0),0,'not_paid')
  returning * into v_res;
  update public.rooms set status='occupied' where id=p_room_id and property_id=p_property_id;
  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
  values(v_res.property_id,v_res.id,'room','Room charge',v_res.rate*greatest(1,(v_res.departure-v_res.arrival)));
  return v_res;
end; $$;
revoke execute on function public.fn_walk_in_check_in(uuid,uuid,text,text,date,date,integer,numeric) from public,anon;
grant execute on function public.fn_walk_in_check_in(uuid,uuid,text,text,date,date,integer,numeric) to authenticated,service_role;