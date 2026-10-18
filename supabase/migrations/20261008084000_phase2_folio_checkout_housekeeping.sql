create or replace function public.fn_add_folio_charge(p_property_id uuid,p_reservation_id uuid,p_source text,p_description text,p_amount numeric)
returns public.folio_charges language plpgsql security invoker set search_path=public as $$
declare v_res public.reservations; v_charge public.folio_charges;
begin
 if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Charge amount must be greater than zero.'; end if;
 if nullif(trim(p_description),'') is null then raise exception 'Charge description is required.'; end if;
 if p_source not in ('room','pos','other','adjustment') then raise exception 'Invalid charge source.'; end if;
 select * into v_res from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if v_res.id is null then raise exception 'Reservation not found.'; end if;
 if v_res.status in ('cancelled','checked-out') then raise exception 'Reservation is not open for charges.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount)
 values(p_property_id,p_reservation_id,trim(p_source),trim(p_description),round(p_amount,2)) returning * into v_charge;
 return v_charge;
end; $$;
revoke execute on function public.fn_add_folio_charge(uuid,uuid,text,text,numeric) from public,anon;
grant execute on function public.fn_add_folio_charge(uuid,uuid,text,text,numeric) to authenticated,service_role;

drop function if exists public.fn_check_out_room(uuid);
create function public.fn_check_out_room(p_room_id uuid)
returns public.reservations language plpgsql security invoker set search_path=public as $$
declare v_res public.reservations; v_balance numeric;
begin
 select r.* into v_res from public.reservations r join public.rooms rm on rm.id=r.room_id and rm.property_id=r.property_id
 where r.room_id=p_room_id and r.status='checked-in' and public.is_member_of_property(r.property_id) for update;
 if v_res.id is null then raise exception 'No checked-in reservation found for this room.'; end if;
 v_balance:=greatest(0,coalesce((select sum(c.amount) from public.folio_charges c where c.reservation_id=v_res.id),0)-coalesce((select sum(p.amount) from public.payments p where p.reservation_id=v_res.id and p.status='posted'),0));
 if v_balance>0.005 then raise exception 'Cannot check out with an outstanding folio balance of %.',round(v_balance,2); end if;
 update public.reservations set status='checked-out',payment_status='paid',amount_paid=coalesce((select sum(p.amount) from public.payments p where p.reservation_id=v_res.id and p.status='posted'),0) where id=v_res.id;
 update public.rooms set status='dirty' where id=p_room_id and property_id=v_res.property_id;
 if not exists(select 1 from public.housekeeping_tasks where room_id=p_room_id and task_type='checkout_clean' and status not in ('completed','cancelled')) then
   insert into public.housekeeping_tasks(property_id,room_id,task_type,priority,status,reservation_id,notes,due_at)
   values(v_res.property_id,p_room_id,'checkout_clean','high','pending',v_res.id,'Checkout cleaning required',now());
 end if;
 return (select * from public.reservations where id=v_res.id);
end;
$$;
revoke execute on function public.fn_check_out_room(uuid) from public,anon;
grant execute on function public.fn_check_out_room(uuid) to authenticated,service_role;