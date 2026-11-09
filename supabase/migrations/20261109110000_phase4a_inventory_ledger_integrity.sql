-- Phase 4A: protect the stock ledger and prevent location-specific movements
-- from being applied a second time to the default location.
-- Forward-only migration. Review and test against a disposable PostgreSQL database
-- before applying to production.

create or replace function public.fn_sync_product_default_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_location_id uuid;
  v_delta numeric;
begin
  -- Location-aware posting RPCs update their selected location explicitly.
  -- Do not mirror that same aggregate delta into the default location.
  if current_setting('app.inventory.skip_default_location_sync', true) = '1' then
    return new;
  end if;

  if new.current_stock is distinct from old.current_stock then
    v_delta := coalesce(new.current_stock, 0) - coalesce(old.current_stock, 0);

    insert into public.inventory_locations(property_id, name)
    values (
      new.property_id,
      coalesce(nullif(trim(new.location), ''), 'Main Store')
    )
    on conflict(property_id, name) do nothing;

    select id
      into v_location_id
      from public.inventory_locations
     where property_id = new.property_id
       and name = coalesce(nullif(trim(new.location), ''), 'Main Store')
     limit 1;

    insert into public.product_stock_locations(property_id, product_id, location_id, qty)
    values (new.property_id, new.id, v_location_id, greatest(0, coalesce(new.current_stock, 0)))
    on conflict(product_id, location_id)
    do update set qty = greatest(0, product_stock_locations.qty + v_delta);
  end if;

  return new;
end
$function$;

create or replace function public.fn_post_stock_adjustment(
  p_property_id uuid,
  p_product_id uuid,
  p_change numeric,
  p_reason text,
  p_location_id uuid default null
)
returns public.stock_adjustments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_adjustment public.stock_adjustments;
  v_product public.products;
  v_location_qty numeric;
begin
  if not (public.is_platform_owner() or public.can_store_write(p_property_id, null)) then
    raise exception 'Store adjustment permission is required';
  end if;

  if p_change is null or p_change = 0 or nullif(trim(p_reason), '') is null then
    raise exception 'Adjustment quantity and reason are required';
  end if;

  select * into v_product
    from public.products
   where id = p_product_id
     and property_id = p_property_id
   for update;

  if not found then
    raise exception 'Invalid product for this property';
  end if;

  if not (public.is_platform_owner() or public.can_store_write(p_property_id, v_product.category)) then
    raise exception 'You are not allowed to adjust this product category';
  end if;

  perform set_config('app.inventory.skip_default_location_sync', '0', true);

  if p_location_id is not null then
    if not exists (
      select 1 from public.inventory_locations
       where id = p_location_id and property_id = p_property_id
    ) then
      raise exception 'Inventory location does not belong to this property';
    end if;

    select coalesce(qty, 0)
      into v_location_qty
      from public.product_stock_locations
     where product_id = p_product_id
       and location_id = p_location_id
     for update;

    if p_change < 0 and coalesce(v_location_qty, 0) < abs(p_change) then
      raise exception 'Insufficient stock at selected location';
    end if;

    insert into public.product_stock_locations(property_id, product_id, location_id, qty)
    values (p_property_id, p_product_id, p_location_id, greatest(0, p_change))
    on conflict(product_id, location_id)
    do update set qty = greatest(0, product_stock_locations.qty + p_change);

    perform set_config('app.inventory.skip_default_location_sync', '1', true);
  end if;

  perform public.fn_apply_stock_movement(
    p_product_id, p_change, p_reason, 'adjustment', null
  );

  insert into public.stock_adjustments(
    property_id, product_id, location_id, change_qty, reason, created_by
  )
  values (
    p_property_id, p_product_id, p_location_id, p_change, trim(p_reason), auth.uid()
  )
  returning * into v_adjustment;

  return v_adjustment;
end
$function$;

create or replace function public.fn_approve_inventory_count(p_count_id uuid)
returns public.inventory_counts
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count public.inventory_counts;
  v_line record;
  v_diff numeric;
begin
  select * into v_count
    from public.inventory_counts
   where id = p_count_id
   for update;

  if not found then
    raise exception 'Count not found';
  end if;

  if not (
    public.is_platform_owner()
    or (
      public.fn_subscription_module_allowed(v_count.property_id, 'store')
      and public.fn_staff_module_access(v_count.property_id, 'store')
      and (
        public.current_staff_role(v_count.property_id) in ('hotel_admin', 'super_admin', 'store_manager')
        or (
          public.current_staff_role(v_count.property_id) is null
          and public.property_role(v_count.property_id) in ('owner', 'admin', 'manager')
        )
      )
    )
  ) then
    raise exception 'Store manager approval permission is required';
  end if;

  if v_count.status <> 'submitted' then
    raise exception 'Count is not awaiting approval';
  end if;

  if v_count.location_id is not null and not exists (
    select 1 from public.inventory_locations
     where id = v_count.location_id
       and property_id = v_count.property_id
  ) then
    raise exception 'Count location does not belong to this property';
  end if;

  perform set_config('app.inventory.skip_default_location_sync', '0', true);

  for v_line in
    select l.*, p.category
      from public.inventory_count_lines l
      join public.products p
        on p.id = l.product_id
       and p.property_id = v_count.property_id
     where l.count_id = v_count.id
     order by l.product_id
     for update of l, p
  loop
    if not (
      public.is_platform_owner()
      or public.can_store_write(v_count.property_id, v_line.category)
    ) then
      raise exception 'Count includes a category you are not allowed to approve';
    end if;

    v_diff := v_line.counted_qty - v_line.expected_qty;

    if v_count.location_id is not null then
      insert into public.product_stock_locations(property_id, product_id, location_id, qty)
      values (
        v_count.property_id,
        v_line.product_id,
        v_count.location_id,
        greatest(v_line.counted_qty, 0)
      )
      on conflict(product_id, location_id)
      do update set qty = excluded.qty;

      perform set_config('app.inventory.skip_default_location_sync', '1', true);
    end if;

    if v_diff <> 0 then
      perform public.fn_apply_stock_movement(
        v_line.product_id,
        v_diff,
        'Inventory count variance',
        'count',
        v_count.id
      );
    end if;
  end loop;

  update public.inventory_counts
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = v_count.id
  returning * into v_count;

  return v_count;
end
$function$;

create or replace function public.fn_post_wastage(
  p_property_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_location_id uuid default null,
  p_expiry_date date default null
)
returns public.inventory_wastage
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_wastage public.inventory_wastage;
  v_product public.products;
  v_location_qty numeric;
begin
  if p_quantity is null or p_quantity <= 0 or nullif(trim(p_reason), '') is null then
    raise exception 'Quantity and reason are required';
  end if;

  select * into v_product
    from public.products
   where id = p_product_id
     and property_id = p_property_id
   for update;

  if not found then
    raise exception 'Product does not belong to this property';
  end if;

  if not (
    public.is_platform_owner()
    or public.can_store_write(p_property_id, v_product.category)
  ) then
    raise exception 'Store wastage permission is required';
  end if;

  perform set_config('app.inventory.skip_default_location_sync', '0', true);

  if p_location_id is not null then
    if not exists (
      select 1 from public.inventory_locations
       where id = p_location_id and property_id = p_property_id
    ) then
      raise exception 'Inventory location does not belong to this property';
    end if;

    select coalesce(qty, 0)
      into v_location_qty
      from public.product_stock_locations
     where product_id = p_product_id
       and location_id = p_location_id
     for update;

    if coalesce(v_location_qty, 0) < p_quantity then
      raise exception 'Insufficient stock at selected location';
    end if;

    update public.product_stock_locations
       set qty = qty - p_quantity
     where product_id = p_product_id
       and location_id = p_location_id;

    perform set_config('app.inventory.skip_default_location_sync', '1', true);
  end if;

  perform public.fn_apply_stock_movement(
    p_product_id, -p_quantity, p_reason, 'wastage', null
  );

  insert into public.inventory_wastage(
    property_id, product_id, location_id, quantity, reason, expiry_date, created_by
  )
  values (
    p_property_id, p_product_id, p_location_id, p_quantity,
    trim(p_reason), p_expiry_date, auth.uid()
  )
  returning * into v_wastage;

  return v_wastage;
end
$function$;

-- The location table is a read model. All balance writes must pass through
-- the approved SECURITY DEFINER posting RPCs above.
revoke insert, update, delete, truncate, references, trigger
  on table public.product_stock_locations
  from public, anon, authenticated;
grant select on table public.product_stock_locations to authenticated;

-- Count, adjustment and wastage rows are created/approved only by their RPCs.
revoke insert, update, delete, truncate, references, trigger
  on table public.inventory_counts, public.inventory_count_lines, public.stock_adjustments
  from public, anon, authenticated;
grant select on table public.inventory_counts, public.inventory_count_lines, public.stock_adjustments
  to authenticated;

-- Remove stale membership-only write policies. RLS remains enabled and the
-- SELECT policies continue to scope reads to the user's property.
drop policy if exists product_stock_locations_write_delete on public.product_stock_locations;
drop policy if exists product_stock_locations_write_insert on public.product_stock_locations;
drop policy if exists product_stock_locations_write_update on public.product_stock_locations;
