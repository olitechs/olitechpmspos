\set ON_ERROR_STOP on

-- Runtime regression test. Run ONLY against a local or already-authorized disposable
-- database with known fixtures. Never run this against production.
-- Supply IDs with psql -v:
-- test_user_a_id, test_property_a_id, test_property_b_id,
-- test_product_a_id, test_product_b_id,
-- test_default_location_id, test_nondefault_location_id.
-- test_user_a_id must be authorized to post adjustments in property A (owner/admin/inventory manager).
-- Product A and both location IDs must belong to property A; product B must belong to property B.
-- The transaction is rolled back at the end; if an assertion fails, psql stops and the
-- connection's open transaction is rolled back when the session closes.

\if :{?test_user_a_id}
\else
  \echo 'Missing required psql variable: test_user_a_id'
  \quit 2
\endif
\if :{?test_property_a_id}
\else
  \echo 'Missing required psql variable: test_property_a_id'
  \quit 2
\endif
\if :{?test_property_b_id}
\else
  \echo 'Missing required psql variable: test_property_b_id'
  \quit 2
\endif
\if :{?test_product_a_id}
\else
  \echo 'Missing required psql variable: test_product_a_id'
  \quit 2
\endif
\if :{?test_product_b_id}
\else
  \echo 'Missing required psql variable: test_product_b_id'
  \quit 2
\endif
\if :{?test_default_location_id}
\else
  \echo 'Missing required psql variable: test_default_location_id'
  \quit 2
\endif
\if :{?test_nondefault_location_id}
\else
  \echo 'Missing required psql variable: test_nondefault_location_id'
  \quit 2
\endif

begin;
select set_config('test.user_a_id', :'test_user_a_id', true);
select set_config('test.property_a_id', :'test_property_a_id', true);
select set_config('test.property_b_id', :'test_property_b_id', true);
select set_config('test.product_a_id', :'test_product_a_id', true);
select set_config('test.product_b_id', :'test_product_b_id', true);
select set_config('test.default_location_id', :'test_default_location_id', true);
select set_config('test.nondefault_location_id', :'test_nondefault_location_id', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('test.user_a_id'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $test$
declare
  property_a uuid := current_setting('test.property_a_id')::uuid;
  property_b uuid := current_setting('test.property_b_id')::uuid;
  product_a uuid := current_setting('test.product_a_id')::uuid;
  product_b uuid := current_setting('test.product_b_id')::uuid;
  default_location uuid := current_setting('test.default_location_id')::uuid;
  other_location uuid := current_setting('test.nondefault_location_id')::uuid;
  visible_other_products integer;
  before_global numeric;
  after_global numeric;
  before_default numeric;
  after_default numeric;
  before_other numeric;
  after_other numeric;
begin
  if not public.is_member_of_property(property_a) then
    raise exception 'FIXTURE-001: test_user_a_id must be a member of property A';
  end if;
  if public.is_member_of_property(property_b) then
    raise exception 'FIXTURE-002: test user must not be a member of property B';
  end if;

  if has_column_privilege('authenticated','public.products','cost_price','SELECT') then
    raise exception 'COST-RT-001: direct cost_price access is still granted to authenticated';
  end if;

  select count(*) into visible_other_products
  from public.products where property_id=property_b;
  if visible_other_products <> 0 then
    raise exception 'TENANT-RT-001: property A user can read % products from property B', visible_other_products;
  end if;

  if has_table_privilege('authenticated','public.product_stock_locations','INSERT')
     or has_table_privilege('authenticated','public.product_stock_locations','UPDATE')
     or has_table_privilege('authenticated','public.product_stock_locations','DELETE') then
    raise exception 'LEDGER-RT-001: authenticated clients can directly mutate location balances';
  end if;

  if not exists(select 1 from public.products where id=product_a and property_id=property_a) then
    raise exception 'FIXTURE-003: product A must belong to property A';
  end if;
  if not exists(select 1 from public.products where id=product_b and property_id=property_b) then
    raise exception 'FIXTURE-004: product B must belong to property B';
  end if;
  if not exists(select 1 from public.inventory_locations where id=default_location and property_id=property_a)
     or not exists(select 1 from public.inventory_locations where id=other_location and property_id=property_a)
     or default_location=other_location then
    raise exception 'FIXTURE-005: distinct default and non-default locations must belong to property A';
  end if;

  -- Cross-property product IDs must not be usable with property A's mutation context.
  begin
    perform public.fn_post_stock_adjustment(property_a,product_b,1,'phase2 tenant test',other_location);
    raise exception 'TENANT-RT-002: cross-property product mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm='TENANT-RT-002: cross-property product mutation unexpectedly succeeded' then
      raise;
    end if;
  end;

  select current_stock into before_global from public.products
  where id=product_a and property_id=property_a;
  select coalesce(qty,0) into before_default from public.product_stock_locations
  where product_id=product_a and location_id=default_location;
  before_default:=coalesce(before_default,0);
  select coalesce(qty,0) into before_other from public.product_stock_locations
  where product_id=product_a and location_id=other_location;
  before_other:=coalesce(before_other,0);

  -- Positive and negative adjustments must change the requested location and aggregate
  -- once, and must not mutate the other/default location through a trigger side effect.
  perform public.fn_post_stock_adjustment(property_a,product_a,1,'phase2 location positive test',other_location);
  select current_stock into after_global from public.products where id=product_a;
  select coalesce(qty,0) into after_other from public.product_stock_locations
  where product_id=product_a and location_id=other_location;
  if after_global <> before_global + 1 then
    raise exception 'BALANCE-RT-001: global balance changed by %, expected +1', after_global-before_global;
  end if;
  if after_other <> before_other + 1 then
    raise exception 'BALANCE-RT-002: non-default location changed by %, expected +1', after_other-before_other;
  end if;
  select coalesce(qty,0) into after_default from public.product_stock_locations
  where product_id=product_a and location_id=default_location;
  after_default:=coalesce(after_default,0);
  if after_default <> before_default then
    raise exception 'BALANCE-RT-003: default location changed during non-default adjustment';
  end if;

  perform public.fn_post_stock_adjustment(property_a,product_a,-1,'phase2 location negative test',other_location);
  select current_stock into after_global from public.products where id=product_a;
  select coalesce(qty,0) into after_other from public.product_stock_locations
  where product_id=product_a and location_id=other_location;
  select coalesce(qty,0) into after_default from public.product_stock_locations
  where product_id=product_a and location_id=default_location;
  if after_global <> before_global or after_other <> before_other or coalesce(after_default,0) <> before_default then
    raise exception 'BALANCE-RT-004: positive/negative adjustment round trip did not restore all balances';
  end if;
end
$test$;

rollback;
\echo 'Phase 2 inventory runtime regression checks passed; all fixture mutations were rolled back.'
