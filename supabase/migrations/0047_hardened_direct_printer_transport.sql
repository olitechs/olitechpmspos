-- OliTechs PMS/POS — hardened direct network printing
-- Physical printers are no longer treated as browser/system printers.
-- The platform stores and verifies the real network endpoint and transport state.

alter table public.property_printers
  add column if not exists port integer not null default 9100,
  add column if not exists last_status text not null default 'disconnected',
  add column if not exists last_error text,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_connected_at timestamptz;

alter table public.property_printers
  drop constraint if exists property_printers_port_check;

alter table public.property_printers
  add constraint property_printers_port_check check (port between 1 and 65535);

alter table public.property_printers
  drop constraint if exists property_printers_connection_type_check;

alter table public.property_printers
  add constraint property_printers_connection_type_check
  check (connection_type in ('network_ip','usb','bluetooth'));

-- Prevent the old browser-dialog transport from being configured for new records.
-- Existing records are migrated to disconnected until they are re-tested.
update public.property_printers
set
  connection_type = 'network_ip',
  is_online = false,
  last_status = 'disconnected',
  last_error = case when connection_type = 'system_dialog' then 'Browser/system printing is disabled. Configure a real printer IP and port.' else last_error end
where connection_type = 'system_dialog';

create index if not exists property_printers_status_idx
  on public.property_printers(property_id, last_status, last_tested_at desc);

notify pgrst, 'reload schema';
