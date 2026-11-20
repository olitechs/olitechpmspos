-- Stop the zero-stock dry-goods item from showing OUT OF STOCK on the POS.
-- Changes exactly one row: track_stock = false for 0KONOMI SAUCE.
-- Guarded: fails without touching anything unless exactly one such product
-- exists, and the update itself must affect exactly one row.
\set ON_ERROR_STOP on

do $$
declare
  v_matches integer;
  v_updated integer;
  v_target  uuid;
begin
  select count(*) into v_matches
    from public.products
   where upper(btrim(name)) = '0KONOMI SAUCE';
  if v_matches <> 1 then
    raise exception 'Expected exactly one product named 0KONOMI SAUCE, found %', v_matches;
  end if;

  select id into v_target
    from public.products
   where upper(btrim(name)) = '0KONOMI SAUCE';

  update public.products
     set track_stock = false
   where id = v_target;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to update exactly one product, updated %', v_updated;
  end if;
end $$;

do $$
declare
  v_tracked   integer;
  v_zero_still integer;
begin
  if not exists (
    select 1 from public.products
     where upper(btrim(name)) = '0KONOMI SAUCE' and track_stock is false
  ) then
    raise exception '0KONOMI SAUCE is still tracked';
  end if;

  select count(*) into v_zero_still
    from public.products
   where pos_enabled is true and pos_active is true
     and track_stock is true and coalesce(current_stock, 0) <= 0;

  select count(*) into v_tracked from public.products where track_stock;
  raise notice 'PASS: 0KONOMI SAUCE untracked; % tracked products remain, % enabled POS item(s) still zero-stock and tracked',
    v_tracked, v_zero_still;
end $$;

select name, coalesce(pos_category, category) as category, track_stock, current_stock, selling_price,
       pos_enabled, pos_active
  from public.products
 where upper(btrim(name)) = '0KONOMI SAUCE';

select 'rows: ' || count(*) || ' products, ' || count(*) filter (where track_stock) || ' tracked, '
    || count(*) filter (where not track_stock) || ' not tracked' as verification
  from public.products;

select 'enabled POS items showing OUT OF STOCK: ' || count(*) as verification
  from public.products
 where pos_enabled is true and pos_active is true and track_stock is true and coalesce(current_stock, 0) <= 0;
