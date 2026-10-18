-- OliTechs PMS/POS — POS Menu Catalogue + cashier menu management
-- Uses the existing products table as the authoritative stock ledger.
alter table public.products
  add column if not exists pos_enabled boolean not null default false,
  add column if not exists pos_category text,
  add column if not exists production_center text not null default 'Kitchen',
  add column if not exists pos_sort integer not null default 0,
  add column if not exists pos_active boolean not null default true;

create table if not exists public.pos_menu_categories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  production_center text not null default 'Kitchen',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, name)
);
create index if not exists pos_menu_categories_property_idx
  on public.pos_menu_categories(property_id, active, sort_order, name);

alter table public.pos_menu_categories enable row level security;

drop policy if exists pos_menu_categories_select on public.pos_menu_categories;
drop policy if exists pos_menu_categories_insert on public.pos_menu_categories;
drop policy if exists pos_menu_categories_update on public.pos_menu_categories;
drop policy if exists pos_menu_categories_delete on public.pos_menu_categories;

create or replace function public.can_manage_pos_menu(p_property_id uuid)
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier')
    or public.current_staff_role(p_property_id) in (
      'hotel_admin','super_admin','owner','admin','manager','cashier','fb_manager','property_manager','general_manager'
    );
$$;

create policy pos_menu_categories_select on public.pos_menu_categories
for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

create policy pos_menu_categories_insert on public.pos_menu_categories
for insert with check (public.can_manage_pos_menu(property_id));

create policy pos_menu_categories_update on public.pos_menu_categories
for update using (public.can_manage_pos_menu(property_id))
with check (public.can_manage_pos_menu(property_id));

create policy pos_menu_categories_delete on public.pos_menu_categories
for delete using (public.can_manage_pos_menu(property_id));

-- Re-open product catalogue management for POS cashiers without giving them
-- Store-level control over non-POS inventory.
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;

create policy products_insert on public.products
for insert with check (
  public.can_store_write(property_id, category)
  or (pos_enabled and public.can_manage_pos_menu(property_id))
);

create policy products_update on public.products
for update using (
  public.can_store_write(property_id, category)
  or (pos_enabled and public.can_manage_pos_menu(property_id))
)
with check (
  public.can_store_write(property_id, category)
  or (pos_enabled and public.can_manage_pos_menu(property_id))
);

create policy products_delete on public.products
for delete using (
  public.can_store_write(property_id, category)
  or (pos_enabled and public.can_manage_pos_menu(property_id))
);

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
set search_path=public
as $$
declare v public.products;
begin
  if not public.can_manage_pos_menu(p_property_id) then raise exception 'Only an authorised manager or cashier can manage the POS menu.'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Product name is required.'; end if;
  if coalesce(p_selling_price,0) < 0 or coalesce(p_current_stock,0) < 0 then raise exception 'Price and stock cannot be negative.'; end if;

  if p_id is null then
    insert into public.products(
      property_id,sku,name,category,unit,current_stock,min_stock,max_stock,
      selling_price,pos_enabled,pos_category,production_center,pos_sort,pos_active
    ) values (
      p_property_id,nullif(trim(p_sku),''),trim(p_name),coalesce(nullif(trim(p_category),''),'General'),
      coalesce(nullif(trim(p_unit),''),'pcs'),coalesce(p_current_stock,0),coalesce(p_min_stock,0),
      coalesce(p_max_stock,0),coalesce(p_selling_price,0),true,
      coalesce(nullif(trim(p_category),''),'General'),coalesce(nullif(trim(p_production_center),''),'Kitchen'),
      coalesce(p_sort,0),coalesce(p_active,true)
    ) returning * into v;
  else
    update public.products set
      sku=nullif(trim(p_sku),''),
      name=trim(p_name),
      category=coalesce(nullif(trim(p_category),''),'General'),
      unit=coalesce(nullif(trim(p_unit),''),'pcs'),
      selling_price=coalesce(p_selling_price,0),
      min_stock=coalesce(p_min_stock,0),
      max_stock=coalesce(p_max_stock,0),
      pos_enabled=true,
      pos_category=coalesce(nullif(trim(p_category),''),'General'),
      production_center=coalesce(nullif(trim(p_production_center),''),'Kitchen'),
      pos_sort=coalesce(p_sort,0),
      pos_active=coalesce(p_active,true),
      updated_at=now()
    where id=p_id and property_id=p_property_id
    returning * into v;
    if v.id is null then raise exception 'POS product not found.'; end if;
  end if;

  insert into public.pos_menu_categories(property_id,name,production_center)
  values(p_property_id,coalesce(nullif(trim(p_category),''),'General'),coalesce(nullif(trim(p_production_center),''),'Kitchen'))
  on conflict(property_id,name) do update set production_center=excluded.production_center;

  return v;
end;
$$;

create or replace function public.fn_bulk_upsert_pos_menu(
  p_property_id uuid,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare r jsonb; v_count integer:=0; v_id uuid;
begin
  if not public.can_manage_pos_menu(p_property_id) then raise exception 'Only an authorised manager or cashier can manage the POS menu.'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_id:=nullif(r->>'id','')::uuid;
    perform public.fn_upsert_pos_menu_item(
      p_property_id,v_id,r->>'sku',r->>'name',coalesce(r->>'category','General'),
      coalesce(r->>'unit','pcs'),coalesce((r->>'selling_price')::numeric,0),
      coalesce((r->>'current_stock')::numeric,0),coalesce((r->>'min_stock')::numeric,0),
      coalesce((r->>'max_stock')::numeric,0),coalesce(r->>'production_center','Kitchen'),
      coalesce((r->>'pos_sort')::integer,0),coalesce((r->>'pos_active')::boolean,true)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.fn_list_pos_menu(p_property_id uuid)
returns table(
  id uuid, sku text, name text, category text, unit text, current_stock numeric,
  min_stock numeric, selling_price numeric, production_center text, pos_sort integer
)
language sql
security definer
stable
set search_path=public
as $$
  select p.id,p.sku,p.name,coalesce(p.pos_category,p.category),p.unit,p.current_stock,
         p.min_stock,p.selling_price,p.production_center,p.pos_sort
  from public.products p
  where p.property_id=p_property_id and p.pos_enabled=true and p.pos_active=true
  order by coalesce(p.pos_category,p.category),p.pos_sort,p.name;
$$;

grant execute on function public.can_manage_pos_menu(uuid) to authenticated;
grant execute on function public.fn_upsert_pos_menu_item(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,text,integer,boolean) to authenticated;
grant execute on function public.fn_bulk_upsert_pos_menu(uuid,jsonb) to authenticated;
grant execute on function public.fn_list_pos_menu(uuid) to authenticated;

-- Seed existing product categories into the POS category table when a property
-- already has POS-enabled products.
insert into public.pos_menu_categories(property_id,name,production_center)
select distinct property_id,coalesce(pos_category,category,'General'),coalesce(production_center,'Kitchen')
from public.products
where pos_enabled=true
on conflict(property_id,name) do nothing;

-- Extend the existing transactional POS sale so direct POS products also
-- decrement stock. Recipe-backed menu items continue using the existing BOM flow.
create or replace function public.fn_record_pos_sale(
  p_property_id uuid,p_table_number text,p_order_number text,p_items jsonb,p_subtotal numeric,
  p_discount_amount numeric,p_vat numeric,p_total numeric,p_payment_method text,p_reservation_id uuid default null,
  p_shift_id uuid default null,p_waiter text default null
) returns public.pos_receipts
language plpgsql security definer set search_path=public
as $$
declare v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 v_folio_charge_id uuid; v_receipt public.pos_receipts; item jsonb; v_product public.products;
 v_qty numeric; v_name text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_payment_method not in ('cash','card','mpesa','room','bank') then raise exception 'Unknown payment method.'; end if;
  if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;

  if p_payment_method='room' then
    if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
    v_role:=public.current_staff_role(p_property_id);
    if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','manager','admin','owner','property_manager','general_manager') then raise exception 'Only an authorised cashier can charge a restaurant bill to a room.'; end if;
    select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name
      from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id;
    if v_res_property is null or v_res_property<>p_property_id then raise exception 'Reservation not found.'; end if;
    insert into public.folio_charges(property_id,reservation_id,source,description,amount)
      values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total)
      returning id into v_folio_charge_id;
  end if;

  perform public.fn_consume_recipe_stock(p_property_id,p_items,coalesce(nullif(p_order_number,''),'POS sale'));

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0);
    v_name:=trim(coalesce(item->>'name',item->>'item_name',''));
    if v_qty>0 and nullif(item->>'product_id','') is not null then
      begin
        select * into v_product from public.products where id=(item->>'product_id')::uuid and property_id=p_property_id for update;
        if v_product.id is not null and not exists(
          select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)
        ) then
          if v_product.current_stock < v_qty then
            raise exception 'Insufficient stock for % (available %, required %).',v_product.name,v_product.current_stock,v_qty;
          end if;
          update public.products set current_stock=current_stock-v_qty,updated_at=now() where id=v_product.id;
          insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id)
            values(p_property_id,v_product.id,'out',v_qty,'POS Sale '||coalesce(p_order_number,''),auth.uid());
        end if;
      exception when invalid_text_representation then
        null;
      end;
    end if;
  end loop;

  insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,items,subtotal,discount_amount,vat,total,payment_method,folio_charge_id,created_by,shift_id,waiter)
    values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),p_shift_id,p_waiter)
    returning * into v_receipt;
  return v_receipt;
end;
$$;

grant execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text) to authenticated;
