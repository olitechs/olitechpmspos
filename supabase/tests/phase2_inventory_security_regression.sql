-- Phase 2 inventory security regression gate.
-- Run ONLY against a local or already-authorized disposable database after loading
-- the schema under test. This file is read-only: it performs catalog assertions only.
-- Some assertions intentionally fail against the pre-fix schema to prevent a false green.
-- Do not run as a production migration and do not use this as a substitute for two-user
-- runtime tests with request.jwt.claims and real product/location fixtures.

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_inventory_valuation(uuid)'::regprocedure) into def;
  if position('cost_price' in def)=0 or
     not (position('can_view_inventory_cost' in def)>0
          or position('fn_staff_module_access' in def)>0
          or position('is_hotel_admin' in def)>0) then
    raise exception 'COST-001: inventory valuation must enforce cost authorization in the database';
  end if;
end
$test$;

do $test$
begin
  if has_column_privilege('authenticated','public.products','cost_price','SELECT') then
    raise exception 'COST-002: authenticated users must not receive unrestricted direct cost_price column access';
  end if;
end
$test$;

do $test$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='products' and cmd='SELECT'
      and coalesce(qual,'') like '%is_member_of_property%'
  ) then
    raise exception 'TENANT-001: products SELECT must remain property-scoped';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='is_member_of_property'
  ) then
    raise exception 'TENANT-002: property membership guard is missing';
  end if;
end
$test$;

do $test$
begin
  if has_table_privilege('authenticated','public.product_stock_locations','INSERT')
     or has_table_privilege('authenticated','public.product_stock_locations','UPDATE')
     or has_table_privilege('authenticated','public.product_stock_locations','DELETE') then
    raise exception 'LEDGER-001: location balances must not be directly mutable by authenticated clients; use the authorized posting RPC';
  end if;
end
$test$;

do $test$
begin
  if has_table_privilege('authenticated','public.stock_movements','INSERT')
     or has_table_privilege('authenticated','public.stock_movements','UPDATE')
     or has_table_privilege('authenticated','public.stock_movements','DELETE') then
    raise exception 'LEDGER-002: posted stock movements must be immutable to authenticated clients';
  end if;
  if has_table_privilege('authenticated','public.stock_usage','INSERT')
     or has_table_privilege('authenticated','public.stock_usage','UPDATE')
     or has_table_privilege('authenticated','public.stock_usage','DELETE') then
    raise exception 'LEDGER-003: stock_usage is an audit/source record and must be written only through authorized RPCs';
  end if;
end
$test$;

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_post_stock_adjustment(uuid,uuid,numeric,text,uuid)'::regprocedure) into def;
  if position('product_stock_locations' in def)>0 then
    raise exception 'BALANCE-001: adjustment RPC must not mutate a location row separately from the shared posting owner';
  end if;
  if position('fn_apply_stock_movement' in def)=0 then
    raise exception 'BALANCE-002: adjustment must post through the authoritative ledger writer';
  end if;
end
$test$;

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_approve_inventory_count(uuid)'::regprocedure) into def;
  if position('product_stock_locations' in def)>0 then
    raise exception 'BALANCE-003: count approval must not update location balance separately from the shared posting owner';
  end if;
  if position('fn_apply_stock_movement' in def)=0 then
    raise exception 'BALANCE-004: count variance must post through the authoritative ledger writer';
  end if;
end
$test$;

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_complete_stock_transfer(uuid)'::regprocedure) into def;
  if position('source_type' in def)=0 or position('source_id' in def)=0 then
    raise exception 'TRANSFER-001: transfer movements must link to the source transfer/line for audit and retry protection';
  end if;
  if position('status<>''pending''' in def)=0 and position('status <> ''pending''' in def)=0 then
    raise exception 'TRANSFER-002: transfer completion must lock and enforce a one-way pending-to-completed transition';
  end if;
end
$test$;

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_receive_purchase_order(uuid,jsonb)'::regprocedure) into def;
  if position('fn_apply_stock_movement' in def)=0 then
    raise exception 'GRN-001: receipt must use the authoritative ledger writer';
  end if;
  if position('goods_receipt_lines' in def)=0 then
    raise exception 'GRN-002: every received line must be persisted as a GRN audit record';
  end if;
end
$test$;

do $test$
declare
  def text;
begin
  select pg_get_functiondef('public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb)'::regprocedure) into def;
  if position('fn_apply_stock_movement' in def)=0 then
    raise exception 'POS-001: POS product stock must use the authoritative ledger writer';
  end if;
  if position('idempotency_key' in def)=0 or position('v_key' in def)=0 then
    raise exception 'POS-002: POS sale must retain receipt-level idempotency';
  end if;
end
$test$;

-- Runtime suite still required after the catalog gate:
-- 1. As a property-A department staff identity, assert cost_price is denied by both
--    direct products SELECT and the valuation endpoint, while the authorized cost role
--    can read the permitted valuation fields.
-- 2. As property-A user, query and mutate property-B product/location/source IDs and
--    assert zero rows / authorization errors; repeat for each write RPC.
-- 3. In a rollback-only transaction, record before/after products.current_stock,
--    stock_movements and product_stock_locations; test positive/negative adjustments
--    at default and non-default locations and count variance, asserting exactly one
--    quantity delta and no cross-property location linkage.
-- 4. Repeat the same POS idempotency key, GRN receive, transfer completion, count approval,
--    void, refund and recipe-consumption request; assert no second posting.
-- 5. Assert every failed multi-line event leaves source status, ledger and balances unchanged.
