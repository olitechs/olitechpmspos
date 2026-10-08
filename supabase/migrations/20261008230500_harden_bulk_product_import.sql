-- Harden bulk store imports against common spreadsheet formatting issues.
-- Invalid supplier identifiers are ignored instead of aborting a row.
-- Invalid expiry dates are treated as NULL; valid dates remain unchanged.
-- Authorization and authoritative stock movements remain unchanged.

create or replace function public.fn_bulk_upsert_store_products(p_property_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r jsonb; v_product public.products; v_existing public.products;
  v_category text; v_name text; v_sku text; v_unit text; v_location text; v_pos_category text; v_center text;
  v_stock numeric; v_old_stock numeric; v_min numeric; v_max numeric; v_cost numeric; v_price numeric;
  v_pos_enabled boolean; v_pos_active boolean; v_sort integer; v_supplier uuid; v_location_id uuid;
  v_count integer := 0; v_created integer := 0; v_updated integer := 0; v_stock_adjusted integer := 0; v_change numeric;
  v_errors jsonb := '[]'::jsonb; v_expiry date; v_supplier_raw text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_name := nullif(trim(coalesce(r->>'name','')), '');
      if v_name is null then raise exception 'Product name is required.'; end if;
      v_sku := nullif(trim(coalesce(r->>'sku','')), '');
      v_category := coalesce(nullif(trim(r->>'category'), ''), 'General');
      v_unit := coalesce(nullif(trim(r->>'unit'), ''), 'pcs');
      v_location := coalesce(nullif(trim(r->>'location'), ''), 'Main Store');
      v_pos_category := coalesce(nullif(trim(r->>'pos_category'), ''), v_category);
      v_center := coalesce(nullif(trim(r->>'production_center'), ''), 'Kitchen');
      v_stock := greatest(0, coalesce(nullif(trim(r->>'current_stock'),'')::numeric, nullif(trim(r->>'quantity'),'')::numeric, 0));
      v_min := greatest(0, coalesce(nullif(trim(r->>'min_stock'),'')::numeric, nullif(trim(r->>'low_stock_threshold'),'')::numeric, 0));
      v_max := greatest(0, coalesce(nullif(trim(r->>'max_stock'),'')::numeric, 0));
      v_cost := greatest(0, coalesce(nullif(trim(r->>'cost_price'),'')::numeric, 0));
      v_price := greatest(0, coalesce(nullif(trim(r->>'selling_price'),'')::numeric, 0));
      v_pos_enabled := lower(trim(coalesce(r->>'pos_enabled','false'))) in ('true','1','yes','y');
      v_pos_active := lower(trim(coalesce(r->>'pos_active','true'))) not in ('false','0','no','n');
      v_sort := coalesce(nullif(trim(r->>'pos_sort'),'')::integer, nullif(trim(r->>'sort_order'),'')::integer, 0);

      v_supplier := null;
      v_supplier_raw := nullif(trim(coalesce(r->>'supplier_id','')), '');
      if v_supplier_raw is not null and v_supplier_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_supplier := v_supplier_raw::uuid;
      end if;

      v_expiry := null;
      if nullif(trim(coalesce(r->>'expiry_date','')), '') is not null then
        begin
          v_expiry := nullif(trim(r->>'expiry_date'),'')::date;
        exception when others then
          v_expiry := null;
        end;
      end if;

      if not (public.is_platform_owner() or public.can_store_write(p_property_id, v_category)) then
        raise exception 'You do not have Store write access for category %.', v_category;
      end if;

      if v_sku is not null then
        select * into v_existing from public.products
        where property_id = p_property_id and sku = v_sku limit 1 for update;
      else
        select * into v_existing from public.products
        where property_id = p_property_id and lower(trim(name)) = lower(v_name) limit 1 for update;
      end if;

      if v_existing.id is null then
        insert into public.products(
          property_id, sku, name, category, unit, current_stock, min_stock, max_stock,
          cost_price, selling_price, supplier_id, location, expiry_date,
          pos_enabled, pos_category, production_center, pos_sort, pos_active
        )
        values(
          p_property_id, v_sku, v_name, v_category, v_unit, 0, v_min, v_max,
          v_cost, v_price, v_supplier, v_location, v_expiry,
          v_pos_enabled, case when v_pos_enabled then v_pos_category else null end,
          v_center, v_sort, v_pos_active
        )
        returning * into v_product;
        v_created := v_created + 1;
        if v_stock > 0 then
          perform public.fn_apply_stock_movement(v_product.id, v_stock,
            'Bulk Store CSV import — opening stock', 'bulk_import', v_product.id);
          v_stock_adjusted := v_stock_adjusted + 1;
        end if;
      else
        v_old_stock := coalesce(v_existing.current_stock, 0);
        update public.products
        set sku = coalesce(v_sku, sku), name = v_name, category = v_category, unit = v_unit,
            min_stock = v_min, max_stock = v_max, cost_price = v_cost, selling_price = v_price,
            supplier_id = coalesce(v_supplier, supplier_id), location = v_location,
            expiry_date = v_expiry, pos_enabled = v_pos_enabled,
            pos_category = case when v_pos_enabled then v_pos_category else null end,
            production_center = v_center, pos_sort = v_sort, pos_active = v_pos_active, updated_at = now()
        where id = v_existing.id returning * into v_product;
        v_updated := v_updated + 1;
        v_change := v_stock - v_old_stock;
        if v_change <> 0 then
          perform public.fn_apply_stock_movement(v_product.id, v_change,
            'Bulk Store CSV import — stock reconciliation', 'bulk_import', v_product.id);
          v_stock_adjusted := v_stock_adjusted + 1;
          select * into v_product from public.products where id = v_existing.id;
        end if;
      end if;

      insert into public.inventory_locations(property_id, name)
      values(p_property_id, v_location)
      on conflict(property_id, name) do nothing;
      select id into v_location_id from public.inventory_locations
      where property_id = p_property_id and name = v_location limit 1;

      insert into public.product_stock_locations(property_id, product_id, location_id, qty)
      values(p_property_id, v_product.id, v_location_id, v_stock)
      on conflict(product_id, location_id) do update set qty = excluded.qty;

      if v_pos_enabled then
        insert into public.pos_menu_categories(property_id, name, production_center)
        values(p_property_id, v_pos_category, v_center)
        on conflict(property_id, name)
        do update set production_center = excluded.production_center, active = true;
      end if;
      v_count := v_count + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'sku', v_sku, 'error', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_count, 'created', v_created, 'updated', v_updated,
    'stock_adjusted', v_stock_adjusted, 'errors', v_errors
  );
end
$function$;

revoke all on function public.fn_bulk_upsert_store_products(uuid,jsonb) from public, anon;
grant execute on function public.fn_bulk_upsert_store_products(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
