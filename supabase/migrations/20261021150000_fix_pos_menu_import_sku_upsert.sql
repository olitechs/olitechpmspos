-- Fix POS menu imports that collide with products_property_id_sku_key.
-- Existing menu rows are updated by property + SKU when the import has no id.
-- Existing stock balances remain ledger-owned and are not overwritten by a menu import.
-- Serialize menu mutations per property so concurrent imports cannot race the
-- lookup/insert path. This migration is forward-only; do not apply to production
-- until tested against a schema-equivalent isolated database.

create or replace function public.fn_upsert_pos_menu_item(
  p_property_id uuid,
  p_id uuid default null,
  p_sku text default null,
  p_name text default null,
  p_category text default 'General',
  p_unit text default 'pcs',
  p_selling_price numeric default 0,
  p_current_stock numeric default 0,
  p_min_stock numeric default 0,
  p_max_stock numeric default 0,
  p_production_center text default 'Kitchen',
  p_sort integer default 0,
  p_active boolean default true
) returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.products;
  v_sku text := nullif(trim(p_sku), '');
  v_name text := nullif(trim(p_name), '');
  v_category text := coalesce(nullif(trim(p_category), ''), 'General');
  v_unit text := coalesce(nullif(trim(p_unit), ''), 'pcs');
  v_center text := coalesce(nullif(trim(p_production_center), ''), 'Kitchen');
  v_existing_id uuid;
begin
  if not public.can_manage_pos_menu(p_property_id) then
    raise exception 'Only an authorised manager or cashier can manage the POS menu.';
  end if;
  if v_name is null then raise exception 'Product name is required.'; end if;
  if coalesce(p_selling_price, 0) < 0 or coalesce(p_current_stock, 0) < 0 then
    raise exception 'Price and stock cannot be negative.';
  end if;

  -- Serializes SKU lookup + insert/update for this property, including imports.
  -- Hash collisions only serialize unrelated properties; they do not weaken access.
  perform pg_advisory_xact_lock(hashtext(p_property_id::text));

  if p_id is not null then
    select id into v_existing_id
    from public.products
    where id = p_id and property_id = p_property_id
    for update;
    if v_existing_id is null then raise exception 'POS product not found.'; end if;
  elsif v_sku is not null then
    select id into v_existing_id
    from public.products
    where property_id = p_property_id and sku = v_sku
    order by created_at nulls last, id
    limit 1
    for update;
  else
    select id into v_existing_id
    from public.products
    where property_id = p_property_id and lower(trim(name)) = lower(v_name)
    order by created_at nulls last, id
    limit 1
    for update;
  end if;

  -- Editing a known row must never silently overwrite a different product
  -- that already owns the requested SKU.
  if v_sku is not null and exists (
    select 1 from public.products p
    where p.property_id = p_property_id
      and p.sku = v_sku
      and p.id is distinct from v_existing_id
  ) then
    raise exception 'SKU "%" is already assigned to another product in this property. Import by SKU to update that product, or choose a unique SKU.', v_sku
      using errcode = '23505', constraint = 'products_property_id_sku_key';
  end if;

  if v_existing_id is null then
    insert into public.products(
      property_id, sku, name, category, unit, current_stock, min_stock, max_stock,
      selling_price, pos_enabled, pos_category, production_center, pos_sort, pos_active
    ) values (
      p_property_id, v_sku, v_name, v_category, v_unit, coalesce(p_current_stock, 0),
      coalesce(p_min_stock, 0), coalesce(p_max_stock, 0), coalesce(p_selling_price, 0),
      true, v_category, v_center, coalesce(p_sort, 0), coalesce(p_active, true)
    ) returning * into v;
  else
    update public.products set
      sku = v_sku,
      name = v_name,
      category = v_category,
      unit = v_unit,
      selling_price = coalesce(p_selling_price, 0),
      min_stock = coalesce(p_min_stock, 0),
      max_stock = coalesce(p_max_stock, 0),
      pos_enabled = true,
      pos_category = v_category,
      production_center = v_center,
      pos_sort = coalesce(p_sort, 0),
      pos_active = coalesce(p_active, true),
      updated_at = now()
    where id = v_existing_id and property_id = p_property_id
    returning * into v;
  end if;

  insert into public.pos_menu_categories(property_id, name, production_center)
  values (p_property_id, v_category, v_center)
  on conflict (property_id, name)
  do update set production_center = excluded.production_center;

  return v;
end;
$$;

-- Keep the authenticated-only execute boundary established by the catalogue migration.
revoke all on function public.fn_upsert_pos_menu_item(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,text,integer,boolean) from public, anon;
grant execute on function public.fn_upsert_pos_menu_item(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,text,integer,boolean) to authenticated;

notify pgrst, 'reload schema';
