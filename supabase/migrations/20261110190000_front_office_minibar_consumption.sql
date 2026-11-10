-- Atomically deduct minibar stock and post the matching charge to the in-house guest folio.
create or replace function public.fn_post_minibar_consumption(
 p_property_id uuid,p_reservation_id uuid,p_product_id uuid,p_quantity numeric,p_notes text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_res public.reservations;v_product public.products;v_charge public.folio_charges;v_total numeric(12,2);v_description text;
begin
 if auth.uid() is null then raise exception 'Authentication required.';end if;
 if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'Access denied to this property.';end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'Quantity must be greater than zero.';end if;
 select * into v_res from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if v_res.id is null then raise exception 'Guest reservation not found for this property.';end if;
 if v_res.status not in ('checked-in') then raise exception 'Minibar charges can only be posted to an in-house guest.';end if;
 select * into v_product from public.products where id=p_product_id and property_id=p_property_id for update;
 if v_product.id is null then raise exception 'Minibar product not found for this property.';end if;
 if v_product.selling_price is null or v_product.selling_price<=0 then raise exception 'Set a valid selling price before posting consumption.';end if;
 if v_product.current_stock<p_quantity then raise exception 'Insufficient stock for %. Available: %, requested: %.',v_product.name,v_product.current_stock,p_quantity;end if;
 v_total:=round(v_product.selling_price*p_quantity,2);
 v_description:='Minibar · '||v_product.name||' × '||trim(to_char(p_quantity,'FM999999990.##'));
 if nullif(trim(p_notes),'') is not null then v_description:=v_description||' — '||left(trim(p_notes),240);end if;
 perform public.fn_apply_stock_movement(p_product_id,-p_quantity,'Minibar consumption · '||v_res.guest_name,'minibar_consumption',p_reservation_id);
 insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,p_reservation_id,'other',v_description,v_total) returning * into v_charge;
 return jsonb_build_object('charge_id',v_charge.id,'reservation_id',v_res.id,'product_id',v_product.id,'product_name',v_product.name,'quantity',p_quantity,'unit_price',v_product.selling_price,'amount',v_total,'created_at',v_charge.created_at);
end;$$;
revoke execute on function public.fn_post_minibar_consumption(uuid,uuid,uuid,numeric,text) from public,anon;
grant execute on function public.fn_post_minibar_consumption(uuid,uuid,uuid,numeric,text) to authenticated;
