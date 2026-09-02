-- OliTechs PMS/POS — Store / Controls + inventory v2
-- Adds a product catalogue, suppliers, GRNs, usage and auditable stock movements.
-- Run after the existing hotel-operation migrations.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  contact text,
  phone text,
  email text,
  products_supplied text,
  created_at timestamptz not null default now(),
  unique(property_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  sku text,
  name text not null,
  category text not null default 'General',
  unit text not null default 'pcs',
  current_stock numeric(14,2) not null default 0,
  min_stock numeric(14,2) not null default 0,
  max_stock numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0,
  selling_price numeric(14,2) not null default 0,
  supplier_id uuid references public.suppliers(id) on delete set null,
  location text not null default 'Main Store',
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, sku)
);
create index if not exists products_property_idx on public.products(property_id);
create index if not exists products_category_idx on public.products(property_id, category);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  type text not null check (type in ('in','out')),
  qty numeric(14,2) not null check (qty > 0),
  reason text,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_property_idx on public.stock_movements(property_id, created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_no text,
  purchase_date date not null default current_date,
  lines jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists purchase_orders_property_idx on public.purchase_orders(property_id, purchase_date desc);

create table if not exists public.stock_usage (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  usage_date date not null default current_date,
  department text not null check (department in ('F&B','Housekeeping','Laundry','Bar')),
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric(14,2) not null check (qty > 0),
  reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_usage_property_idx on public.stock_usage(property_id, usage_date desc);

create table if not exists public.low_stock_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alert_type text not null check (alert_type in ('low_stock','out_of_stock','expiry')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists low_stock_alerts_property_idx on public.low_stock_alerts(property_id, resolved, created_at desc);

alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.stock_usage enable row level security;
alter table public.low_stock_alerts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['suppliers','products','stock_movements','purchase_orders','stock_usage','low_stock_alerts'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (public.is_platform_owner() or public.is_member_of_property(property_id))', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$s', t);
    execute format('create policy "%1$s_insert" on public.%1$s for insert with check (public.is_platform_owner() or public.is_member_of_property(property_id))', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s', t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (public.is_platform_owner() or public.is_member_of_property(property_id)) with check (public.is_platform_owner() or public.is_member_of_property(property_id))', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s', t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (public.is_platform_owner() or public.is_member_of_property(property_id))', t);
  end loop;
end $$;

create or replace function public.fn_adjust_product_stock(p_product_id uuid, p_change numeric, p_reason text)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare v_product public.products;
        v_type text;
        v_qty numeric;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null then raise exception 'Product not found.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(v_product.property_id)) then raise exception 'Not allowed.'; end if;
  if p_change = 0 then return v_product; end if;
  update public.products set current_stock = greatest(0, current_stock + p_change), updated_at = now() where id = p_product_id returning * into v_product;
  v_type := case when p_change > 0 then 'in' else 'out' end;
  v_qty := abs(p_change);
  insert into public.stock_movements(property_id, product_id, type, qty, reason, user_id)
    values(v_product.property_id, p_product_id, v_type, v_qty, p_reason, auth.uid());
  if v_product.current_stock <= 0 then
    insert into public.low_stock_alerts(property_id, product_id, alert_type)
      values(v_product.property_id, p_product_id, 'out_of_stock');
  elsif v_product.current_stock <= v_product.min_stock then
    insert into public.low_stock_alerts(property_id, product_id, alert_type)
      values(v_product.property_id, p_product_id, 'low_stock');
  end if;
  return v_product;
end;
$$;

create or replace function public.fn_touch_products()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.fn_touch_products();
