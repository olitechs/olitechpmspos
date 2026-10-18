create or replace function public.fn_management_report(
  p_property_id uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_days integer;
  v_sellable_rooms integer := 0;
  v_available_room_nights numeric := 0;
  v_occupied_room_nights numeric := 0;
  v_room_revenue numeric := 0;
  v_pos_gross numeric := 0;
  v_pos_tax numeric := 0;
  v_discounts numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_inventory_value numeric := 0;
  v_purchases numeric := 0;
  v_consumption numeric := 0;
  v_wastage numeric := 0;
  v_arrivals integer := 0;
  v_departures integer := 0;
  v_reservations integer := 0;
  v_cash_variance numeric := 0;
  v_open_shifts integer := 0;
  v_closed_shifts integer := 0;
  v_total_stock_movements integer := 0;
  v_transfer_orders integer := 0;
begin
  if p_property_id is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid reporting period';
  end if;
  if not public.is_platform_owner() and not public.is_member_of_property(p_property_id) then
    raise exception 'Not authorized';
  end if;
  v_days := (p_to - p_from) + 1;
  select count(*) into v_sellable_rooms from public.rooms where property_id=p_property_id and active=true and status not in ('maintenance','out_of_service','blocked');
  v_available_room_nights := v_sellable_rooms * v_days;
  with stay_days as (
    select distinct r.id,r.room_id,d::date as stay_date
    from public.reservations r
    cross join lateral generate_series(greatest(r.arrival,p_from)::timestamp,least(r.departure-1,p_to)::timestamp,interval '1 day') d
    where r.property_id=p_property_id and r.status<>'cancelled' and r.room_id is not null and r.arrival<=p_to and r.departure>p_from
  ) select count(*) into v_occupied_room_nights from stay_days;
  select coalesce(sum(greatest(0,(least(r.departure,p_to+1)-greatest(r.arrival,p_from)))*coalesce(r.rate,0)),0)
    into v_room_revenue
    from public.reservations r
    where r.property_id=p_property_id and r.status<>'cancelled' and r.arrival<p_to+1 and r.departure>p_from;
  select count(*) into v_reservations from public.reservations where property_id=p_property_id and status<>'cancelled' and arrival<=p_to and departure>p_from;
  select count(*) into v_arrivals from public.reservations where property_id=p_property_id and status<>'cancelled' and arrival between p_from and p_to;
  select count(*) into v_departures from public.reservations where property_id=p_property_id and status<>'cancelled' and departure between p_from and p_to;
  select coalesce(sum(total),0),coalesce(sum(vat),0),coalesce(sum(discount_amount),0) into v_pos_gross,v_pos_tax,v_discounts
    from public.pos_receipts where property_id=p_property_id and status='posted' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select coalesce(sum(amount),0) into v_refunds from public.cashier_refunds where property_id=p_property_id and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select coalesce(sum(total),0) into v_voids from public.pos_receipts where property_id=p_property_id and status='voided' and (voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select coalesce(sum(total),0) into v_purchases from public.purchase_orders where property_id=p_property_id and status<>'cancelled' and purchase_date between p_from and p_to;
  select coalesce(sum(qty),0) into v_consumption from public.stock_usage where property_id=p_property_id and usage_date between p_from and p_to;
  select coalesce(sum(quantity),0) into v_wastage from public.inventory_wastage where property_id=p_property_id and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select coalesce(sum(current_stock*cost_price),0) into v_inventory_value from public.products where property_id=p_property_id;
  select count(*) filter (where status='open'),count(*) filter (where status='closed'),coalesce(sum(variance) filter (where status='closed'),0)
    into v_open_shifts,v_closed_shifts,v_cash_variance
    from public.cashier_shifts where property_id=p_property_id and (opened_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select count(*) into v_total_stock_movements from public.stock_movements where property_id=p_property_id and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  select count(*) into v_transfer_orders from public.stock_transfers where property_id=p_property_id and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to;
  return jsonb_build_object(
    'from',p_from,'to',p_to,'days',v_days,
    'hotel',jsonb_build_object('sellable_rooms',v_sellable_rooms,'available_room_nights',v_available_room_nights,'occupied_room_nights',v_occupied_room_nights,'occupancy_percent',case when v_available_room_nights=0 then 0 else round(v_occupied_room_nights/v_available_room_nights*100,2) end,'room_revenue',round(v_room_revenue,2),'adr',case when v_occupied_room_nights=0 then 0 else round(v_room_revenue/v_occupied_room_nights,2) end,'revpar',case when v_available_room_nights=0 then 0 else round(v_room_revenue/v_available_room_nights,2) end,'reservations',v_reservations,'arrivals',v_arrivals,'departures',v_departures),
    'sales',jsonb_build_object('pos_gross',round(v_pos_gross,2),'pos_tax',round(v_pos_tax,2),'discounts',round(v_discounts,2),'refunds',round(v_refunds,2),'voids',round(v_voids,2),'pos_net',round(v_pos_gross-v_refunds,2)),
    'inventory',jsonb_build_object('valuation',round(v_inventory_value,2),'purchases',round(v_purchases,2),'consumption_qty',round(v_consumption,2),'wastage_qty',round(v_wastage,2),'stock_movements',v_total_stock_movements,'transfer_orders',v_transfer_orders),
    'cashier',jsonb_build_object('open_shifts',v_open_shifts,'closed_shifts',v_closed_shifts,'cash_variance',round(v_cash_variance,2))
  );
end;
$$;

create or replace function public.fn_management_sales_detail(p_property_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_departments jsonb:='[]'::jsonb;v_payments jsonb:='[]'::jsonb;v_daily jsonb:='[]'::jsonb;v_discounts jsonb:='[]'::jsonb;v_voids jsonb:='[]'::jsonb;v_refunds jsonb:='[]'::jsonb;
begin
  if p_property_id is null or p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting period'; end if;
  if not public.is_platform_owner() and not public.is_member_of_property(p_property_id) then raise exception 'Not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.revenue desc),'[]'::jsonb) into v_departments from (
    with expanded as (
      select coalesce(nullif(item->>'department',''),nullif(item->>'production_center',''),nullif(item->>'category',''),'Unassigned') department,
      coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,1) qty,
      coalesce((item->>'total')::numeric,(item->>'price')::numeric*coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,1),0) revenue
      from public.pos_receipts r cross join lateral jsonb_array_elements(coalesce(r.items,'[]'::jsonb)) item
      where r.property_id=p_property_id and r.status='posted' and (r.created_at at time zone 'Africa/Nairobi')::date between p_from and p_to)
    select department,round(sum(qty),2) qty,round(sum(revenue),2) revenue from expanded group by department) x;
  select coalesce(jsonb_agg(row_to_json(x) order by x.amount desc),'[]'::jsonb) into v_payments from (
    select coalesce(payment_method,'Unspecified') method,count(*)::integer transactions,round(sum(total),2) amount from public.pos_receipts
    where property_id=p_property_id and status='posted' and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to group by payment_method) x;
  select coalesce(jsonb_agg(row_to_json(x) order by x.business_date),'[]'::jsonb) into v_daily from (
    select d.business_date,round(coalesce(sum(r.total) filter(where r.status='posted'),0),2) revenue,count(r.id) filter(where r.status='posted')::integer transactions
    from generate_series(p_from,p_to,interval '1 day') d(business_date) left join public.pos_receipts r on r.property_id=p_property_id and (r.created_at at time zone 'Africa/Nairobi')::date=d.business_date group by d.business_date) x;
  select coalesce(jsonb_agg(row_to_json(x) order by x.amount desc),'[]'::jsonb) into v_discounts from (
    select coalesce(discount_name,'Unnamed discount') discount,count(*)::integer transactions,round(sum(discount_amount),2) amount from public.pos_receipts
    where property_id=p_property_id and status='posted' and discount_amount>0 and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to group by discount_name) x;
  select coalesce(jsonb_agg(row_to_json(x) order by x.amount desc),'[]'::jsonb) into v_voids from (
    select coalesce(void_reason,'No reason recorded') reason,count(*)::integer transactions,round(sum(total),2) amount from public.pos_receipts
    where property_id=p_property_id and status='voided' and (voided_at at time zone 'Africa/Nairobi')::date between p_from and p_to group by void_reason) x;
  select coalesce(jsonb_agg(row_to_json(x) order by x.amount desc),'[]'::jsonb) into v_refunds from (
    select coalesce(method,'Unspecified') method,count(*)::integer transactions,round(sum(amount),2) amount from public.cashier_refunds
    where property_id=p_property_id and (created_at at time zone 'Africa/Nairobi')::date between p_from and p_to group by method) x;
  return jsonb_build_object('departments',v_departments,'payments',v_payments,'daily',v_daily,'discounts',v_discounts,'voids',v_voids,'refunds',v_refunds);
end;
$$;

grant execute on function public.fn_management_report(uuid,date,date) to authenticated;
grant execute on function public.fn_management_sales_detail(uuid,date,date) to authenticated;
revoke execute on function public.fn_management_report(uuid,date,date) from anon;
revoke execute on function public.fn_management_sales_detail(uuid,date,date) from anon;
