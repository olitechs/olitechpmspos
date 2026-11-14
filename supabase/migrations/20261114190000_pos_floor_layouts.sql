-- Shared POS floor configuration. The JSON document intentionally preserves the
-- existing client-generated zone/table keys because open sessions reference
-- those keys in pos_table_sessions.table_key and zone_id.
create table if not exists public.pos_floor_layouts (
  property_id uuid primary key references public.properties(id) on delete cascade,
  zones jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint pos_floor_layouts_zones_array_check
    check (jsonb_typeof(zones) = 'array')
);

comment on table public.pos_floor_layouts is
  'Property-scoped shared POS floor zones and tables; client keys remain stable for existing POS sessions.';

alter table public.pos_floor_layouts enable row level security;

grant select, insert, update, delete on public.pos_floor_layouts to authenticated;

drop policy if exists pos_floor_layouts_member_read on public.pos_floor_layouts;
create policy pos_floor_layouts_member_read
  on public.pos_floor_layouts
  for select
  to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_floor_layouts_authorized_manage on public.pos_floor_layouts;
create policy pos_floor_layouts_authorized_manage
  on public.pos_floor_layouts
  for all
  to authenticated
  using (
    public.is_platform_owner()
    or (
      public.is_member_of_property(property_id)
      and (
        public.property_role(property_id) in ('owner', 'admin', 'manager', 'property_admin')
        or public.current_staff_role(property_id) in ('owner', 'admin', 'manager', 'store_manager', 'front_office_manager', 'super_admin')
      )
    )
  )
  with check (
    public.is_platform_owner()
    or (
      public.is_member_of_property(property_id)
      and (
        public.property_role(property_id) in ('owner', 'admin', 'manager', 'property_admin')
        or public.current_staff_role(property_id) in ('owner', 'admin', 'manager', 'store_manager')
      )
    )
  );

-- Enable cross-terminal updates where the Realtime publication is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'pos_floor_layouts'
     ) then
    alter publication supabase_realtime add table public.pos_floor_layouts;
  end if;
end
$$;
