-- OliTechs PMS/POS — direct platform printer transport schema hardening
-- Keeps printer ownership/configuration in the property database and records real transport health.

alter table public.property_printers
  alter column is_online set default false;

alter table public.property_printers
  add column if not exists port integer not null default 9100,
  add column if not exists last_status text not null default 'disconnected',
  add column if not exists last_error text,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_connected_at timestamptz;

alter table public.property_printers
  drop constraint if exists property_printers_port_check;
alter table public.property_printers
  add constraint property_printers_port_check
  check (port between 1 and 65535);

update public.property_printers
set connection_type = 'network_ip', is_online = false, last_status = 'disconnected'
where connection_type <> 'network_ip';

alter table public.property_printers
  drop constraint if exists property_printers_direct_connection_check;
alter table public.property_printers
  add constraint property_printers_direct_connection_check
  check (connection_type = 'network_ip');

alter table public.property_printers
  drop constraint if exists property_printers_status_check;
alter table public.property_printers
  add constraint property_printers_status_check
  check (last_status in ('connected','offline','failed','testing','disconnected'));

alter table public.printer_assignments
  drop constraint if exists printer_assignments_assignment_type_check;
alter table public.printer_assignments
  add constraint printer_assignments_assignment_type_check
  check (assignment_type in (
    'food_orders','drinks_orders','void_food_orders','void_drinks_orders',
    'unsettled_bills','final_receipts','reports','shift_reports'
  ));

create index if not exists property_printers_transport_status_idx
  on public.property_printers(property_id, is_online, last_status);

notify pgrst, 'reload schema';
