-- Phase 4: atomic composite stock consumption and category-based POS routing.
-- Sale RPC already calls fn_consume_recipe_stock inside its transaction. Replace
-- that helper with product-ID matching, idempotent ledger writes and recipe snapshots.
begin;

create or replace function public.fn_consume_recipe_stock(
  p_property_id uuid,
  p_items jsonb,
  p_reference text default 'POS sale'
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_item jsonb;
  v_recipe record;
  v_ing record;
  v_product public.products;
  v_order_qty numeric;
  v_needed numeric;
  v_line integer:=0;
  v_component_index integer;
  v_policy text;
  v_key text;
  v_movement_id uuid;
  v_consumed jsonb:='[]'::jsonb;
  v_menu_product_id uuid;
  v_item_name text;
begin
  if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.' using errcode='42501';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'POS sale items must be an array.' using errcode='22023';
  end if;

  -- Serialize consumption for the same property/order. A retry after a committed
  -- receipt is returned by the sale RPC's idempotency path before reaching here.
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':'||coalesce(p_reference,'POS sale'),0));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line:=v_line+1;
    v_order_qty:=coalesce(nullif(v_item->>'qty','')::numeric,nullif(v_item->>'quantity','')::numeric,0);
    v_menu_product_id:=nullif(v_item->>'product_id','')::uuid;
    v_item_name:=trim(coalesce(v_item->>'name',v_item->>'item_name',''));
    if v_order_qty<=0 then continue; end if;
    if v_menu_product_id is null then continue; end if;

    -- Stable product link is authoritative. Name matching is retained only for
    -- legacy recipes that have not yet been linked to a product ID.
    select r.id,r.menu_product_id,r.yield_qty,r.recipe_version
      into v_recipe
    from public.recipes r
    where r.property_id=p_property_id and r.active
      and (r.menu_product_id=v_menu_product_id
        or (r.menu_product_id is null and lower(btrim(r.menu_item_name))=lower(btrim(v_item_name))))
    order by (r.menu_product_id is not null) desc,r.created_at,r.id
    limit 1;
    if not found then continue; end if;

    v_component_index:=0;
    for v_ing in
      select ri.product_id,ri.qty,ri.unit_cost_snapshot,ri.entered_unit
      from public.recipe_ingredients ri
      where ri.recipe_id=v_recipe.id
      order by ri.id
    loop
      v_component_index:=v_component_index+1;
      v_needed:=round(v_ing.qty*(v_order_qty/greatest(coalesce(v_recipe.yield_qty,1),0.000001)),6);
      if v_needed<=0 then raise exception 'Composite recipe contains an invalid component quantity.'; end if;

      v_key:=md5(p_property_id::text||':'||coalesce(p_reference,'POS sale')||':'||v_line::text||':'||v_recipe.id::text||':'||v_recipe.recipe_version::text||':'||v_component_index::text||':'||v_ing.product_id::text||':'||txid_current()::text);
      if exists(select 1 from public.stock_movements sm where sm.property_id=p_property_id and sm.idempotency_key=v_key) then
        continue;
      end if;

      select * into v_product
      from public.products p
      where p.id=v_ing.product_id and p.property_id=p_property_id
      for update;
      if not found then
        raise exception 'Composite component is no longer available in this property.' using errcode='23503';
      end if;
      if not coalesce(v_product.track_stock,true) or v_product.inventory_tracking_mode<>'direct' then
        raise exception 'Composite component % must remain a directly tracked inventory item.',v_product.name;
      end if;

      select coalesce(ps.negative_stock_policy,'warn_allow') into v_policy
      from public.property_settings ps where ps.property_id=p_property_id;
      v_policy:=coalesce(v_policy,'warn_allow');
      if v_policy='block' and coalesce(v_product.current_stock,0)<v_needed then
        raise exception 'Insufficient stock for % (available %, required %).',v_product.name,coalesce(v_product.current_stock,0),v_needed;
      end if;

      update public.products set current_stock=coalesce(current_stock,0)-v_needed,updated_at=now()
      where id=v_product.id and property_id=p_property_id;

      insert into public.stock_movements(
        property_id,product_id,type,qty,reason,user_id,source_type,source_id,
        source_line_key,idempotency_key,unit_code,base_qty,unit_cost,recipe_id,recipe_version
      ) values(
        p_property_id,v_product.id,'out',v_needed,
        'POS composite sale '||coalesce(p_reference,''),auth.uid(),'pos_recipe',null,
        v_line::text||':'||v_component_index::text,v_key,v_product.base_unit,v_needed,
        coalesce(v_ing.unit_cost_snapshot,v_product.cost_price,0),v_recipe.id,v_recipe.recipe_version
      ) returning id into v_movement_id;

      insert into public.stock_usage(property_id,usage_date,department,product_id,qty,reference,created_by)
      values(p_property_id,current_date,'F&B',v_product.id,v_needed,p_reference,auth.uid());

      v_consumed:=v_consumed||jsonb_build_array(jsonb_build_object(
        'menu_product_id',v_menu_product_id,'recipe_id',v_recipe.id,'recipe_version',v_recipe.recipe_version,
        'component_product_id',v_product.id,'qty',v_needed,'unit',v_product.base_unit,
        'stock_movement_id',v_movement_id
      ));
    end loop;
  end loop;
  perform set_config('olitechs.pos_composite_movement_ids',coalesce((select jsonb_agg(value->>'stock_movement_id')::text from jsonb_array_elements(v_consumed)),'[]'),true);
  return v_consumed;
end;
$function$;
revoke all on function public.fn_consume_recipe_stock(uuid,jsonb,text) from public,anon;
grant execute on function public.fn_consume_recipe_stock(uuid,jsonb,text) to authenticated;

-- Keep the existing input signature so POS clients continue to call the same RPC.
-- The output now includes tracking mode so the POS can distinguish a composite's
-- recipe-backed availability from direct stock on the sellable menu product.
-- Drop/recreate is required because PostgreSQL cannot replace a table return type.
drop function if exists public.fn_list_pos_menu(uuid);
create function public.fn_list_pos_menu(p_property_id uuid)
returns table(
 id uuid,sku text,name text,category text,unit text,inventory_tracking_mode text,current_stock numeric,min_stock numeric,
 selling_price numeric,production_center text,pos_sort integer,tile_color text,tile_text_color text,tile_image_url text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.access') then
    raise exception 'Missing employee permission: pos.access';
  end if;
  if p_property_id is null then raise exception 'Property id is required.' using errcode='22023'; end if;
  if coalesce(auth.role(),'')<>'service_role' then
    if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
    if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
      raise exception 'Not authorized to access this property menu.' using errcode='42501';
    end if;
    if not(
      public.is_platform_owner()
      or coalesce(public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter'),false)
      or coalesce(public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager','receptionist','front_desk'),false)
      or exists(select 1 from public.staff s where s.property_id=p_property_id and s.is_active=true
        and (s.user_id=auth.uid() or lower(coalesce(s.email,''))=lower(coalesce(auth.jwt()->>'email','')))
        and 'pos'=any(coalesce(s.assigned_modules,array[]::text[])))
    ) then raise exception 'POS module access required.' using errcode='42501'; end if;
  end if;

  return query
  select p.id,p.sku,p.name,coalesce(nullif(p.pos_category,''),p.category),
    p.unit,coalesce(p.inventory_tracking_mode,'direct'),p.current_stock,p.min_stock,p.selling_price,
    coalesce(nullif(c.production_center,''),p.production_center,'Kitchen'),
    p.pos_sort,p.tile_color,p.tile_text_color,p.tile_image_url
  from public.products p
  left join public.pos_menu_categories c
    on c.property_id=p.property_id and c.name=coalesce(nullif(p.pos_category,''),p.category) and c.active=true
  where p.property_id=p_property_id and p.pos_enabled is true and p.pos_active is true
    and coalesce(p.stock_item_type,'') not in ('raw_ingredient','consumable')
  order by coalesce(nullif(p.pos_category,''),p.category),p.pos_sort,p.name;
end;
$function$;
revoke all on function public.fn_list_pos_menu(uuid) from public,anon;
grant execute on function public.fn_list_pos_menu(uuid) to authenticated,service_role;
commit;
notify pgrst,'reload schema';
