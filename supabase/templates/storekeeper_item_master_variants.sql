-- Storekeeper item-master access: keep product writes inside the same property
-- boundary and require the explicit stock-adjust permission.
alter table public.products add column if not exists description text;

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  );

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  )
  with check (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  );

create unique index if not exists products_id_property_id_uidx
  on public.products(id,property_id);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  product_id uuid not null,
  name text not null check (length(btrim(name))>0),
  sku text,
  barcode text,
  price_delta numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0 check (cost_price>=0),
  current_stock numeric(14,4) not null default 0 check (current_stock>=0),
  track_stock boolean not null default true,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes)='object'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_product_property_fk
    foreign key(product_id,property_id) references public.products(id,property_id) on delete cascade,
  constraint product_variants_property_sku_uidx unique(property_id,sku)
);

create index if not exists product_variants_product_idx
  on public.product_variants(property_id,product_id,sort_order);

alter table public.product_variants enable row level security;
drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists product_variants_insert on public.product_variants;
create policy product_variants_insert on public.product_variants
  for insert to authenticated
  with check (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );
drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants
  for update to authenticated
  using (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  )
  with check (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );
drop policy if exists product_variants_delete on public.product_variants;
create policy product_variants_delete on public.product_variants
  for delete to authenticated
  using (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );

-- The composite recipe RPC already checks membership and property ownership.
-- Extend its existing manager guard by one explicit Storekeeper capability.
do $migration$
declare
  v_definition text;
  v_original text := 'or v_role in (''hotel_admin'',''super_admin'',''fb_manager'',''store_manager'',''inventory_manager'')';
  v_replacement text := 'or public.fn_employee_has_permission(p_property_id,''stores.stock.adjust'') or v_role in (''hotel_admin'',''super_admin'',''fb_manager'',''store_manager'',''inventory_manager'')';
begin
  select pg_get_functiondef('public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text)'::regprocedure)
    into v_definition;
  if position(v_original in v_definition)=0 then
    raise exception 'Composite recipe authorization guard changed; review this migration before applying.';
  end if;
  v_definition := replace(v_definition,v_original,v_replacement);
  execute v_definition;
end
$migration$;

