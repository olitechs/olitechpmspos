-- Minimal disposable PostgreSQL fixture for the POS menu RPC authorization migration.
-- This is intentionally isolated from any live Supabase project.

create schema if not exists auth;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$roles$;

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create table public.staff (
  property_id uuid not null,
  is_active boolean not null default true,
  user_id uuid,
  email text,
  assigned_modules text[] not null default '{}'
);

create table public.products (
  id uuid primary key,
  property_id uuid not null,
  sku text,
  name text not null,
  pos_category text,
  category text,
  unit text,
  current_stock numeric,
  min_stock numeric,
  selling_price numeric,
  production_center text,
  pos_sort integer,
  pos_enabled boolean not null default true,
  pos_active boolean not null default true
);

create or replace function public.is_platform_owner()
returns boolean language sql volatile as $$
  select coalesce(current_setting('test.platform_owner', true), 'false') = 'true';
$$;

create or replace function public.is_member_of_property(p_property_id uuid)
returns boolean language sql volatile as $$
  select public.is_platform_owner()
    or coalesce(current_setting('test.member_property', true), '') = p_property_id::text;
$$;

create or replace function public.property_role(p_property_id uuid)
returns text language sql volatile as $$
  select case when public.is_member_of_property(p_property_id)
    then nullif(current_setting('test.property_role', true), '') else null end;
$$;

create or replace function public.current_staff_role(p_property_id uuid)
returns text language sql volatile as $$
  select case when coalesce(current_setting('test.staff_property', true), '') = p_property_id::text
    then nullif(current_setting('test.staff_role', true), '') else null end;
$$;

insert into public.products(
  id, property_id, sku, name, category, pos_category, unit, current_stock,
  min_stock, selling_price, production_center, pos_sort, pos_enabled, pos_active
) values
(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'TEST-1', 'Test POS item', 'Food', 'Food', 'each', 10, 2, 100,
  'Kitchen', 1, true, true
),
(
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'TEST-2', 'Other property item', 'Food', 'Food', 'each', 5, 1, 200,
  'Kitchen', 1, true, true
);

grant usage on schema public, auth to authenticated, service_role;
grant select on public.staff, public.products to authenticated, service_role;
grant insert on public.staff to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function auth.role() to authenticated, service_role;
grant execute on function auth.jwt() to authenticated, service_role;
grant execute on function public.is_platform_owner() to authenticated, service_role;
grant execute on function public.is_member_of_property(uuid) to authenticated, service_role;
grant execute on function public.property_role(uuid) to authenticated, service_role;
grant execute on function public.current_staff_role(uuid) to authenticated, service_role;
