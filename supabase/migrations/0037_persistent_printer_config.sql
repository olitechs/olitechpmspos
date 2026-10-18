-- OliTechs PMS/POS v2 — persistent POS printer configuration
-- Persists printer routing/configuration per property. Browser/device connection
-- state is intentionally not persisted as CONNECTED.

create table if not exists public.pos_printers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  client_key text not null,
  name text not null,
  connection_type text not null default 'system'
    check (connection_type in ('network','usb','bluetooth','system')),
  host text,
  port text,
  agent_url text,
  purposes jsonb not null default '["receipt"]'::jsonb,
  center text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, client_key)
);

create index if not exists pos_printers_property_idx
  on public.pos_printers(property_id, updated_at desc);

alter table public.pos_printers enable row level security;

drop policy if exists pos_printers_select on public.pos_printers;
create policy pos_printers_select
  on public.pos_printers for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_printers_write on public.pos_printers;
create policy pos_printers_write
  on public.pos_printers for all
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','fb_manager')
  )
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','fb_manager')
  );

create or replace function public.fn_list_pos_printers(
  p_property_id uuid
) returns setof public.pos_printers
language sql
security definer
stable
set search_path = public
as $$
  select *
  from public.pos_printers
  where property_id = p_property_id
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by updated_at desc;
$$;

grant execute on function public.fn_list_pos_printers(uuid) to authenticated;

create or replace function public.fn_upsert_pos_printer(
  p_property_id uuid,
  p_client_key text,
  p_name text,
  p_connection_type text,
  p_host text,
  p_port text,
  p_agent_url text,
  p_purposes jsonb,
  p_center text
) returns public.pos_printers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pos_printers;
begin
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then
    raise exception 'Not allowed.';
  end if;

  if p_connection_type not in ('network','usb','bluetooth','system') then
    raise exception 'Invalid printer connection type.';
  end if;

  insert into public.pos_printers(
    property_id, client_key, name, connection_type, host, port, agent_url,
    purposes, center, updated_at
  ) values (
    p_property_id, p_client_key, coalesce(nullif(trim(p_name),''),'Printer'),
    p_connection_type, nullif(trim(p_host),''), nullif(trim(p_port),''),
    nullif(trim(p_agent_url),''), coalesce(p_purposes,'["receipt"]'::jsonb),
    nullif(trim(p_center),''), now()
  )
  on conflict (property_id, client_key)
  do update set
    name = excluded.name,
    connection_type = excluded.connection_type,
    host = excluded.host,
    port = excluded.port,
    agent_url = excluded.agent_url,
    purposes = excluded.purposes,
    center = excluded.center,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.fn_upsert_pos_printer(
  uuid,text,text,text,text,text,text,jsonb,text
) to authenticated;

create or replace function public.fn_delete_pos_printer(
  p_property_id uuid,
  p_client_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then
    raise exception 'Not allowed.';
  end if;

  delete from public.pos_printers
   where property_id = p_property_id
     and client_key = p_client_key;

  return found;
end;
$$;

grant execute on function public.fn_delete_pos_printer(uuid,text) to authenticated;

notify pgrst, 'reload schema';
