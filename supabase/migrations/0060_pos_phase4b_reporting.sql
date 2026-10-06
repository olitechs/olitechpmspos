-- Phase 4B: expose discount and modifier totals in live POS reporting without
-- changing the existing report contract used by the dashboard.
create or replace function public.fn_daily_pos_summary(
  p_property_id uuid,
  p_business_date date default (now() at time zone 'Africa/Nairobi')::date
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_total numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_modifier numeric(12,2) := 0;
  v_transactions integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_modifiers jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_hourly jsonb := '[]'::jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  select coalesce(sum(total), 0), coalesce(sum(discount_amount), 0), count(*)::integer
  into v_total, v_discount, v_transactions
  from public.pos_receipts
  where property_id = p_property_id
    and status = 'posted'
    and (created_at at time zone 'Africa/Nairobi')::date = p_business_date;

  with receipt_items as (
    select r.items
    from public.pos_receipts r
    where r.property_id = p_property_id
      and r.status = 'posted'
      and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date
  ),
  modifier_rows as (
    select
      coalesce(nullif(m->>'name',''), 'Unnamed modifier') as name,
      coalesce((m->>'price_delta_minor')::numeric, 0) / 100 as delta,
      coalesce((item->>'qty')::numeric, (item->>'quantity')::numeric, 1) as qty
    from receipt_items r
    cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) item
    cross join lateral jsonb_array_elements(coalesce(item->'modifiers', '[]'::jsonb)) m
  )
  select coalesce(sum(delta * qty), 0)
  into v_modifier
  from modifier_rows;

  select coalesce(jsonb_agg(row_to_json(x) order by x.revenue desc), '[]'::jsonb)
  into v_payments
  from (
    select payment_method as method, count(*)::integer as transactions, round(sum(total), 2) as amount
    from public.pos_receipts
    where property_id = p_property_id
      and status = 'posted'
      and (created_at at time zone 'Africa/Nairobi')::date = p_business_date
    group by payment_method
  ) x;

  with expanded as (
    select
      coalesce(nullif(item->>'name', ''), 'Unnamed item') as name,
      coalesce((item->>'qty')::numeric, 0) as qty,
      coalesce((item->>'quantity')::numeric, 0) as quantity,
      coalesce((item->>'price')::numeric, 0) as price,
      coalesce((item->>'total')::numeric, 0) as item_total
    from public.pos_receipts r
    cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) item
    where r.property_id = p_property_id
      and r.status = 'posted'
      and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date
  ),
  normalized as (
    select
      name,
      sum(case when qty > 0 then qty when quantity > 0 then quantity else 1 end) as qty,
      sum(case
        when item_total > 0 then item_total
        when price > 0 then price * case when qty > 0 then qty when quantity > 0 then quantity else 1 end
        else 0
      end) as revenue
    from expanded
    group by name
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.revenue desc), '[]'::jsonb)
  into v_items
  from (
    select name, round(qty, 2) as qty, round(revenue, 2) as revenue
    from normalized
    order by revenue desc
    limit 10
  ) x;

  with modifier_rows as (
    select
      coalesce(nullif(m->>'name',''), 'Unnamed modifier') as name,
      coalesce((m->>'price_delta_minor')::numeric, 0) / 100 as delta,
      coalesce((item->>'qty')::numeric, (item->>'quantity')::numeric, 1) as qty
    from public.pos_receipts r
    cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) item
    cross join lateral jsonb_array_elements(coalesce(item->'modifiers', '[]'::jsonb)) m
    where r.property_id = p_property_id
      and r.status = 'posted'
      and (r.created_at at time zone 'Africa/Nairobi')::date = p_business_date
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.revenue desc), '[]'::jsonb)
  into v_modifiers
  from (
    select name, round(sum(qty), 2) as qty, round(sum(delta * qty), 2) as revenue
    from modifier_rows
    group by name
    order by revenue desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(row_to_json(x) order by x.hour), '[]'::jsonb)
  into v_hourly
  from (
    select
      extract(hour from (created_at at time zone 'Africa/Nairobi'))::integer as hour,
      round(sum(total), 2) as revenue,
      count(*)::integer as transactions
    from public.pos_receipts
    where property_id = p_property_id
      and status = 'posted'
      and (created_at at time zone 'Africa/Nairobi')::date = p_business_date
    group by extract(hour from (created_at at time zone 'Africa/Nairobi'))
    order by hour
  ) x;

  return jsonb_build_object(
    'business_date', p_business_date,
    'total_revenue', v_total,
    'discount_total', v_discount,
    'discounted_subtotal', greatest(v_total - v_discount, 0),
    'modifier_revenue', v_modifier,
    'transactions', v_transactions,
    'average_check', case when v_transactions > 0 then round(v_total / v_transactions, 2) else 0 end,
    'payment_breakdown', v_payments,
    'top_items', v_items,
    'top_modifiers', v_modifiers,
    'hourly_revenue', v_hourly
  );
end;
$$;

grant execute on function public.fn_daily_pos_summary(uuid, date) to authenticated;
notify pgrst, 'reload schema';
