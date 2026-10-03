-- OliTechs PMS/POS — multi-transport physical printer support
-- LAN, Windows installed printers (USB/Bluetooth via driver), WebUSB, Web Bluetooth and Web Serial.

alter table public.property_printers
  add column if not exists windows_printer_name text,
  add column if not exists agent_url text default 'http://127.0.0.1:8631',
  add column if not exists baud_rate integer default 9600,
  add column if not exists device_name text,
  add column if not exists device_address text;

alter table public.property_printers
  drop constraint if exists property_printers_direct_connection_check;

alter table public.property_printers
  drop constraint if exists property_printers_connection_type_check;

alter table public.property_printers
  add constraint property_printers_connection_type_check
  check (connection_type in (
    'network_ip',
    'windows_printer',
    'usb',
    'bluetooth',
    'serial'
  ));

alter table public.property_printers
  drop constraint if exists property_printers_baud_rate_check;
alter table public.property_printers
  add constraint property_printers_baud_rate_check
  check (baud_rate is null or baud_rate in (9600,19200,38400,57600,115200));

-- Existing LAN printers remain LAN printers.
update public.property_printers
set agent_url = coalesce(agent_url, 'http://127.0.0.1:8631')
where connection_type = 'network_ip';

create index if not exists property_printers_connection_type_idx
  on public.property_printers(property_id, connection_type);

notify pgrst, 'reload schema';
