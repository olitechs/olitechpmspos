-- OliTechs PMS/POS — serial / Bluetooth SPP thermal printer support
-- Extends printer configuration for USB-serial and Bluetooth Classic/SPP
-- devices exposed by the browser as a serial port.

alter table public.pos_printers
  add column if not exists baud_rate integer not null default 9600;

alter table public.pos_printers
  drop constraint if exists pos_printers_connection_type_check;

alter table public.pos_printers
  add constraint pos_printers_connection_type_check
  check (connection_type in ('network','usb','bluetooth','serial','system'));

drop function if exists public.fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text);

create or replace function public.fn_upsert_pos_printer(
  p_property_id uuid,
  p_client_key text,
  p_name text,
  p_connection_type text,
  p_host text,
  p_port text,
  p_agent_url text,
  p_purposes jsonb,
  p_center text,
  p_baud_rate integer default 9600
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

  if p_connection_type not in ('network','usb','bluetooth','serial','system') then
    raise exception 'Invalid printer connection type.';
  end if;

  if coalesce(p_baud_rate, 9600) not in (1200,2400,4800,9600,19200,38400,57600,115200) then
    raise exception 'Invalid serial baud rate.';
  end if;

  insert into public.pos_printers(
    property_id, client_key, name, connection_type, host, port, agent_url,
    purposes, center, baud_rate, updated_at
  ) values (
    p_property_id, p_client_key, coalesce(nullif(trim(p_name),''),'Printer'),
    p_connection_type, nullif(trim(p_host),''), nullif(trim(p_port),''),
    nullif(trim(p_agent_url),''), coalesce(p_purposes,'["receipt"]'::jsonb),
    nullif(trim(p_center),''), coalesce(p_baud_rate,9600), now()
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
    baud_rate = excluded.baud_rate,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.fn_upsert_pos_printer(
  uuid,text,text,text,text,text,text,jsonb,text,integer
) to authenticated;

notify pgrst, 'reload schema';
