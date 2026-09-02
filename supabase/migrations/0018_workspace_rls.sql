-- Workspace isolation helpers. These policies complement frontend route guards.

create or replace function public.current_staff_role(p_property_id uuid)
returns text
language sql security definer stable set search_path = public
as $$
  select role from public.staff
  where property_id = p_property_id and user_id = auth.uid() and is_active = true
  order by updated_at desc limit 1;
$$;

create or replace function public.can_store_read(p_property_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','storekeeper')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','front_office_manager','store_manager','fb_manager','housekeeping_supervisor');
$$;

create or replace function public.can_store_write(p_property_id uuid, p_category text default null)
returns boolean
language sql security definer stable set search_path = public
as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','storekeeper')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','store_manager','housekeeping_supervisor')
    or (public.current_staff_role(p_property_id) = 'fb_manager' and coalesce(p_category,'F&B') = 'F&B');
$$;

-- Replace broad Store policies with role-aware policies.
do $$
declare t text;
begin
  foreach t in array array['suppliers','products','stock_movements','purchase_orders','stock_usage','low_stock_alerts'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s', t);
  end loop;
end $$;

create policy suppliers_select on public.suppliers for select using (public.can_store_read(property_id));
create policy suppliers_insert on public.suppliers for insert with check (public.can_store_write(property_id));
create policy suppliers_update on public.suppliers for update using (public.can_store_write(property_id)) with check (public.can_store_write(property_id));
create policy suppliers_delete on public.suppliers for delete using (public.can_store_write(property_id));

create policy products_select on public.products for select using (public.can_store_read(property_id));
create policy products_insert on public.products for insert with check (public.can_store_write(property_id, category));
create policy products_update on public.products for update using (public.can_store_write(property_id, category)) with check (public.can_store_write(property_id, category));
create policy products_delete on public.products for delete using (public.can_store_write(property_id, category));

create policy stock_movements_select on public.stock_movements for select using (public.can_store_read(property_id));
create policy stock_movements_insert on public.stock_movements for insert with check (public.can_store_write(property_id));

create policy purchase_orders_select on public.purchase_orders for select using (public.can_store_read(property_id));
create policy purchase_orders_insert on public.purchase_orders for insert with check (public.can_store_write(property_id));
create policy purchase_orders_update on public.purchase_orders for update using (public.can_store_write(property_id)) with check (public.can_store_write(property_id));
create policy purchase_orders_delete on public.purchase_orders for delete using (public.can_store_write(property_id));

create policy stock_usage_select on public.stock_usage for select using (public.can_store_read(property_id));
create policy stock_usage_insert on public.stock_usage for insert with check (public.can_store_write(property_id));
create policy stock_usage_update on public.stock_usage for update using (public.can_store_write(property_id)) with check (public.can_store_write(property_id));
create policy stock_usage_delete on public.stock_usage for delete using (public.can_store_write(property_id));

create policy low_stock_alerts_select on public.low_stock_alerts for select using (public.can_store_read(property_id));
create policy low_stock_alerts_insert on public.low_stock_alerts for insert with check (public.can_store_write(property_id));
create policy low_stock_alerts_update on public.low_stock_alerts for update using (public.can_store_write(property_id)) with check (public.can_store_write(property_id));

-- Stock adjustment is server-side and role-checked. POS deduction is allowed
-- for an authenticated property member, while direct manual adjustments use
-- Store/GM roles.
create or replace function public.fn_adjust_product_stock(p_product_id uuid, p_change numeric, p_reason text)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare v_product public.products;
        v_type text;
        v_qty numeric;
        v_role text;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null then raise exception 'Product not found.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(v_product.property_id)) then raise exception 'Not allowed.'; end if;
  v_role := public.current_staff_role(v_product.property_id);
  if p_reason ilike 'POS Sale%' then
    if not (public.is_platform_owner() or public.property_role(v_product.property_id) in ('owner','admin','manager','cashier') or v_role in ('hotel_admin','super_admin','pos_staff','waiter','cashier','fb_manager')) then
      raise exception 'Only authorised POS staff can post POS stock deductions.';
    end if;
  elsif not public.can_store_write(v_product.property_id, v_product.category) then
    raise exception 'Only Store/Manager staff can make manual stock adjustments.';
  end if;
  if p_change = 0 then return v_product; end if;
  update public.products set current_stock = greatest(0, current_stock + p_change), updated_at = now() where id = p_product_id returning * into v_product;
  v_type := case when p_change > 0 then 'in' else 'out' end;
  v_qty := abs(p_change);
  insert into public.stock_movements(property_id, product_id, type, qty, reason, user_id)
    values(v_product.property_id, p_product_id, v_type, v_qty, p_reason, auth.uid());
  if v_product.current_stock <= 0 then
    insert into public.low_stock_alerts(property_id, product_id, alert_type) values(v_product.property_id, p_product_id, 'out_of_stock');
  elsif v_product.current_stock <= v_product.min_stock then
    insert into public.low_stock_alerts(property_id, product_id, alert_type) values(v_product.property_id, p_product_id, 'low_stock');
  end if;
  return v_product;
end;
$$;
grant execute on function public.fn_adjust_product_stock(uuid,numeric,text) to authenticated;
