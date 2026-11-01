-- Minimal PostgreSQL fixture for the two Phase 2 audit/folio migrations.
-- It models the required columns from the repository's ordered schema history.
-- This is not a substitute for checking the live Supabase catalog and RLS.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end;
$roles$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function public.is_member_of_property(p_property_id uuid)
returns boolean language sql stable as $$ select true $$;
create or replace function public.is_platform_owner()
returns boolean language sql stable as $$ select false $$;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  property_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key,
  property_id uuid not null,
  number integer not null,
  status text not null default 'available'
);

create table public.reservations (
  id uuid primary key,
  property_id uuid not null,
  room_id uuid not null,
  guest_id uuid,
  guest_name text not null,
  arrival date not null,
  departure date not null,
  status text not null,
  rate numeric(12,2) default 0,
  payment_status text not null default 'not_paid',
  total_amount numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  channel text,
  meal_plan text,
  group_id uuid,
  created_at timestamptz not null default now()
);

create table public.folio_charges (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  reservation_id uuid not null,
  source text not null default 'room',
  description text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  reservation_id uuid not null,
  amount numeric(12,2) not null,
  method text not null default 'cash',
  status text not null default 'posted',
  shift_id uuid,
  created_at timestamptz not null default now()
);

create table public.housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  room_id uuid not null,
  task_type text not null,
  priority text not null,
  status text not null,
  reservation_id uuid,
  notes text,
  due_at timestamptz
);

create or replace view public.folio_totals as
select r.id as reservation_id, r.property_id,
       coalesce(sum(fc.amount), 0) as subtotal,
       coalesce((select sum(p.amount) from public.payments p where p.reservation_id=r.id), 0) as paid,
       coalesce(sum(fc.amount), 0) - coalesce((select sum(p.amount) from public.payments p where p.reservation_id=r.id), 0) as balance
from public.reservations r
left join public.folio_charges fc on fc.reservation_id=r.id
group by r.id, r.property_id;

create or replace function public.fn_check_out_room(p_room_id uuid)
returns public.reservations
language plpgsql as $$
declare v_res public.reservations;
begin
  select * into v_res from public.reservations where room_id=p_room_id limit 1;
  return v_res;
end;
$$;
