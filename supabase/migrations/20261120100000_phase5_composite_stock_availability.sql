-- Phase 5: composite stock availability, low-stock alerts and component movement history.
begin;

create index if not exists stock_movements_composite_history_idx
  on public.stock_movements(property_id,product_id,created_at desc)
  where source_type='pos_recipe';

create or replace function public.fn_sync_product_low_stock_alert(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_product public.products;
  v_type text;
begin
  select * into v_product from public.products where id=p_product_id;
  if not found then return; end if;

  v_type:=case
    when coalesce(v_product.current_stock,0)<=0 then 'out_of_stock'
    when coalesce(v_product.min_stock,0)>0 and v_product.current_stock<=v_product.min_stock then 'low_stock'
    else null end;

  if v_type is null then
    update public.low_stock_alerts set resolved=true
    where property_id=v_product.property_id and product_id=v_product.id and resolved=false
      and alert_type in ('low_stock','out_of_stock');
    return;
  end if;

  update public.low_stock_alerts set resolved=true
  where property_id=v_product.property_id and product_id=v_product.id and resolved=false
    and alert_type in ('low_stock','out_of_stock') and alert_type<>v_type;

  if not exists(select 1 from public.low_stock_alerts
    where property_id=v_product.property_id and product_id=v_product.id
      and alert_type=v_type and resolved=false) then
    insert into public.low_stock_alerts(property_id,product_id,alert_type,resolved)
    values(v_product.property_id,v_product.id,v_type,false);
  end if;
end;
$function$;

create or replace function public.trg_sync_product_low_stock_alert()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
begin
  perform public.fn_sync_product_low_stock_alert(new.id);
  return new;
end;
$function$;

drop trigger if exists products_sync_low_stock_alert on public.products;
create trigger products_sync_low_stock_alert
after insert or update of current_stock,min_stock on public.products
for each row execute function public.trg_sync_product_low_stock_alert();

-- Reconcile existing product balances once at migration time.
do $block$
declare r record;
begin
  for r in select id from public.products loop
    perform public.fn_sync_product_low_stock_alert(r.id);
  end loop;
end;
$block$;

create or replace function public.fn_list_composite_stock_availability(p_property_id uuid)
returns table(
 menu_product_id uuid,menu_product_name text,component_product_id uuid,
 component_name text,required_per_sale numeric,available_stock numeric,
 max_sellable_qty numeric,component_unit text,stock_status text
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
begin
  if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.' using errcode='42501';
  end if;
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;

  return query
  with recipe_components as (
    select r.menu_product_id,r.yield_qty,ri.product_id,
      sum(ri.qty/greatest(coalesce(r.yield_qty,1),0.000001)) as required_per_sale
    from public.recipes r
    join public.recipe_ingredients ri on ri.recipe_id=r.id
    where r.property_id=p_property_id and r.active and r.menu_product_id is not null
    group by r.menu_product_id,r.yield_qty,ri.product_id
  )
  select rc.menu_product_id,mp.name,cp.id,cp.name,rc.required_per_sale,
    coalesce(cp.current_stock,0),
    case when rc.required_per_sale>0 then floor(greatest(coalesce(cp.current_stock,0),0)/rc.required_per_sale) else 0 end,
    cp.base_unit,
    case when coalesce(cp.current_stock,0)<=0 then 'out_of_stock'
      when cp.min_stock>0 and cp.current_stock<=cp.min_stock then 'low_stock'
      else 'available' end
  from recipe_components rc
  join public.products mp on mp.id=rc.menu_product_id and mp.property_id=p_property_id
  join public.products cp on cp.id=rc.product_id and cp.property_id=p_property_id
  order by mp.name,cp.name;
end;
$function$;

create or replace function public.fn_list_composite_component_history(
 p_property_id uuid,p_menu_product_id uuid,p_limit integer default 50
)
returns table(
 movement_id uuid,component_product_id uuid,component_name text,movement_type text,
 quantity numeric,unit_code text,unit_cost numeric,recipe_version integer,
 reference text,created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
   raise exception 'Not authorized for this property.' using errcode='42501';
 end if;
 if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
 return query
 select sm.id,sm.product_id,p.name,sm.type,coalesce(sm.base_qty,sm.qty),
   coalesce(sm.unit_code,p.base_unit),sm.unit_cost,sm.recipe_version,sm.reason,sm.created_at
 from public.stock_movements sm
 join public.products p on p.id=sm.product_id and p.property_id=p_property_id
 where sm.property_id=p_property_id and sm.source_type='pos_recipe'
   and sm.recipe_id in (select r.id from public.recipes r where r.property_id=p_property_id and r.menu_product_id=p_menu_product_id)
 order by sm.created_at desc
 limit greatest(1,least(coalesce(p_limit,50),200));
end;
$function$;

revoke all on function public.fn_sync_product_low_stock_alert(uuid) from public,anon,authenticated;
revoke all on function public.fn_list_composite_stock_availability(uuid) from public,anon;
revoke all on function public.fn_list_composite_component_history(uuid,uuid,integer) from public,anon;
grant execute on function public.fn_list_composite_stock_availability(uuid) to authenticated;
grant execute on function public.fn_list_composite_component_history(uuid,uuid,integer) to authenticated;

commit;
notify pgrst,'reload schema';
