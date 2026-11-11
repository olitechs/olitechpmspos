-- Minimal PostgreSQL fixture for the POS table-join and void RPC integration test.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function public.is_platform_owner()
returns boolean language sql stable as $$ select false $$;
create or replace function public.property_role(p_property_id uuid)
returns text language sql stable as $$ select 'cashier'::text $$;
create or replace function public.current_staff_role(p_property_id uuid)
returns text language sql stable as $$ select null::text $$;

create table public.pos_table_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text not null,
  table_number text not null,
  zone_id text,
  status text not null default 'occupied' check (status in ('occupied','unsettled','closed')),
  guests integer not null default 1 check (guests > 0),
  waiter text,
  order_number text,
  order_lines jsonb not null default '[]'::jsonb,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  kot_sent_at timestamptz,
  vat_snapshot jsonb,
  kot_sent_order_lines jsonb not null default '[]'::jsonb
);
create unique index pos_table_sessions_active_idx
  on public.pos_table_sessions(property_id, table_key)
  where status <> 'closed';

create table public.pos_void_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text,
  table_number text not null,
  order_number text,
  check_no text,
  waiter text,
  item_name text not null,
  category text not null,
  removed_qty numeric not null,
  original_qty numeric not null default 0,
  new_qty numeric not null default 0,
  reason text not null,
  removed_by uuid,
  removed_by_name text,
  status text not null default 'pending',
  printer_id uuid,
  print_log_id uuid,
  void_number text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  manager_signature text
);

create table public.pos_order_audit (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text,
  table_number text,
  order_number text,
  item_name text,
  action text not null,
  details jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
