-- POS terminal registry: property-scoped device metadata and enable/disable controls.
-- This does not claim live device presence; heartbeat enforcement belongs to POS runtime integration.
create table if not exists public.pos_devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  terminal_code text not null check (terminal_code ~ '^[A-Z0-9_-]{2,32}$'),
  device_type text not null default 'desktop' check (device_type in ('desktop','tablet','mobile','kiosk')),
  status text not null default 'active' check (status in ('active','disabled')),
  notes text check (notes is null or char_length(notes) <= 500),
  last_seen_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_devices_property_terminal_code_unique unique(property_id, terminal_code)
);

create index if not exists pos_devices_property_store_idx
  on public.pos_devices(property_id, store_id, status);

create or replace function public.fn_guard_pos_device_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if not exists (
    select 1 from public.stores s
    where s.id = new.store_id
      and s.property_id = new.property_id
      and s.workspace_id = new.workspace_id
  ) then
    raise exception 'POS terminal store, workspace and property must match.'
      using errcode = '23514';
  end if;
  new.terminal_code := upper(btrim(new.terminal_code));
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pos_devices_tenant_guard on public.pos_devices;
create trigger pos_devices_tenant_guard
before insert or update on public.pos_devices
for each row execute function public.fn_guard_pos_device_tenant();

alter table public.pos_devices enable row level security;
drop policy if exists pos_devices_select on public.pos_devices;
create policy pos_devices_select on public.pos_devices for select to authenticated
using (
  (public.is_member_of_property(property_id)
    and exists (select 1 from public.stores s where s.id=pos_devices.store_id and s.property_id=pos_devices.property_id))
  or exists (select 1 from public.workspace_members wm where wm.workspace_id=pos_devices.workspace_id and wm.user_id=auth.uid())
  or exists (select 1 from public.store_members sm where sm.store_id=pos_devices.store_id and sm.user_id=auth.uid())
);

drop policy if exists pos_devices_insert on public.pos_devices;
create policy pos_devices_insert on public.pos_devices for insert to authenticated
with check (
  (
  public.is_platform_owner()
  or (
    public.is_member_of_property(property_id)
    and (
      public.property_role(property_id) in ('owner','admin','manager')
      or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
    )
  )
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=pos_devices.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id=pos_devices.store_id and sm.user_id=auth.uid() and lower(sm.role) in ('owner','admin','manager')
  )
)
);

drop policy if exists pos_devices_update on public.pos_devices;
create policy pos_devices_update on public.pos_devices for update to authenticated
using (
  (
  public.is_platform_owner()
  or (
    public.is_member_of_property(property_id)
    and (
      public.property_role(property_id) in ('owner','admin','manager')
      or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
    )
  )
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=pos_devices.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id=pos_devices.store_id and sm.user_id=auth.uid() and lower(sm.role) in ('owner','admin','manager')
  )
)
)
with check (
  (
  public.is_platform_owner()
  or (
    public.is_member_of_property(property_id)
    and (
      public.property_role(property_id) in ('owner','admin','manager')
      or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
    )
  )
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=pos_devices.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id=pos_devices.store_id and sm.user_id=auth.uid() and lower(sm.role) in ('owner','admin','manager')
  )
)
);

drop policy if exists pos_devices_delete on public.pos_devices;
create policy pos_devices_delete on public.pos_devices for delete to authenticated
using (
  (
  public.is_platform_owner()
  or (
    public.is_member_of_property(property_id)
    and (
      public.property_role(property_id) in ('owner','admin','manager')
      or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
    )
  )
  or exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=pos_devices.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')
  )
  or exists (
    select 1 from public.store_members sm
    where sm.store_id=pos_devices.store_id and sm.user_id=auth.uid() and lower(sm.role) in ('owner','admin','manager')
  )
)
);

grant select, insert, update, delete on public.pos_devices to authenticated;
revoke all on function public.fn_guard_pos_device_tenant() from public, anon, authenticated;
notify pgrst, 'reload schema';
