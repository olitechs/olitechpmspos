-- Restore the channel reservation event and sync queue tables used by PMS services.
-- Safe to run on installations where either table already exists.

begin;

create table if not exists public.channel_sync_queue (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  connection_id uuid references public.channel_connections(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_reservation_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  connection_id uuid references public.channel_connections(id) on delete set null,
  external_reservation_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received'
    check (status in ('received','processing','processed','failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (connection_id, external_reservation_id, event_type)
);

create index if not exists channel_sync_queue_property_created_idx
  on public.channel_sync_queue(property_id, created_at desc);
create index if not exists channel_reservation_events_property_received_idx
  on public.channel_reservation_events(property_id, received_at desc);

alter table public.channel_sync_queue enable row level security;
alter table public.channel_reservation_events enable row level security;

drop policy if exists channel_sync_queue_select on public.channel_sync_queue;
create policy channel_sync_queue_select
  on public.channel_sync_queue
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists channel_reservation_events_select on public.channel_reservation_events;
create policy channel_reservation_events_select
  on public.channel_reservation_events
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

revoke all privileges on table public.channel_sync_queue from anon, authenticated;
revoke all privileges on table public.channel_reservation_events from anon, authenticated;
grant select on table public.channel_sync_queue to authenticated;
grant select on table public.channel_reservation_events to authenticated;

notify pgrst, 'reload schema';
commit;
