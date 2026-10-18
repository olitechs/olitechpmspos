-- Phase 8: transaction-derived hotel management metrics.
create or replace function public.fn_daily_hotel_metrics(p_property_id uuid,p_business_date date default ((now() at time zone 'Africa/Nairobi')::date))
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_available integer:=0; v_occupied integer:=0; v_arrivals integer:=0; v_departures integer:=0; v_room_revenue numeric:=0; v_pos_revenue numeric:=0; v_pos_tax numeric:=0; v_discounts numeric:=0; v_refunds numeric:=0; v_purchases numeric:=0; v_consumption numeric:=0; v_wastage numeric:=0; v_inventory_value numeric:=0;
begin
if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
select count(*) into v_available from public.rooms where property_id=p_property_id and active=true and status not in ('maintenance','out_of_service','blocked');
select count(*) into v_occupied from public.reservations r where r.property_id=p_property_id and r.arrival<=p_business_date and r.departure>p_business_date and r.status<>'cancelled';
select count(*) into v_arrivals from public.reservations where property_id=p_property_id and arrival=p_business_date and status<>'cancelled';
select count(*) into v_departures from public.reservations where property_id=p_property_id and departure=p_business_date and status<>'cancelled';
select coalesce(sum(rate),0) into v_room_revenue from public.reservations where property_id=p_property_id and arrival<=p_business_date and departure>p_business_date and status<>'cancelled';
select coalesce(sum(total),0),coalesce(sum(vat),0),coalesce(sum(discount_amount),0) into v_pos_revenue,v_pos_tax,v_discounts from public.pos_receipts where property_id=p_property_id and ((created_at at time zone 'Africa/Nairobi')::date=p_business_date) and coalesce(status,'completed')<>'voided';
select coalesce(sum(amount),0) into v_refunds from public.cashier_refunds where property_id=p_property_id and ((created_at at time zone 'Africa/Nairobi')::date=p_business_date);
select coalesce(sum(total),0) into v_purchases from public.purchase_orders where property_id=p_property_id and purchase_date=p_business_date and status<>'cancelled';
select coalesce(sum(qty),0) into v_consumption from public.stock_usage where property_id=p_property_id and usage_date=p_business_date;
select coalesce(sum(quantity),0) into v_wastage from public.inventory_wastage where property_id=p_property_id and ((created_at at time zone 'Africa/Nairobi')::date=p_business_date);
select coalesce(sum(stock_value),0) into v_inventory_value from public.fn_inventory_valuation(p_property_id);
return jsonb_build_object('business_date',p_business_date,'available_rooms',v_available,'occupied_rooms',v_occupied,'occupancy_percent',case when v_available=0 then 0 else round(v_occupied::numeric/v_available*100,2) end,'room_revenue',round(v_room_revenue,2),'adr',case when v_occupied=0 then 0 else round(v_room_revenue/v_occupied,2) end,'revpar',case when v_available=0 then 0 else round(v_room_revenue/v_available,2) end,'arrivals',v_arrivals,'departures',v_departures,'pos_revenue',round(v_pos_revenue,2),'pos_tax',round(v_pos_tax,2),'discounts',round(v_discounts,2),'refunds',round(v_refunds,2),'purchases',round(v_purchases,2),'consumption',round(v_consumption,2),'wastage',round(v_wastage,2),'inventory_value',round(v_inventory_value,2));
end $$;
revoke all on function public.fn_daily_hotel_metrics(uuid,date) from public,anon;
grant execute on function public.fn_daily_hotel_metrics(uuid,date) to authenticated;
