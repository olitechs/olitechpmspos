create table if not exists public.booking_engine_settings (
 id uuid primary key default gen_random_uuid(), property_id uuid unique not null references public.properties(id) on delete cascade,
 enabled boolean not null default true, currency text not null default 'USD', terms text, cancellation_policy text, payment_instructions text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.booking_engine_sessions (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 check_in date not null, check_out date not null, adults integer not null default 2, children integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.channel_connections (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 channel text not null, status text not null default 'disconnected' check(status in ('disconnected','pending','connected','error')),
 external_property_id text, credentials jsonb not null default '{}'::jsonb, last_sync_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,channel)
);
create table if not exists public.channel_room_mappings (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.channel_connections(id) on delete cascade,
 room_type_id uuid not null references public.room_types(id) on delete cascade, external_room_type_id text not null,
 external_rate_plan_id text, active boolean not null default true, unique(connection_id,room_type_id,external_room_type_id)
);
create table if not exists public.channel_sync_events (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 connection_id uuid references public.channel_connections(id) on delete set null, direction text not null check(direction in ('outbound','inbound')), event_type text not null,
 status text not null check(status in ('queued','sent','received','failed')), external_id text, payload jsonb not null default '{}'::jsonb,
 error_message text, created_at timestamptz not null default now()
);
alter table public.booking_engine_settings enable row level security;
alter table public.booking_engine_sessions enable row level security;
alter table public.channel_connections enable row level security;
alter table public.channel_room_mappings enable row level security;
alter table public.channel_sync_events enable row level security;
create policy if not exists booking_engine_settings_select on public.booking_engine_settings for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists booking_engine_settings_write on public.booking_engine_settings for all using(public.is_platform_owner() or public.is_member_of_property(property_id)) with check(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists booking_engine_sessions_select on public.booking_engine_sessions for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists channel_connections_select on public.channel_connections for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists channel_connections_write on public.channel_connections for all using(public.is_platform_owner() or public.is_member_of_property(property_id)) with check(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists channel_room_mappings_select on public.channel_room_mappings for select using(exists(select 1 from public.channel_connections c where c.id=connection_id and(public.is_platform_owner() or public.is_member_of_property(c.property_id))));
create policy if not exists channel_room_mappings_write on public.channel_room_mappings for all using(exists(select 1 from public.channel_connections c where c.id=connection_id and(public.is_platform_owner() or public.is_member_of_property(c.property_id)))) with check(exists(select 1 from public.channel_connections c where c.id=connection_id and(public.is_platform_owner() or public.is_member_of_property(c.property_id))));
create policy if not exists channel_sync_events_select on public.channel_sync_events for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create or replace function public.fn_channel_connection_upsert(p_property_id uuid,p_channel text,p_external_property_id text default null)
returns public.channel_connections language plpgsql security definer set search_path=public as $$
declare v public.channel_connections;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 insert into public.channel_connections(property_id,channel,external_property_id,status) values(p_property_id,p_channel,p_external_property_id,'pending')
 on conflict(property_id,channel) do update set external_property_id=excluded.external_property_id,updated_at=now() returning * into v;
 return v;
end; $$;
create or replace function public.fn_public_booking_engine_config(p_property_id uuid)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('property_id',p.id,'name',p.name,'currency',coalesce(s.currency,'USD'),'terms',s.terms,'cancellation_policy',s.cancellation_policy,'payment_instructions',s.payment_instructions)
from public.properties p left join public.booking_engine_settings s on s.property_id=p.id where p.id=p_property_id;
$$;
grant execute on function public.fn_channel_connection_upsert(uuid,text,text) to authenticated;
grant execute on function public.fn_public_booking_engine_config(uuid) to anon,authenticated;
notify pgrst,'reload schema';
create table if not exists public.channel_sync_queue (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 connection_id uuid references public.channel_connections(id) on delete set null, event_type text not null,
 payload jsonb not null default '{}'::jsonb, status text not null default 'queued' check(status in ('queued','processing','sent','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(), locked_at timestamptz, processed_at timestamptz, last_error text, idempotency_key text unique, created_at timestamptz not null default now()
);
create table if not exists public.channel_reservation_events (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 connection_id uuid references public.channel_connections(id) on delete set null, external_reservation_id text not null,
 event_type text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'received' check(status in ('received','processing','processed','failed')),
 error_message text, received_at timestamptz not null default now(), processed_at timestamptz,
 unique(connection_id,external_reservation_id,event_type)
);
create table if not exists public.confirmation_messages (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 reservation_id uuid references public.reservations(id) on delete cascade, channel text not null default 'email',
 recipient text, subject text, body text, status text not null default 'queued' check(status in ('queued','sent','failed')),
 attempts integer not null default 0, last_error text, sent_at timestamptz, created_at timestamptz not null default now()
);
alter table public.channel_sync_queue enable row level security;
alter table public.channel_reservation_events enable row level security;
alter table public.confirmation_messages enable row level security;
create policy if not exists channel_sync_queue_select on public.channel_sync_queue for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists channel_reservation_events_select on public.channel_reservation_events for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy if not exists confirmation_messages_select on public.confirmation_messages for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create or replace function public.fn_queue_channel_sync(p_property_id uuid,p_connection_id uuid,p_event_type text,p_payload jsonb,p_idempotency_key text)
returns public.channel_sync_queue language plpgsql security definer set search_path=public as $$
declare v public.channel_sync_queue;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 insert into public.channel_sync_queue(property_id,connection_id,event_type,payload,idempotency_key)
 values(p_property_id,p_connection_id,p_event_type,coalesce(p_payload,'{}'::jsonb),p_idempotency_key)
 on conflict(idempotency_key) do update set payload=excluded.payload where public.channel_sync_queue.status in ('queued','failed')
 returning * into v; return v;
end; $$;
create or replace function public.fn_receive_channel_reservation(p_property_id uuid,p_connection_id uuid,p_external_reservation_id text,p_event_type text,p_payload jsonb)
returns public.channel_reservation_events language plpgsql security definer set search_path=public as $$
declare v public.channel_reservation_events;
begin
 insert into public.channel_reservation_events(property_id,connection_id,external_reservation_id,event_type,payload)
 values(p_property_id,p_connection_id,p_external_reservation_id,p_event_type,coalesce(p_payload,'{}'::jsonb))
 on conflict(connection_id,external_reservation_id,event_type) do update set payload=excluded.payload
 returning * into v; return v;
end; $$;
create or replace function public.fn_queue_confirmation(p_property_id uuid,p_reservation_id uuid,p_recipient text,p_subject text,p_body text)
returns public.confirmation_messages language plpgsql security definer set search_path=public as $$
declare v public.confirmation_messages;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 insert into public.confirmation_messages(property_id,reservation_id,recipient,subject,body)
 values(p_property_id,p_reservation_id,p_recipient,p_subject,p_body) returning * into v; return v;
end; $$;
grant execute on function public.fn_queue_channel_sync(uuid,uuid,text,jsonb,text) to authenticated;
grant execute on function public.fn_receive_channel_reservation(uuid,uuid,text,text,jsonb) to anon,authenticated;
grant execute on function public.fn_queue_confirmation(uuid,uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';