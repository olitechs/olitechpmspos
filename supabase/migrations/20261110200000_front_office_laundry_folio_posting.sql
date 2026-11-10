-- Create a laundry order and its matching guest folio charge atomically.
create or replace function public.fn_create_laundry_order_with_folio(
 p_property_id uuid,p_reservation_id uuid,p_items jsonb,p_notes text default null
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_res public.reservations;v_order public.laundry_orders;v_total numeric(14,2);v_item jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required.';end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized for this property.';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one laundry item is required.';end if;
 select * into v_res from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if v_res.id is null then raise exception 'Reservation not found for this property.';end if;
 if v_res.status::text<>'checked-in' then raise exception 'Laundry folio charges can only be posted to an in-house guest.';end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if nullif(trim(v_item->>'name'),'') is null or coalesce((v_item->>'qty')::numeric,0)<=0 or coalesce((v_item->>'unit_price')::numeric,-1)<0 then raise exception 'Laundry item name, quantity and unit price must be valid.';end if;
 end loop;
 select round(sum((x->>'qty')::numeric*(x->>'unit_price')::numeric),2) into v_total from jsonb_array_elements(p_items) x;
 if v_total is null or v_total<0 then raise exception 'Invalid laundry order total.';end if;
 insert into public.laundry_orders(property_id,reservation_id,room_id,guest_name,items,total,notes,created_by)
 values(p_property_id,v_res.id,v_res.room_id,v_res.guest_name,
  (select jsonb_agg(jsonb_build_object('name',x->>'name','qty',(x->>'qty')::numeric,'unit_price',(x->>'unit_price')::numeric,'line_total',round((x->>'qty')::numeric*(x->>'unit_price')::numeric,2))) from jsonb_array_elements(p_items) x),
  v_total,p_notes,auth.uid()) returning * into v_order;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount)
 values(p_property_id,v_res.id,'other','Laundry order · '||left(v_order.id::text,8),v_total);
 return jsonb_build_object('order_id',v_order.id,'reservation_id',v_res.id,'total',v_total,'status',v_order.status);
end;$$;
revoke execute on function public.fn_create_laundry_order_with_folio(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.fn_create_laundry_order_with_folio(uuid,uuid,jsonb,text) to authenticated;
