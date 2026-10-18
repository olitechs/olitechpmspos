-- Phase 9 follow-up: enforce effective feature entitlements at the Postgres row boundary.
-- RESTRICTIVE policies compose with existing tenant RLS policies (AND), preserving
-- their property-isolation checks while preventing disabled features' rows from
-- being read or mutated through direct PostgREST table requests.
create or replace function public.fn_property_feature_enabled(p_property_id uuid, p_feature_key text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_package text;
  v_override boolean;
begin
  if p_property_id is null or p_feature_key is null then return false; end if;
  select package::text into v_package from public.properties where id = p_property_id;
  if v_package is null or not public.phase9_package_feature(v_package,p_feature_key) then return false; end if;
  select enabled into v_override from public.property_feature_entitlements
    where property_id = p_property_id and feature_key = p_feature_key;
  return coalesce(v_override,true);
end;
$$;
revoke all on function public.fn_property_feature_enabled(uuid,text) from public, anon;
grant execute on function public.fn_property_feature_enabled(uuid,text) to authenticated;

do $$
declare
  item record;
  policy_name text;
begin
  for item in
    select * from (values
      ('rooms','rooms_basic'),
      ('room_types','room_types_basic'),
      ('guests','guests'),
      ('reservations','reservations_basic'),
      ('folios','folio_basic'),
      ('guest_folios','folio_basic'),
      ('payments','payments_basic'),
      ('products','pos_products_basic'),
      ('categories','pos_categories'),
      ('pos_orders','pos_orders_basic'),
      ('pos_order_items','pos_orders_basic'),
      ('pos_payments','pos_payments_basic'),
      ('suppliers','inventory'),
      ('purchase_orders','inventory'),
      ('purchase_order_items','inventory'),
      ('inventory_locations','inventory'),
      ('stock_transfers','inventory'),
      ('stock_transfer_items','inventory'),
      ('recipes','inventory'),
      ('recipe_ingredients','inventory'),
      ('channel_connections','revenue_analytics'),
      ('laundry_orders','advanced_housekeeping'),
      ('pos_void_items','cashier_shifts')
    ) as feature_map(table_name,feature_key)
    join pg_class c on c.relname = feature_map.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'property_id'
      and a.attnum > 0 and not a.attisdropped
    where c.relkind = 'r' and c.relrowsecurity
  loop
    policy_name := 'phase9_feature_' || item.table_name;
    execute format('drop policy if exists %I on public.%I', policy_name, item.table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_platform_owner() or public.fn_property_feature_enabled(property_id, %L)) with check (public.is_platform_owner() or public.fn_property_feature_enabled(property_id, %L))',
      policy_name, item.table_name, item.feature_key, item.feature_key
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
