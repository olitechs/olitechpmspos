-- Phase 2 Front Office PMS financial and lifecycle hardening
create or replace function public.fn_remove_reservation(p_reservation_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_res public.reservations;
begin
  select * into v_res from public.reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if not public.is_member_of_property(v_res.property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if v_res.status <> 'booked' then raise exception 'Only booked reservations can be cancelled.'; end if;
  update public.reservations set status='cancelled' where id=p_reservation_id;
  if not exists (select 1 from public.reservations where room_id=v_res.room_id and status in ('booked','checked-in')) then
    update public.rooms set status='available' where id=v_res.room_id and property_id=v_res.property_id and status='booked';
  end if;
end; $$;

create or replace function public.fn_record_front_desk_payment(p_property_id uuid,p_reservation_id uuid,p_amount numeric,p_method text,p_shift_id uuid default null)
returns public.payments language plpgsql security invoker set search_path=public as $$
declare v_res public.reservations; v_payment public.payments; v_outstanding numeric;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(trim(p_method),'') is null then raise exception 'Payment method is required.'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.status='cancelled' then raise exception 'Cannot post a payment to a cancelled reservation.'; end if;
  if v_res.status='checked-out' then raise exception 'Reservation is already checked out.'; end if;
  v_outstanding:=greatest(0,
    coalesce((select sum(c.amount) from public.folio_charges c where c.reservation_id=v_res.id),0) -
    coalesce((select sum(p.amount) from public.payments p where p.reservation_id=v_res.id and p.status='posted'),0));
  if p_amount > v_outstanding+0.005 then raise exception 'Payment exceeds the current folio balance of %.',round(v_outstanding,2); end if;
  insert into public.payments(property_id,reservation_id,amount,method,status,shift_id)
  values(p_property_id,p_reservation_id,round(p_amount,2),trim(p_method),'posted',p_shift_id)
  returning * into v_payment;
  return v_payment;
end; $$;

revoke execute on function public.fn_upsert_guest(uuid,text,text) from public,anon;
revoke execute on function public.fn_add_reservation(uuid,uuid,text,text,date,date,integer,numeric) from public,anon;
revoke execute on function public.fn_remove_reservation(uuid) from public,anon;
revoke execute on function public.fn_update_planner_reservation(uuid,uuid,date,date,text,text,text,text,integer,integer,jsonb,numeric,numeric,text) from public,anon;
revoke execute on function public.fn_delete_planner_reservation(uuid) from public,anon;
revoke execute on function public.fn_move_planner_reservation(uuid,uuid,date,date) from public,anon;
revoke execute on function public.fn_move_reservation_group(uuid,uuid,uuid,date,date) from public,anon;
revoke execute on function public.fn_add_room_to_reservation_group(uuid,uuid) from public,anon;
revoke execute on function public.fn_split_reservation_group(uuid) from public,anon;
revoke execute on function public.fn_create_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text) from public,anon;
revoke execute on function public.fn_record_front_desk_payment(uuid,uuid,numeric,text,uuid) from public,anon;
grant execute on function public.fn_upsert_guest(uuid,text,text) to authenticated,service_role;
grant execute on function public.fn_add_reservation(uuid,uuid,text,text,date,date,integer,numeric) to authenticated,service_role;
grant execute on function public.fn_remove_reservation(uuid) to authenticated,service_role;
grant execute on function public.fn_update_planner_reservation(uuid,uuid,date,date,text,text,text,text,integer,integer,jsonb,numeric,numeric,text) to authenticated,service_role;
grant execute on function public.fn_delete_planner_reservation(uuid) to authenticated,service_role;
grant execute on function public.fn_move_planner_reservation(uuid,uuid,date,date) to authenticated,service_role;
grant execute on function public.fn_move_reservation_group(uuid,uuid,uuid,date,date) to authenticated,service_role;
grant execute on function public.fn_add_room_to_reservation_group(uuid,uuid) to authenticated,service_role;
grant execute on function public.fn_split_reservation_group(uuid) to authenticated,service_role;
grant execute on function public.fn_create_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text) to authenticated,service_role;
grant execute on function public.fn_record_front_desk_payment(uuid,uuid,numeric,text,uuid) to authenticated,service_role;

create or replace function public.fn_check_in_reservation(p_reservation_id uuid)
returns public.reservations language plpgsql security invoker set search_path=public as $$
declare v_res public.reservations;
begin
  select r.* into v_res from public.reservations r where r.id=p_reservation_id and public.is_member_of_property(r.property_id);
  if v_res.id is null then raise exception 'Reservation not found or not allowed.'; end if;
  if v_res.status<>'booked' then raise exception 'Reservation is not in a bookable state.'; end if;
  if v_res.arrival>=v_res.departure then raise exception 'Reservation dates are invalid.'; end if;
  if not exists(select 1 from public.rooms rm where rm.id=v_res.room_id and rm.property_id=v_res.property_id and rm.status in ('available','booked')) then raise exception 'Assigned room is not available for check-in.'; end if;
  update public.reservations set status='checked-in' where id=v_res.id returning * into v_res;
  update public.rooms set status='occupied' where id=v_res.room_id and property_id=v_res.property_id;
  if not exists(select 1 from public.folio_charges where reservation_id=v_res.id and source='room') then
    insert into public.folio_charges(property_id,reservation_id,source,description,amount)
    values(v_res.property_id,v_res.id,'room','Room charge',v_res.rate*greatest(1,(v_res.departure-v_res.arrival)));
  end if;
  return v_res;
end; $$;
revoke execute on function public.fn_check_in_reservation(uuid) from public,anon;
grant execute on function public.fn_check_in_reservation(uuid) to authenticated,service_role;
