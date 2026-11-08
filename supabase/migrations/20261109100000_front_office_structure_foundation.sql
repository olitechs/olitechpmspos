-- Front Office Structure foundation: property buildings, floors and room placement.
-- Additive only: existing rooms.floor and room_type_id remain supported.
-- All records remain property-scoped through the existing property_id/RLS contract.

create table if not exists public.property_buildings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, code),
  unique (property_id, name)
);

create table if not exists public.property_floors (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  building_id uuid not null,
  floor_number integer not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, property_id),
  unique (property_id, building_id, floor_number),
  constraint property_floors_building_property_fk
    foreign key (building_id, property_id)
    references public.property_buildings(id, property_id) on delete cascade
);

create index if not exists property_buildings_property_idx
  on public.property_buildings(property_id, active, name);
create index if not exists property_floors_property_idx
  on public.property_floors(property_id, building_id, floor_number);

alter table public.rooms
  add column if not exists building_id uuid,
  add column if not exists floor_id uuid;

-- Preserve the legacy integer floor while giving existing inventory a
-- navigable building/floor hierarchy. Properties without rooms are untouched.
do $$
declare
  p record;
  v_building_id uuid;
  f record;
  v_floor_id uuid;
begin
  for p in
    select distinct property_id from public.rooms
  loop
    select id into v_building_id
      from public.property_buildings
      where property_id = p.property_id and code = 'MAIN'
      limit 1;

    if v_building_id is null then
      insert into public.property_buildings(property_id, code, name, description)
      values (p.property_id, 'MAIN', 'Main Building', 'Default building created for existing room inventory.')
      on conflict (property_id, code) do update set name = excluded.name
      returning id into v_building_id;
    end if;

    update public.rooms
      set building_id = v_building_id
      where property_id = p.property_id and building_id is null;

    for f in
      select distinct floor from public.rooms
      where property_id = p.property_id and floor is not null
    loop
      select id into v_floor_id
        from public.property_floors
        where property_id = p.property_id
          and building_id = v_building_id
          and floor_number = f.floor
        limit 1;

      if v_floor_id is null then
        insert into public.property_floors(property_id, building_id, floor_number, name)
        values (p.property_id, v_building_id, f.floor,
          case when f.floor = 0 then 'Ground Floor' else 'Floor ' || f.floor::text end)
        on conflict (property_id, building_id, floor_number) do update set name = excluded.name
        returning id into v_floor_id;
      end if;

      update public.rooms
        set floor_id = v_floor_id
        where property_id = p.property_id
          and floor = f.floor
          and floor_id is null;
    end loop;
  end loop;
end $$;

-- Composite foreign keys prevent a room from being assigned to another
-- property's building or floor. Nullable columns keep legacy/manual records valid.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_building_property_fk'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_building_property_fk
      foreign key (building_id, property_id)
      references public.property_buildings(id, property_id)
      on delete set null (building_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_floor_property_fk'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_floor_property_fk
      foreign key (floor_id, property_id)
      references public.property_floors(id, property_id)
      on delete set null (floor_id);
  end if;
end $$;

create index if not exists rooms_building_idx on public.rooms(property_id, building_id);
create index if not exists rooms_floor_id_idx on public.rooms(property_id, floor_id);

alter table public.property_buildings enable row level security;
alter table public.property_floors enable row level security;

drop policy if exists property_buildings_select on public.property_buildings;
create policy property_buildings_select on public.property_buildings
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_buildings_insert on public.property_buildings;
create policy property_buildings_insert on public.property_buildings
  for insert with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_buildings_update on public.property_buildings;
create policy property_buildings_update on public.property_buildings
  for update using (public.is_platform_owner() or public.is_member_of_property(property_id))
  with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_buildings_delete on public.property_buildings;
create policy property_buildings_delete on public.property_buildings
  for delete using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists property_floors_select on public.property_floors;
create policy property_floors_select on public.property_floors
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_floors_insert on public.property_floors;
create policy property_floors_insert on public.property_floors
  for insert with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_floors_update on public.property_floors;
create policy property_floors_update on public.property_floors
  for update using (public.is_platform_owner() or public.is_member_of_property(property_id))
  with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_floors_delete on public.property_floors;
create policy property_floors_delete on public.property_floors
  for delete using (public.is_platform_owner() or public.is_member_of_property(property_id));

notify pgrst, 'reload schema';
