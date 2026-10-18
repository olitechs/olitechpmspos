-- Extend POS payment methods and bind every new sale to the active POS shift.
alter table public.pos_receipts drop constraint if exists pos_receipts_payment_method_check;
alter table public.pos_receipts add constraint pos_receipts_payment_method_check check (payment_method in ('cash','card','mpesa','bank','room'));
create or replace function public.fn_record_pos_sale(
  p_property_id uuid,p_table_number text,p_order_number text,p_items jsonb,p_subtotal numeric,
  p_discount_amount numeric,p_vat numeric,p_total numeric,p_payment_method text,p_reservation_id uuid default null,
  p_shift_id uuid default null
) returns public.pos_receipts language plpgsql security definer set search_path=public as $$
declare v_receipt public.pos_receipts; v_room_id uuid; v_room_number text; v_guest_name text; v_folio_charge_id uuid; v_res_property uuid; v_shift uuid;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_payment_method not in ('cash','card','mpesa','bank','room') then raise exception 'Unknown payment method.'; end if;
 if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;
 v_shift:=p_shift_id;
 if v_shift is null then select id into v_shift from public.pos_shifts where property_id=p_property_id and status='open' and date=(now() at time zone 'Africa/Nairobi')::date order by opened_at desc limit 1; end if;
 if v_shift is null then raise exception 'Open a POS shift before recording sales.'; end if;
 if not exists(select 1 from public.pos_shifts where id=v_shift and property_id=p_property_id and status='open') then raise exception 'The selected POS shift is not open.'; end if;
 if p_payment_method='room' then
   if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
   select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id;
   if v_res_property is null or v_res_property<>p_property_id then raise exception 'Reservation not found.'; end if;
   insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total) returning id into v_folio_charge_id;
 end if;
 insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,items,subtotal,discount_amount,vat,total,payment_method,folio_charge_id,created_by,shift_id)
 values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),v_shift)
 returning * into v_receipt;
 return v_receipt;
end $$;
grant execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';