-- Minimal PostgreSQL fixture for the Phase 2 room-inventory trigger migration.
-- Runs only in an ephemeral CI database; contains no production data.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end;
$roles$;

create table public.reservations (
  id uuid primary key,
  property_id uuid not null,
  room_id uuid not null,
  arrival date not null,
  departure date not null,
  status text not null
);

create table public.room_closures (
  id uuid primary key,
  property_id uuid not null,
  room_id uuid not null,
  start_date date not null,
  end_date date not null
);
