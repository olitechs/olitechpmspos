-- Phase 5 — Stores & Inventory: authoritative Store catalogue + POS bridge
-- Bulk Store imports register products in the authoritative products ledger.
-- POS visibility is opt-in per row via pos_enabled / pos_category.
-- Stock changes are auditable and synchronized to the product's default location.

alter table public.products
  add column if not exists pos_enabled boolean not null default false,
  add column if not exists pos_category text,
  add column if not exists production_center text not null default 'Kitchen',
  add column if not exists pos_sort integer not null default 0,
  add column if not exists pos_active boolean not null default true;

create or replace function public.fn_bulk_upsert_store_products(
  p_property_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_product public.products;
  v_existing public.products;
  v_category text;
  v_name text;
  v_sku text;
  v_unit text;
  v_location text;
  v_pos_category text;
  v_center text;
  v_stock numeric;
  v_old_stock numeric;
  v_min numeric;
  v_max numeric;
  v_cost numeric;
  v_price numeric;
  v_pos_enabled boolean;
  v_pos_active boolean;
  v_sort integer;
  v_supplier uuid;
  v_location_id uuid;
  v_count integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_stock_adjusted integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_name := nullif(trim(coalesce(r->>'name','')), '');
      if v_name is null then
        raise exception 'Product name is required.';
      end if;

      v_sku := nullif(trim(coalesce(r->>'sku','')), '');
      v_category := coalesce(nullif(trim(r->>'category'), ''), 'General');
      v_unit := coalesce(nullif(trim(r->>'unit'), ''), 'pcs');
      v_location := coalesce(nullif(trim(r->>'location'), ''), 'Main Store');
      v_pos_category := coalesce(nullif(trim(r->>'pos_category'), ''), v_category);
      v_center := coalesce(nullif(trim(r->>'production_center'), ''), 'Kitchen');
      v_stock := greatest(0, coalesce(nullif(r->>'current_stock','')::numeric, nullif(r->>'quantity','')::numeric, 0));
      v_min := greatest(0, coalesce(nullif(r->>'min_stock','')::numeric, nullif(r->>'low_stock_threshold','')::numeric, 0));
      v_max := greatest(0, coalesce(nullif(r->>'max_stock','')::numeric, 0));
      v_cost := greatest(0, coalesce(nullif(r->>'cost_price','')::numeric, 0));
      v_price := greatest(0, coalesce(nullif(r->>'selling_price','')::numeric, 0));
      v_pos_enabled := lower(coalesce(r->>'pos_enabled','false')) in ('true','1','yes','y');
      v_pos_active := lower(coalesce(r->>'pos_active','true')) not in ('false','0','no','n');
      v_sort := coalesce(nullif(r->>'pos_sort','')::integer, nullif(r->>'sort_order','')::integer, 0);
      v_supplier := nullif(r->>'supplier_id','')::uuid;

      if not (public.is_platform_owner() or public.can_store_write(p_property_id, v_category)) then
        raise exception 'You do not have Store write access for category %.', v_category;
      end if;

      if v_sku is not null then
        select * into v_existing
        from public.products
        where property_id = p_property_id and sku = v_sku
        limit 1
        for update;
      else
        select * into v_existing
        from public.products
        where property_id = p_property_id and lower(trim(name)) = lower(v_name)
        limit 1
        for update;
      end if;

      if v_existing.id is null then
        insert into public.products(
          property_id, sku, name, category, unit, current_stock, min_stock, max_stock,
          cost_price, selling_price, supplier_id, location, expiry_date,
          pos_enabled, pos_category, production_center, pos_sort, pos_active
        )
        values(
          p_property_id, v_sku, v_name, v_category, v_unit, v_stock, v_min, v_max,
          v_cost, v_price, v_supplier, v_location, nullif(r->>'expiry_date',''),
          v_pos_enabled, case when v_pos_enabled then v_pos_category else null end,
          v_center, v_sort, v_pos_active
        )
        returning * into v_product;

        v_created := v_created + 1;
        if v_stock > 0 then
          insert into public.stock_movements(property_id, product_id, type, qty, reason, user_id)
          values(p_property_id, v_product.id, 'in', v_stock, 'Bulk Store CSV import — opening stock', auth.uid());
          v_stock_adjusted := v_stock_adjusted + 1;
        end if;
      else
        v_old_stock := coalesce(v_existing.current_stock, 0);

        update public.products
        set sku = coalesce(v_sku, sku),
            name = v_name,
            category = v_category,
            unit = v_unit,
            current_stock = v_stock,
            min_stock = v_min,
            max_stock = v_max,
            cost_price = v_cost,
            selling_price = v_price,
            supplier_id = coalesce(v_supplier, supplier_id),
            location = v_location,
            expiry_date = nullif(r->>'expiry_date',''),
            pos_enabled = v_pos_enabled,
            pos_category = case when v_pos_enabled then v_pos_category else null end,
            production_center = v_center,
            pos_sort = v_sort,
            pos_active = v_pos_active,
            updated_at = now()
        where id = v_existing.id
        returning * into v_product;

        v_updated := v_updated + 1;
        if v_old_stock <> v_stock then
          insert into public.stock_movements(property_id, product_id, type, qty, reason, user_id)
          values(
            p_property_id, v_product.id,
            case when v_stock > v_old_stock then 'in' else 'out' end,
            abs(v_stock - v_old_stock),
            'Bulk Store CSV import — stock reconciliation',
            auth.uid()
          );
          v_stock_adjusted := v_stock_adjusted + 1;
        end if;
      end if;

      insert into public.inventory_locations(property_id, name)
      values(p_property_id, v_location)
      on conflict(property_id, name) do nothing;

      select id into v_location_id
      from public.inventory_locations
      where property_id = p_property_id and name = v_location
      limit 1;

      insert into public.product_stock_locations(property_id, product_id, location_id, qty)
      values(p_property_id, v_product.id, v_location_id, v_stock)
      on conflict(product_id, location_id)
      do update set qty = excluded.qty;

      if v_pos_enabled then
        insert into public.pos_menu_categories(property_id, name, production_center)
        values(p_property_id, v_pos_category, v_center)
        on conflict(property_id, name)
        do update set production_center = excluded.production_center, active = true;
      end if;

      v_count := v_count + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'name', v_name,
        'sku', v_sku,
        'error', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_count,
    'created', v_created,
    'updated', v_updated,
    'stock_adjusted', v_stock_adjusted,
    'errors', v_errors
  );
end
$$;

grant execute on function public.fn_bulk_upsert_store_products(uuid,jsonb) to authenticated;

-- Store is the POS source of truth: only products explicitly enabled for POS
-- can appear in the ordering catalogue, and inactive/disabled rows disappear.
create or replace function public.fn_list_pos_menu(p_property_id uuid)
returns table(
  id uuid, sku text, name text, category text, unit text, current_stock numeric,
  min_stock numeric, selling_price numeric, production_center text, pos_sort integer
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id,
         p.sku,
         p.name,
         coalesce(nullif(p.pos_category,''), p.category),
         p.unit,
         p.current_stock,
         p.min_stock,
         p.selling_price,
         p.production_center,
         p.pos_sort
  from public.products p
  where p.property_id = p_property_id
    and p.pos_enabled = true
    and p.pos_active = true
  order by coalesce(nullif(p.pos_category,''), p.category), p.pos_sort, p.name;
$$;

grant execute on function public.fn_list_pos_menu(uuid) to authenticated;

notify pgrst, 'reload schema';