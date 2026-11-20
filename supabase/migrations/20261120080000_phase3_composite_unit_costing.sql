-- Phase 3: unit-aware composite recipes and immutable cost snapshots.
begin;
alter table public.recipe_ingredients
 add column if not exists entered_qty numeric(20,6),
 add column if not exists entered_unit text references public.inventory_units(code),
 add column if not exists unit_cost_snapshot numeric(20,6),
 add column if not exists line_cost_snapshot numeric(20,6);
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.recipe_ingredients'::regclass and conname='recipe_ingredients_entered_qty_positive') then
  alter table public.recipe_ingredients add constraint recipe_ingredients_entered_qty_positive check(entered_qty is null or entered_qty>0);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.recipe_ingredients'::regclass and conname='recipe_ingredients_cost_snapshots_nonnegative') then
  alter table public.recipe_ingredients add constraint recipe_ingredients_cost_snapshots_nonnegative check((unit_cost_snapshot is null or unit_cost_snapshot>=0) and (line_cost_snapshot is null or line_cost_snapshot>=0));
 end if;
end $$;

create or replace function public.fn_inventory_unit_factor(p_property_id uuid,p_from_unit text,p_to_unit text)
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare f numeric; fd text; td text;
begin
 if p_from_unit is null or p_to_unit is null then raise exception 'Both units are required.' using errcode='22023'; end if;
 if p_from_unit=p_to_unit then return 1; end if;
 select dimension into fd from public.inventory_units where code=p_from_unit;
 select dimension into td from public.inventory_units where code=p_to_unit;
 if fd is null or td is null then raise exception 'Unknown inventory unit.' using errcode='22023'; end if;
 if fd<>td then raise exception 'Cannot convert between different unit dimensions.' using errcode='22023'; end if;
 select factor into f from public.inventory_unit_conversions where from_unit=p_from_unit and to_unit=p_to_unit and (property_id=p_property_id or property_id is null) order by (property_id is not null) desc limit 1;
 if f is not null then return f; end if;
 select 1/factor into f from public.inventory_unit_conversions where from_unit=p_to_unit and to_unit=p_from_unit and (property_id=p_property_id or property_id is null) order by (property_id is not null) desc limit 1;
 if f is not null then return f; end if;
 raise exception 'No conversion configured from % to %.',p_from_unit,p_to_unit using errcode='22023';
end $$;
revoke all on function public.fn_inventory_unit_factor(uuid,text,text) from public,anon;
grant execute on function public.fn_inventory_unit_factor(uuid,text,text) to authenticated;

create or replace function public.fn_upsert_composite_product_recipe(
 p_property_id uuid,p_product_id uuid,p_is_composite boolean,p_components jsonb default '[]'::jsonb,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_role text; v_property_role text; v_product public.products; v_recipe public.recipes;
 v_line jsonb; v_component_id uuid; v_entered_qty numeric; v_entered_unit text;
 v_factor numeric; v_base_qty numeric; v_unit_cost numeric; v_line_cost numeric;
 v_seen uuid[]:=array[]::uuid[]; v_component record; v_total_cost numeric:=0; v_name_matches integer:=0;
begin
 if p_property_id is null or p_product_id is null then raise exception 'Property and menu product are required.' using errcode='22023'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized for this property.' using errcode='42501'; end if;
 v_role:=lower(coalesce(public.current_staff_role(p_property_id),''));
 v_property_role:=lower(coalesce(public.property_role(p_property_id),''));
 if not(public.is_platform_owner() or v_property_role in ('owner','admin','manager') or v_role in ('hotel_admin','super_admin','fb_manager','store_manager','inventory_manager')) then
  raise exception 'Only an authorised manager can edit composite recipes.' using errcode='42501';
 end if;
 select * into v_product from public.products where id=p_product_id and property_id=p_property_id for update;
 if not found then raise exception 'Menu product not found in this property.'; end if;
 if not coalesce(p_is_composite,false) then
  update public.products set inventory_tracking_mode=case when track_stock then 'direct' else 'untracked' end,updated_at=now() where id=p_product_id and property_id=p_property_id;
  update public.recipes set active=false where property_id=p_property_id and menu_product_id=p_product_id;
  return jsonb_build_object('product_id',p_product_id,'is_composite',false,'recipe_id',null,'component_cost',0);
 end if;
 if jsonb_typeof(coalesce(p_components,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_components,'[]'::jsonb))=0 then raise exception 'Add at least one component.' using errcode='22023'; end if;

 -- Validate all lines and compute cost before mutating recipe data.
 for v_line in select value from jsonb_array_elements(p_components) loop
  v_component_id:=nullif(v_line->>'product_id','')::uuid;
  v_entered_qty:=nullif(v_line->>'qty','')::numeric;
  if v_component_id is null or v_entered_qty is null or v_entered_qty<=0 then raise exception 'Each component requires a product and positive quantity.' using errcode='22023'; end if;
  if v_component_id=p_product_id or v_component_id=any(v_seen) then raise exception 'Self-reference and duplicate components are not allowed.' using errcode='22023'; end if;
  select p.id,p.name,p.property_id,p.cost_price,p.track_stock,p.inventory_tracking_mode,p.base_unit into v_component from public.products p where p.id=v_component_id and p.property_id=p_property_id for share;
  if not found then raise exception 'Every component must belong to this property.' using errcode='23503'; end if;
  if not coalesce(v_component.track_stock,true) or v_component.inventory_tracking_mode in ('untracked','composite') then raise exception 'Component "%" must be directly tracked; nested composites are not supported.',v_component.name; end if;
  v_entered_unit:=coalesce(nullif(v_line->>'unit',''),v_component.base_unit);
  v_factor:=public.fn_inventory_unit_factor(p_property_id,v_entered_unit,v_component.base_unit);
  v_base_qty:=round(v_entered_qty*v_factor,6);
  if v_base_qty<=0 then raise exception 'Converted quantity is too small.' using errcode='22023'; end if;
  v_unit_cost:=coalesce(v_component.cost_price,0);
  v_total_cost:=v_total_cost+round(v_base_qty*v_unit_cost,6);
  v_seen:=array_append(v_seen,v_component_id);
 end loop;

 select * into v_recipe from public.recipes where property_id=p_property_id and menu_product_id=p_product_id for update;
 if not found then
  select count(*) into v_name_matches from public.products where property_id=p_property_id and lower(btrim(name))=lower(btrim(v_product.name));
  if v_name_matches>1 then raise exception 'Duplicate product names prevent safe legacy recipe matching.'; end if;
  if v_name_matches=1 then
   select * into v_recipe from public.recipes where property_id=p_property_id and menu_product_id is null and lower(btrim(menu_item_name))=lower(btrim(v_product.name)) order by created_at,id limit 1 for update;
  end if;
 end if;
 if v_recipe.id is null then
  insert into public.recipes(property_id,menu_item_name,menu_product_id,yield_qty,active,notes,recipe_version) values(p_property_id,v_product.name,p_product_id,1,true,p_notes,1) returning * into v_recipe;
 else
  update public.recipes set menu_item_name=v_product.name,menu_product_id=p_product_id,active=true,notes=p_notes,recipe_version=recipe_version+1 where id=v_recipe.id returning * into v_recipe;
 end if;
 delete from public.recipe_ingredients where recipe_id=v_recipe.id;
 for v_line in select value from jsonb_array_elements(p_components) loop
  v_component_id:=(v_line->>'product_id')::uuid; v_entered_qty:=(v_line->>'qty')::numeric; v_entered_unit:=nullif(v_line->>'unit','');
  select p.base_unit,p.cost_price into v_component from public.products p where p.id=v_component_id and p.property_id=p_property_id;
  v_entered_unit:=coalesce(v_entered_unit,v_component.base_unit);
  v_factor:=public.fn_inventory_unit_factor(p_property_id,v_entered_unit,v_component.base_unit);
  v_base_qty:=round(v_entered_qty*v_factor,6); v_unit_cost:=coalesce(v_component.cost_price,0); v_line_cost:=round(v_base_qty*v_unit_cost,6);
  insert into public.recipe_ingredients(recipe_id,product_id,qty,entered_qty,entered_unit,unit_cost_snapshot,line_cost_snapshot)
   values(v_recipe.id,v_component_id,v_base_qty,v_entered_qty,v_entered_unit,v_unit_cost,v_line_cost);
 end loop;
 update public.products set inventory_tracking_mode='composite',updated_at=now() where id=p_product_id and property_id=p_property_id;
 return jsonb_build_object('product_id',p_product_id,'is_composite',true,'recipe_id',v_recipe.id,'recipe_version',v_recipe.recipe_version,'component_cost',round(v_total_cost,6));
end $$;
revoke all on function public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text) from public,anon;
grant execute on function public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text) to authenticated;
commit;
notify pgrst,'reload schema';
