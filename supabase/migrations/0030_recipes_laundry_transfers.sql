-- Recipe/BOM, automatic stock consumption, Laundry, and stock Transfers.
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  menu_item_name text not null,
  yield_qty numeric(14,3) not null default 1 check (yield_qty > 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique(property_id, menu_item_name)
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric(14,3) not null check (qty > 0),
  unique(recipe_id, product_id)
);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(property_id, name)
);

create table if not exists public.product_stock_locations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  qty numeric(14,2) not null default 0 check (qty >= 0),
  unique(product_id, location_id)
);

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  from_location_id uuid not null references public.inventory_locations(id),
  to_location_id uuid not null references public.inventory_locations(id),
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  reference text,
  lines jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.laundry_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  guest_name text,
  status text not null default 'received' check (status in ('received','washing','ready','delivered','cancelled')),
  items jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.product_stock_locations enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.laundry_orders enable row level security;

do $$ declare t text; begin
  foreach t in array array['recipes','recipe_ingredients','inventory_locations','product_stock_locations','stock_transfers','laundry_orders'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s',t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (public.is_platform_owner() or public.is_member_of_property(property_id))',t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$s',t);
    execute format('create policy "%1$s_insert" on public.%1$s for insert with check (public.is_platform_owner() or public.is_member_of_property(property_id))',t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s',t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (public.is_platform_owner() or public.is_member_of_property(property_id)) with check (public.is_platform_owner() or public.is_member_of_property(property_id))',t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s',t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (public.is_platform_owner() or public.is_member_of_property(property_id))',t);
  end loop;
end $$;

create or replace function public.fn_upsert_recipe(
  p_property_id uuid,
  p_menu_item_name text,
  p_yield_qty numeric,
  p_ingredients jsonb,
  p_notes text default null
) returns public.recipes
language plpgsql security definer set search_path=public
as $$
declare v_recipe public.recipes; v_line jsonb; v_product uuid; v_qty numeric;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_menu_item_name),'') is null then raise exception 'Menu item name is required'; end if;
  insert into public.recipes(property_id,menu_item_name,yield_qty,notes)
    values(p_property_id,trim(p_menu_item_name),coalesce(p_yield_qty,1),p_notes)
    on conflict(property_id,menu_item_name) do update set yield_qty=excluded.yield_qty,notes=excluded.notes,active=true
    returning * into v_recipe;
  delete from public.recipe_ingredients where recipe_id=v_recipe.id;
  for v_line in select value from jsonb_array_elements(coalesce(p_ingredients,'[]'::jsonb)) loop
    v_product := nullif(v_line->>'product_id','')::uuid;
    v_qty := coalesce((v_line->>'qty')::numeric,0);
    if v_product is null or v_qty <= 0 then raise exception 'Invalid recipe ingredient'; end if;
    if not exists(select 1 from public.products where id=v_product and property_id=p_property_id) then raise exception 'Ingredient does not belong to property'; end if;
    insert into public.recipe_ingredients(recipe_id,product_id,qty) values(v_recipe.id,v_product,v_qty);
  end loop;
  return v_recipe;
end;
$$;

create or replace function public.fn_consume_recipe_stock(
  p_property_id uuid, p_items jsonb, p_reference text default 'POS sale'
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare item jsonb; ing record; v_name text; v_order_qty numeric; v_factor numeric; v_needed numeric; v_stock numeric; v_consumed jsonb:='[]'::jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_name := trim(coalesce(item->>'name',item->>'item_name',''));
    v_order_qty := coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0);
    if v_name='' or v_order_qty<=0 then continue; end if;
    for ing in
      select ri.product_id, ri.qty, r.yield_qty
      from public.recipes r join public.recipe_ingredients ri on ri.recipe_id=r.id
      where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)
    loop
      v_factor := v_order_qty / greatest(ing.yield_qty,0.001);
      v_needed := ing.qty * v_factor;
      select current_stock into v_stock from public.products where id=ing.product_id for update;
      if v_stock < v_needed then
        raise exception 'Insufficient stock for recipe ingredient: %', (select name from public.products where id=ing.product_id);
      end if;
      update public.products set current_stock=current_stock-v_needed,updated_at=now() where id=ing.product_id;
      insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id)
        values(p_property_id,ing.product_id,'out',v_needed,p_reference,auth.uid());
      insert into public.stock_usage(property_id,usage_date,department,product_id,qty,reference,created_by)
        values(p_property_id,current_date,'F&B',ing.product_id,v_needed,p_reference,auth.uid());
      v_consumed := v_consumed || jsonb_build_object('product_id',ing.product_id,'qty',v_needed);
    end loop;
  end loop;
  return v_consumed;
end;
$$;

create or replace function public.fn_record_pos_sale(
  p_property_id uuid,p_table_number text,p_order_number text,p_items jsonb,p_subtotal numeric,
  p_discount_amount numeric,p_vat numeric,p_total numeric,p_payment_method text,p_reservation_id uuid default null
) returns public.pos_receipts
language plpgsql security definer set search_path=public
as $$
declare v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 v_folio_charge_id uuid; v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_payment_method not in ('cash','card','mpesa','room') then raise exception 'Unknown payment method.'; end if;
  if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;

  if p_payment_method='room' then
    if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
    v_role:=public.current_staff_role(p_property_id);
    if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier') then raise exception 'Only an authorised cashier can charge a restaurant bill to a room.'; end if;
    select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name
      from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id;
    if v_res_property is null or v_res_property<>p_property_id then raise exception 'Reservation not found.'; end if;
    insert into public.folio_charges(property_id,reservation_id,source,description,amount)
      values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total)
      returning id into v_folio_charge_id;
  end if;

  perform public.fn_consume_recipe_stock(p_property_id,p_items,coalesce(nullif(p_order_number,''),'POS sale'));

  insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,items,subtotal,discount_amount,vat,total,payment_method,folio_charge_id,created_by)
    values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid())
    returning * into v_receipt;
  return v_receipt;
end;
$$;
grant execute on function public.fn_upsert_recipe(uuid,text,numeric,jsonb,text) to authenticated;
grant execute on function public.fn_consume_recipe_stock(uuid,jsonb,text) to authenticated;
grant execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid) to authenticated;

create or replace function public.fn_create_laundry_order(
 p_property_id uuid,p_reservation_id uuid,p_room_id uuid,p_guest_name text,p_items jsonb,p_total numeric,p_notes text default null
) returns public.laundry_orders
language plpgsql security definer set search_path=public
as $$
declare v_order public.laundry_orders;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_total<0 then raise exception 'Invalid laundry total'; end if;
 insert into public.laundry_orders(property_id,reservation_id,room_id,guest_name,items,total,notes,created_by)
 values(p_property_id,p_reservation_id,p_room_id,p_guest_name,coalesce(p_items,'[]'::jsonb),p_total,p_notes,auth.uid()) returning * into v_order;
 return v_order;
end;
$$;

create or replace function public.fn_update_laundry_order(p_order_id uuid,p_status text,p_notes text default null)
returns public.laundry_orders language plpgsql security definer set search_path=public
as $$
declare v public.laundry_orders;
begin
 select * into v from public.laundry_orders where id=p_order_id for update;
 if not found then raise exception 'Laundry order not found'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not authorized'; end if;
 if p_status not in ('received','washing','ready','delivered','cancelled') then raise exception 'Invalid laundry status'; end if;
 update public.laundry_orders set status=p_status,notes=coalesce(p_notes,notes),completed_at=case when p_status='delivered' then now() else completed_at end where id=p_order_id returning * into v;
 return v;
end;
$$;

create or replace function public.fn_complete_stock_transfer(p_transfer_id uuid)
returns public.stock_transfers language plpgsql security definer set search_path=public
as $$
declare v public.stock_transfers; l jsonb; pid uuid; qty numeric; from_qty numeric;
begin
 select * into v from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception 'Transfer not found'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not authorized'; end if;
 if v.status<>'pending' then raise exception 'Transfer is not pending'; end if;
 if v.from_location_id=v.to_location_id then raise exception 'Source and destination must differ'; end if;
 for l in select value from jsonb_array_elements(v.lines) loop
   pid:=nullif(l->>'product_id','')::uuid; qty:=coalesce((l->>'qty')::numeric,0);
   if pid is null or qty<=0 then raise exception 'Invalid transfer line'; end if;
   select coalesce(sum(qty),0) into from_qty from public.product_stock_locations where product_id=pid and location_id=v.from_location_id;
   if from_qty<qty then raise exception 'Insufficient stock at source location'; end if;
   update public.product_stock_locations set qty=qty-l.qty where product_id=pid and location_id=v.from_location_id;
   insert into public.product_stock_locations(property_id,product_id,location_id,qty)
     values(v.property_id,pid,v.to_location_id,qty)
     on conflict(product_id,location_id) do update set qty=product_stock_locations.qty+excluded.qty;
   insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id)
     values(v.property_id,pid,'out',qty,'Transfer '||v.id::text,auth.uid());
 end loop;
 update public.stock_transfers set status='completed',completed_by=auth.uid(),completed_at=now() where id=v.id returning * into v;
 return v;
end;
$$;

grant execute on function public.fn_create_laundry_order(uuid,uuid,uuid,text,jsonb,numeric,text) to authenticated;
grant execute on function public.fn_update_laundry_order(uuid,text,text) to authenticated;
grant execute on function public.fn_complete_stock_transfer(uuid) to authenticated;
notify pgrst,'reload schema';
