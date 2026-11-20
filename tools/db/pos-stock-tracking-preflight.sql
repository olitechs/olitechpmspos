-- POS stock tracking — pre-flight, read only.
-- Fails before anything is applied when the product catalogue is not the shape
-- this migration expects.
\set ON_ERROR_STOP on

do $$
declare
  v_missing text;
begin
  if to_regclass('public.products') is null then
    raise exception 'Missing prerequisite table: products';
  end if;

  select string_agg(required, ', ') into v_missing
    from (values ('products.property_id'), ('products.pos_enabled')) v(required)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = split_part(v.required, '.', 1)
        and c.column_name = split_part(v.required, '.', 2)
   );
  if v_missing is not null then
    raise exception 'Missing prerequisite columns: %', v_missing;
  end if;
end $$;

select 'PRE-FLIGHT: products table and POS columns present' as check;

select 'track_stock already present: ' || case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'products' and column_name = 'track_stock'
       ) then 'yes (migration is idempotent)' else 'no' end as before_state;

select 'existing menu function: ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as before_state
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'fn_list_pos_menu';

select 'POS products: ' || count(*) || ' enabled, '
    || count(*) filter (where coalesce(current_stock, 0) <= 0) || ' with zero stock, '
    || count(*) filter (where coalesce(selling_price, 0) = 0) || ' with no price' as before_state
  from public.products
 where pos_enabled is true and pos_active is true;

select 'zero-stock POS products that would show OUT OF STOCK today: ' as before_state;
select coalesce(pos_category, category) || ' | ' || name || ' | stock=' || coalesce(current_stock, 0) || ' | price=' || coalesce(selling_price, 0) as zero_stock_product
  from public.products
 where pos_enabled is true and pos_active is true and coalesce(current_stock, 0) <= 0
 order by 1
 limit 20;
