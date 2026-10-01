-- Booking engine + channel connectivity
-- Defensive migration: creates required tables before RLS/policies and
-- repairs missing columns on partially-applied installations.

create table if not exists public.booking_engine_settings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid unique not null references public.properties(id) on delete cascade,
  enabled boolean not null default true,
  currency text not null default 'USD',
  terms text,
  cancellation_policy text,
  payment_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_engine_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  check_in date not null,
  check_out date not null,
  adults integer not null default 2,
  children integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  channel text not null,
  status text not null default 'disconnected'
    check (status in ('disconnected','pending','connected','error')),
  external_property_id text,
  credentials jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, channel)
);

create table if not exists public.channel_room_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.channel_connections(id) on delete cascade,
  room_type_id uuid not null references public.room_types(id) on delete cascade,
  external_room_type_id text not null,
  external_rate_plan_id text,
  active boolean not null default true,
  unique(connection_id, room_type_id, external_room_type_id)
);

create table if not exists public.channel_sync_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  connection_id uuid references public.channel_connections(id) on delete set null,
  direction text not null check (direction in ('outbound','inbound')),
  event_type text not null,
  status text not null check (status in ('queued','sent','received','failed')),
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

-- Compatibility for partially-created tables.
alter table public.booking_engine_settings
  add column if not exists property_id uuid,
  add column if not exists enabled boolean not null default true,
  add column if not exists currency text not null default 'USD',
  add column if not exists terms text,
  add column if not exists cancellation_policy text,
  add column if not exists payment_instructions text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.booking_engine_sessions
  add column if not exists property_id uuid,
  add column if not exists check_in date,
  add column if not exists check_out date,
  add column if not exists adults integer not null default 2,
  add column if not exists children integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table public.channel_connections
  add column if not exists property_id uuid,
  add column if not exists channel text,
  add column if not exists status text not null default 'disconnected',
  add column if not exists external_property_id text,
  add column if not exists credentials jsonb not null default '{}'::jsonb,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.channel_room_mappings
  add column if not exists connection_id uuid,
  add column if not exists room_type_id uuid,
  add column if not exists external_room_type_id text,
  add column if not exists external_rate_plan_id text,
  add column if not exists active boolean not null default true;

alter table public.channel_sync_events
  add column if not exists property_id uuid,
  add column if not exists connection_id uuid,
  add column if not exists direction text,
  add column if not exists event_type text,
  add column if not exists status text,
  add column if not exists external_id text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz not null default now();

alter table public.booking_engine_settings enable row level security;
alter table public.booking_engine_sessions enable row level security;
alter table public.channel_connections enable row level security;
alter table public.channel_room_mappings enable row level security;
alter table public.channel_sync_events enable row level security;

-- PostgreSQL does not support CREATE POLICY IF NOT EXISTS.
drop policy if exists booking_engine_settings_select on public.booking_engine_settings;
create policy booking_engine_settings_select
on public.booking_engine_settings for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists booking_engine_settings_write on public.booking_engine_settings;
create policy booking_engine_settings_write
on public.booking_engine_settings for all
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists booking_engine_sessions_select on public.booking_engine_sessions;
create policy booking_engine_sessions_select
on public.booking_engine_sessions for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists channel_connections_select on public.channel_connections;
create policy channel_connections_select
on public.channel_connections for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists channel_connections_write on public.channel_connections;
create policy channel_connections_write
on public.channel_connections for all
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists channel_room_mappings_select on public.channel_room_mappings;
create policy channel_room_mappings_select
on public.channel_room_mappings for select
using (
  exists (
    select 1 from public.channel_connections c
    where c.id = connection_id
      and (public.is_platform_owner() or public.is_member_of_property(c.property_id))
  )
);

drop policy if exists channel_room_mappings_write on public.channel_room_mappings;
create policy channel_room_mappings_write
on public.channel_room_mappings for all
using (
  exists (
    select 1 from public.channel_connections c
    where c.id = connection_id
      and (public.is_platform_owner() or public.is_member_of_property(c.property_id))
  )
)
with check (
  exists (
    select 1 from public.channel_connections c
    where c.id = connection_id
      and (public.is_platform_owner() or public.is_member_of_property(c.property_id))
  )
);

drop policy if exists channel_sync_events_select on public.channel_sync_events;
create policy channel_sync_events_select
on public.channel_sync_events for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_channel_connection_upsert(
  p_property_id uuid,
  p_channel text,
  p_external_property_id text default null
)
returns public.channel_connections
language plpgsql security definer set search_path=public
as $$
declare
  v public.channel_connections;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  insert into public.channel_connections(
    property_id, channel, external_property_id, status
  )
  values (p_property_id, p_channel, p_external_property_id, 'pending')
  on conflict(property_id, channel)
  do update set
    external_property_id = excluded.external_property_id,
    updated_at = now()
  returning * into v;

  return v;
end;
$$;

create or replace function public.fn_public_booking_engine_config(p_property_id uuid)
returns jsonb
language sql security definer set search_path=public
as $$
select jsonb_build_object(
  'property_id', p.id,
  'name', p.name,
  'currency', coalesce(s.currency, 'USD'),
  'terms', s.terms,
  'cancellation_policy', s.cancellation_policy,
  'payment_instructions', s.payment_instructions
)
from public.properties p
left join public.booking_engine_settings s on s.property_id = p.id
where p.id = p_property_id;
$$;

grant execute on function public.fn_channel_connection_upsert(uuid,text,text) to authenticated;
grant execute on function public.fn_public_booking_engine_config(uuid) to anon,authenticated;

notify pgrst, 'reload schema';
