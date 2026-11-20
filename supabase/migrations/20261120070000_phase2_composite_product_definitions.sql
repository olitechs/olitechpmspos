-- Phase 2: stable product-linked composite definitions.
-- Additive only. Legacy name-linked recipes remain active until safely mapped.
begin;

alter table public.products
  add column if not exists inventory_tracking_mode text not null default 'direct';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.products'::regclass
      and conname='products_inventory_tracking_mode_check'
  ) then
    alter table public.products
      add constraint products_inventory_tracking_mode_check
      check (inventory_tracking_mode in ('untracked','direct','composite'));
  end if;
end $$;

alter table public.recipes
  add column if not exists menu_product_id uuid references public.products(id) on delete restrict,
  add column if not exists recipe_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.recipes'::regclass
      and conname='recipes_recipe_version_positive'
  ) then
    alter table public.recipes add constraint recipes_recipe_version_positive check (recipe_version > 0);
  end if;
end $$;

create unique index if not exists recipes_property_menu_product_uidx
  on public.recipes(property_id,menu_product_id)
  where menu_product_id is not null;

create index if not exists recipe_ingredients_product_idx
  on public.recipe_ingredients(product_id);

-- Backfill only unambiguous legacy name matches. Ambiguous rows are intentionally
-- left name-linked and are reported for manual resolution; no recipe is discarded.
with unique_matches as (
  select r.id recipe_id, min(p.id::text)::uuid product_id
  from public.recipes r
  join public.products p
    on p.property_id=r.property_id
   and lower(btrim(p.name))=lower(btrim(r.menu_item_name))
  where r.menu_product_id is null
  group by r.id
  having count(*)=1
)
update public.recipes r
set menu_product_id=u.product_id
from unique_matches u
where r.id=u.recipe_id;

-- Preserve existing legacy recipes' behavior. Only newly configured composite
-- products are switched to composite mode by the guarded RPC below.

create or replace function public.fn_upsert_composite_product_recipe(
  p_property_id uuid,
  p_product_id uuid,
  p_is_composite boolean,
  p_components jsonb default '[]'::jsonb,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_role text;
  v_property_role text;
  v_product public.products;
  v_recipe public.recipes;
  v_line jsonb;
  v_component_id uuid;
  v_qty numeric;
  v_seen uuid[] := array[]::uuid[];
  v_component record;
  v_total_cost numeric := 0;
begin
  if p_property_id is null or p_product_id is null then
    raise exception 'Property and menu product are required.' using errcode='22023';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.' using errcode='42501';
  end if;

  v_role := lower(coalesce(public.current_staff_role(p_property_id),''));
  v_property_role := lower(coalesce(public.property_role(p_property_id),''));
  if not (
    public.is_platform_owner()
    or v_property_role in ('owner','admin','manager')
    or v_role in ('hotel_admin','super_admin','fb_manager','store_manager','inventory_manager')
  ) then
    raise exception 'Only an authorised manager can edit composite recipes.' using errcode='42501';
  end if;

  select * into v_product
  from public.products
  where id=p_product_id and property_id=p_property_id
  for update;
  if not found then raise exception 'Menu product not found in this property.'; end if;

  if coalesce(p_is_composite,false) is false then
    update public.products
      set inventory_tracking_mode=case when track_stock then 'direct' else 'untracked' end,
          updated_at=now()
    where id=p_product_id and property_id=p_property_id;

    update public.recipes
      set active=false
    where property_id=p_property_id and menu_product_id=p_product_id;

    return jsonb_build_object('product_id',p_product_id,'is_composite',false,'recipe_id',null,'component_cost',0);
  end if;

  if jsonb_typeof(coalesce(p_components,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_components,'[]'::jsonb))=0 then
    raise exception 'Add at least one component to make this a composite item.' using errcode='22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_components) loop
    v_component_id := nullif(v_line->>'product_id','')::uuid;
    v_qty := nullif(v_line->>'qty','')::numeric;
    if v_component_id is null or v_qty is null or v_qty<=0 then
      raise exception 'Each component requires a product and a quantity greater than zero.' using errcode='22023';
    end if;
    if v_component_id=p_product_id or v_component_id=any(v_seen) then
      raise exception 'A product cannot contain itself or duplicate the same component.' using errcode='22023';
    end if;
    select p.id,p.name,p.property_id,p.cost_price,p.track_stock,p.inventory_tracking_mode
      into v_component
    from public.products p
    where p.id=v_component_id and p.property_id=p_property_id
    for share;
    if not found then raise exception 'Every component must belong to the same property.' using errcode='23503'; end if;
    if not coalesce(v_component.track_stock,true) or v_component.inventory_tracking_mode='untracked' then
      raise exception 'Component "%" must have stock tracking enabled.',v_component.name;
    end if;
    v_seen := array_append(v_seen,v_component_id);
    v_total_cost := v_total_cost + (coalesce(v_component.cost_price,0)*v_qty);
  end loop;

  select * into v_recipe
  from public.recipes
  where property_id=p_property_id and menu_product_id=p_product_id
  for update;

  if not found then
    -- A legacy name-based recipe can be claimed only if it is unambiguous and
    -- currently has no product link. The unique product index prevents duplicates.
    select * into v_recipe
    from public.recipes
    where property_id=p_property_id
      and menu_product_id is null
      and lower(btrim(menu_item_name))=lower(btrim(v_product.name))
    order by created_at,id
    limit 1
    for update;
  end if;

  if v_recipe.id is null then
    insert into public.recipes(property_id,menu_item_name,menu_product_id,yield_qty,active,notes,recipe_version)
    values(p_property_id,v_product.name,p_product_id,1,true,p_notes,1)
    returning * into v_recipe;
  else
    update public.recipes
    set menu_item_name=v_product.name,menu_product_id=p_product_id,
        active=true,notes=p_notes,recipe_version=recipe_version+1
    where id=v_recipe.id
    returning * into v_recipe;
  end if;

  delete from public.recipe_ingredients where recipe_id=v_recipe.id;
  for v_line in select value from jsonb_array_elements(p_components) loop
    v_component_id := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    insert into public.recipe_ingredients(recipe_id,product_id,qty)
    values(v_recipe.id,v_component_id,v_qty);
  end loop;

  update public.products
  set inventory_tracking_mode='composite',
      track_stock=false,
      updated_at=now()
  where id=p_product_id and property_id=p_property_id;

  return jsonb_build_object(
    'product_id',p_product_id,'is_composite',true,'recipe_id',v_recipe.id,
    'recipe_version',v_recipe.recipe_version,'component_cost',v_total_cost
  );
end;
$function$;

revoke all on function public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text) from public,anon;
grant execute on function public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text) to authenticated;

commit;
notify pgrst,'reload schema';
