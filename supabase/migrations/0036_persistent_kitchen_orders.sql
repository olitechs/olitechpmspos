-- OliTechs PMS/POS v2 — persistent kitchen display orders
-- Keeps fired kitchen/bar tickets and KDS status server-side so the kitchen
-- survives refreshes and can run on a separate terminal from the POS.

create table if not exists public.pos_kitchen_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_key text,
  table_number text not null,
  order_number text not null,
  waiter text,
  order_lines jsonb not null default '[]'::jsonb,
  status text not null default 'new'
    check (status in ('new','preparing','ready','served')),
  print_jobs jsonb not null default '{}'::jsonb,
  fired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  served_at timestamptz
);

create index if not exists pos_kitchen_orders_property_idx
  on public.pos_kitchen_orders(property_id, status, fired_at desc);

create unique index if not exists pos_kitchen_orders_order_idx
  on public.pos_kitchen_orders(property_id, order_number);

alter table public.pos_kitchen_orders enable row level security;

drop policy if exists pos_kitchen_orders_select on public.pos_kitchen_orders;
create policy pos_kitchen_orders_select
  on public.pos_kitchen_orders for select
  using (
    public.is_platform_owner()
    or public.is_member_of_property(property_id)
  );

drop policy if exists pos_kitchen_orders_insert on public.pos_kitchen_orders;
create policy pos_kitchen_orders_insert
  on public.pos_kitchen_orders for insert
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  );

drop policy if exists pos_kitchen_orders_update on public.pos_kitchen_orders;
create policy pos_kitchen_orders_update
  on public.pos_kitchen_orders for update
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  )
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  );

create or replace function public.fn_create_kitchen_order(
  p_property_id uuid,
  p_table_key text,
  p_table_number text,
  p_order_number text,
  p_waiter text,
  p_order_lines jsonb,
  p_print_jobs jsonb
) returns public.pos_kitchen_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pos_kitchen_orders;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  insert into public.pos_kitchen_orders(
    property_id, table_key, table_number, order_number, waiter,
    order_lines, status, print_jobs, fired_at, updated_at
  ) values (
    p_property_id,
    nullif(trim(p_table_key),''),
    coalesce(nullif(trim(p_table_number),''),''),
    coalesce(nullif(trim(p_order_number),''),''),
    nullif(trim(p_waiter),''),
    coalesce(p_order_lines,'[]'::jsonb),
    'new',
    coalesce(p_print_jobs,'{}'::jsonb),
    now(),
    now()
  )
  on conflict (property_id, order_number)
  do update set
    table_key = excluded.table_key,
    table_number = excluded.table_number,
    waiter = excluded.waiter,
    order_lines = excluded.order_lines,
    print_jobs = excluded.print_jobs,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.fn_create_kitchen_order(
  uuid,text,text,text,text,jsonb,jsonb
) to authenticated;

create or replace function public.fn_list_active_kitchen_orders(
  p_property_id uuid
) returns setof public.pos_kitchen_orders
language sql
security definer
stable
set search_path = public
as $$
  select *
  from public.pos_kitchen_orders
  where property_id = p_property_id
    and status <> 'served'
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by fired_at asc;
$$;

grant execute on function public.fn_list_active_kitchen_orders(uuid) to authenticated;

create or replace function public.fn_update_kitchen_order(
  p_property_id uuid,
  p_order_id uuid,
  p_status text,
  p_print_jobs jsonb
) returns public.pos_kitchen_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pos_kitchen_orders;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  if p_status not in ('new','preparing','ready','served') then
    raise exception 'Invalid kitchen order status.';
  end if;

  update public.pos_kitchen_orders
     set status = p_status,
         print_jobs = coalesce(p_print_jobs, print_jobs),
         updated_at = now(),
         served_at = case when p_status = 'served' then coalesce(served_at, now()) else null end
   where id = p_order_id
     and property_id = p_property_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.fn_update_kitchen_order(
  uuid,uuid,text,jsonb
) to authenticated;

notify pgrst, 'reload schema';
