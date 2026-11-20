-- POS stock tracking — post-apply verification, read only.
\set ON_ERROR_STOP on

do $$
declare
  v_count integer;
  v_oid oid;
  v_result text;
  v_default text;
  v_nullable text;
  v_type text;
begin
  select data_type, is_nullable, column_default
    into v_type, v_nullable, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name = 'track_stock';

  if v_type is null then
    raise exception 'products.track_stock was not created';
  end if;
  if v_type <> 'boolean' then
    raise exception 'products.track_stock must be boolean, found %', v_type;
  end if;
  if v_nullable <> 'NO' then
    raise exception 'products.track_stock must be not null, found nullable=%', v_nullable;
  end if;
  if coalesce(v_default, '') not like '%true%' then
    raise exception 'products.track_stock must default to true, found %', coalesce(v_default, '(none)');
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_list_pos_menu';
  if v_count <> 1 then
    raise exception 'Expected exactly one fn_list_pos_menu overload, found %', v_count;
  end if;

  v_oid := to_regprocedure('public.fn_list_pos_menu(uuid)');
  if v_oid is null then
    raise exception 'fn_list_pos_menu(uuid) is missing';
  end if;

  v_result := pg_get_function_result(v_oid);
  if position('track_stock' in v_result) = 0 then
    raise exception 'fn_list_pos_menu does not return track_stock (%)', v_result;
  end if;
  if position('p.track_stock' in pg_get_functiondef(v_oid)) = 0 then
    raise exception 'fn_list_pos_menu does not select p.track_stock';
  end if;

  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'authenticated cannot execute fn_list_pos_menu';
  end if;
end $$;

select 'PASS: track_stock column, single menu function overload, return type and grants verified' as check;

select 'column: ' || column_name || ' ' || data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '(none)') as verification
  from information_schema.columns
 where table_schema = 'public' and table_name = 'products' and column_name = 'track_stock';

select 'function: ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') returns track_stock=' ||
       (position('track_stock' in pg_get_function_result(p.oid)) > 0) as verification
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'fn_list_pos_menu';

select 'rows: ' || count(*) || ' products, ' || count(*) filter (where track_stock) || ' tracked, ' || count(*) filter (where not track_stock) || ' not tracked' as verification
  from public.products;

select 'POS products: ' || count(*) || ' enabled, ' || count(*) filter (where track_stock) || ' tracked' as verification
  from public.products
 where pos_enabled is true and pos_active is true;

select 'zero-stock POS items still showing OUT OF STOCK (mark track_stock=false to hide): ' || count(*) as verification
  from public.products
 where pos_enabled is true and pos_active is true and track_stock is true and coalesce(current_stock, 0) <= 0;
