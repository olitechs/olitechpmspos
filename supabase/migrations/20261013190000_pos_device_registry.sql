-- Property-scoped POS terminal registry for the currently deployed schema.
-- Store/outlet is a label because the live database does not yet contain the newer stores/workspaces model.
create table if not exists public.pos_devices (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  terminal_code text not null check (terminal_code ~ '^[A-Z0-9_-]{2,32}$'),
  store_name text not null default 'Main Store' check (char_length(btrim(store_name)) between 1 and 100),
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
  on public.pos_devices(property_id, store_name, status);

create or replace function public.fn_normalize_pos_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.terminal_code := upper(btrim(new.terminal_code));
  new.name := btrim(new.name);
  new.store_name := btrim(new.store_name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pos_devices_normalize on public.pos_devices;
create trigger pos_devices_normalize
before insert or update on public.pos_devices
for each row execute function public.fn_normalize_pos_device();

alter table public.pos_devices enable row level security;
drop policy if exists pos_devices_select on public.pos_devices;
create policy pos_devices_select on public.pos_devices for select to authenticated
using (public.is_member_of_property(property_id));

drop policy if exists pos_devices_insert on public.pos_devices;
create policy pos_devices_insert on public.pos_devices for insert to authenticated
with check (
  public.is_member_of_property(property_id)
  and (
    public.is_hotel_admin(property_id)
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
  )
);

drop policy if exists pos_devices_update on public.pos_devices;
create policy pos_devices_update on public.pos_devices for update to authenticated
using (
  public.is_member_of_property(property_id)
  and (
    public.is_hotel_admin(property_id)
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
  )
)
with check (
  public.is_member_of_property(property_id)
  and (
    public.is_hotel_admin(property_id)
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
  )
);

drop policy if exists pos_devices_delete on public.pos_devices;
create policy pos_devices_delete on public.pos_devices for delete to authenticated
using (
  public.is_member_of_property(property_id)
  and (
    public.is_hotel_admin(property_id)
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','store_manager','fb_manager')
  )
);

grant select, insert, update, delete on public.pos_devices to authenticated;
revoke all on function public.fn_normalize_pos_device() from public, anon, authenticated;
notify pgrst, 'reload schema';
