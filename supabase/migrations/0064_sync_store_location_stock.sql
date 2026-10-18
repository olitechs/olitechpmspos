-- Phase 5 — keep Store location stock synchronized with the authoritative product ledger.
create or replace function public.fn_sync_product_default_location()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location_id uuid;
  v_delta numeric;
begin
  if new.current_stock is distinct from old.current_stock then
    v_delta := coalesce(new.current_stock,0) - coalesce(old.current_stock,0);

    insert into public.inventory_locations(property_id,name)
    values(new.property_id,coalesce(nullif(trim(new.location),''),'Main Store'))
    on conflict(property_id,name) do nothing;

    select id into v_location_id
    from public.inventory_locations
    where property_id=new.property_id
      and name=coalesce(nullif(trim(new.location),''),'Main Store')
    limit 1;

    insert into public.product_stock_locations(property_id,product_id,location_id,qty)
    values(new.property_id,new.id,v_location_id,greatest(0,coalesce(new.current_stock,0)))
    on conflict(product_id,location_id)
    do update set qty=greatest(0,product_stock_locations.qty + v_delta);
  end if;
  return new;
end
$$;

drop trigger if exists products_sync_default_location on public.products;
create trigger products_sync_default_location
after update of current_stock on public.products
for each row
when (old.current_stock is distinct from new.current_stock)
execute function public.fn_sync_product_default_location();

notify pgrst,'reload schema';