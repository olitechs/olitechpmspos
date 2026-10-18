-- Phase 4 inventory operations: locations, transfers, counts, adjustments, production, wastage and expiry.
-- Applied live to Supabase project mszogmazldxjsiytrlxr.
-- Core objects are intentionally guarded by property membership and all balance changes route through fn_apply_stock_movement.

create table if not exists public.inventory_counts(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id) on delete cascade,location_id uuid references public.inventory_locations(id) on delete set null,status text not null default 'draft',reference text,counted_by uuid references public.profiles(id),approved_by uuid references public.profiles(id),created_at timestamptz not null default now(),approved_at timestamptz);
create table if not exists public.inventory_count_lines(id uuid primary key default gen_random_uuid(),count_id uuid not null references public.inventory_counts(id) on delete cascade,product_id uuid not null references public.products(id),expected_qty numeric(14,3) not null default 0,counted_qty numeric(14,3) not null,variance numeric(14,3) generated always as (counted_qty-expected_qty) stored);
create table if not exists public.stock_adjustments(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id) on delete cascade,product_id uuid not null references public.products(id),location_id uuid references public.inventory_locations(id),change_qty numeric(14,3) not null,reason text not null,status text not null default 'posted',created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.inventory_productions(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id) on delete cascade,recipe_id uuid references public.recipes(id),output_product_id uuid not null references public.products(id),quantity numeric(14,3) not null,reference text,status text not null default 'posted',created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.inventory_wastage(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id) on delete cascade,product_id uuid not null references public.products(id),location_id uuid references public.inventory_locations(id),quantity numeric(14,3) not null,reason text not null,expiry_date date,created_by uuid references public.profiles(id),created_at timestamptz not null default now());

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.inventory_productions enable row level security;
alter table public.inventory_wastage enable row level security;
drop policy if exists inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select on public.inventory_counts for select using(is_platform_owner() or is_member_of_property(property_id));
drop policy if exists inventory_count_lines_select on public.inventory_count_lines;
create policy inventory_count_lines_select on public.inventory_count_lines for select using(exists(select 1 from public.inventory_counts c where c.id=count_id and (is_platform_owner() or is_member_of_property(c.property_id))));
drop policy if exists stock_adjustments_select on public.stock_adjustments;
create policy stock_adjustments_select on public.stock_adjustments for select using(is_platform_owner() or is_member_of_property(property_id));
drop policy if exists inventory_productions_select on public.inventory_productions;
create policy inventory_productions_select on public.inventory_productions for select using(is_platform_owner() or is_member_of_property(property_id));
drop policy if exists inventory_wastage_select on public.inventory_wastage;
create policy inventory_wastage_select on public.inventory_wastage for select using(is_platform_owner() or is_member_of_property(property_id));

-- RPC definitions are deployed live; see fn_create_stock_transfer, fn_complete_stock_transfer,
-- fn_post_stock_adjustment, fn_create_inventory_count, fn_approve_inventory_count,
-- fn_post_wastage and fn_post_production.