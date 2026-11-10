-- Front Office property tags: reusable tags and tenant-safe assignments.
create table if not exists public.property_tags (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#2563EB' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  applies_to text not null check (applies_to in ('guest','room','reservation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, applies_to, name),
  unique(property_id, id)
);

create table if not exists public.property_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  tag_id uuid not null,
  entity_type text not null check (entity_type in ('guest','room','reservation')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint property_tag_assignments_tag_fk
    foreign key (property_id, tag_id)
    references public.property_tags(property_id, id) on delete cascade,
  unique(property_id, tag_id, entity_type, entity_id)
);

create index if not exists property_tags_property_type_idx
  on public.property_tags(property_id, applies_to, name);
create index if not exists property_tag_assignments_entity_idx
  on public.property_tag_assignments(property_id, entity_type, entity_id);
create index if not exists property_tag_assignments_tag_idx
  on public.property_tag_assignments(property_id, tag_id);

alter table public.property_tags enable row level security;
alter table public.property_tag_assignments enable row level security;

create policy property_tags_select on public.property_tags
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
create policy property_tags_insert on public.property_tags
  for insert to authenticated
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager')
  );
create policy property_tags_update on public.property_tags
  for update to authenticated
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager')
  )
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager')
  );
create policy property_tags_delete on public.property_tags
  for delete to authenticated
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager')
  );

create policy property_tag_assignments_select on public.property_tag_assignments
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
create policy property_tag_assignments_insert on public.property_tag_assignments
  for insert to authenticated
  with check (
    (public.is_platform_owner()
      or public.property_role(property_id) in ('owner','admin','manager')
      or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager'))
    and (
      (entity_type = 'guest' and exists (select 1 from public.guests e where e.id = entity_id and e.property_id = property_id))
      or (entity_type = 'room' and exists (select 1 from public.rooms e where e.id = entity_id and e.property_id = property_id))
      or (entity_type = 'reservation' and exists (select 1 from public.reservations e where e.id = entity_id and e.property_id = property_id))
    )
  );
create policy property_tag_assignments_delete on public.property_tag_assignments
  for delete to authenticated
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager')
  );

grant select, insert, update, delete on public.property_tags to authenticated;
grant select, insert, delete on public.property_tag_assignments to authenticated;

notify pgrst, 'reload schema';
