-- OliTechs PMS/POS — company receipt settings + assignment-based printing
create table if not exists public.property_settings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  logo_url text,
  property_name text not null,
  address_line1 text not null,
  address_line2 text not null,
  phone text not null,
  email text not null,
  website text not null,
  kra_pin text not null,
  extra_header_line text not null default '',
  footer_line1 text not null,
  footer_line2 text not null,
  updated_at timestamptz not null default now(),
  unique(property_id)
);

create table if not exists public.property_printers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  type text not null check (type in ('receipt_80mm','kitchen','bar','label')),
  connection_type text not null check (connection_type in ('system_dialog','network_ip','usb','bluetooth')),
  ip_address text,
  paper_width text not null default '80mm' check (paper_width in ('80mm','58mm')),
  is_online boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.printer_assignments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  printer_id uuid not null references public.property_printers(id) on delete cascade,
  assignment_type text not null check (assignment_type in ('food_orders','drinks_orders','unsettled_bills','final_receipts','reports')),
  created_at timestamptz not null default now(),
  unique(printer_id, assignment_type)
);

create table if not exists public.print_logs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  printer_id uuid references public.property_printers(id) on delete set null,
  job_type text not null,
  copy_type text,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists property_printers_property_idx on public.property_printers(property_id, created_at desc);
create index if not exists printer_assignments_property_idx on public.printer_assignments(property_id, assignment_type);
create index if not exists print_logs_property_idx on public.print_logs(property_id, created_at desc);

alter table public.property_settings enable row level security;
alter table public.property_printers enable row level security;
alter table public.printer_assignments enable row level security;
alter table public.print_logs enable row level security;

drop policy if exists property_settings_select on public.property_settings;
create policy property_settings_select on public.property_settings for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists property_settings_write on public.property_settings;
create policy property_settings_write on public.property_settings for all
using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin')
)
with check (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin')
);

drop policy if exists property_printers_select on public.property_printers;
create policy property_printers_select on public.property_printers for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists property_printers_write on public.property_printers;
create policy property_printers_write on public.property_printers for all
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

drop policy if exists printer_assignments_select on public.printer_assignments;
create policy printer_assignments_select on public.printer_assignments for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists printer_assignments_write on public.printer_assignments;
create policy printer_assignments_write on public.printer_assignments for all
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

drop policy if exists print_logs_select on public.print_logs;
create policy print_logs_select on public.print_logs for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists print_logs_insert on public.print_logs;
create policy print_logs_insert on public.print_logs for insert
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

-- The logo bucket is public for receipt rendering; writes remain property-scoped.
insert into storage.buckets (id, name, public)
values ('property-logos', 'property-logos', true)
on conflict (id) do update set public = true;

drop policy if exists property_logos_read on storage.objects;
create policy property_logos_read on storage.objects for select
using (bucket_id = 'property-logos');

drop policy if exists property_logos_insert on storage.objects;
create policy property_logos_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-logos'
  and (storage.foldername(name))[1] is not null
  and (
    public.is_platform_owner()
    or public.property_role(((storage.foldername(name))[1])::uuid) in ('owner','admin','manager')
    or public.current_staff_role(((storage.foldername(name))[1])::uuid) in ('hotel_admin','super_admin')
  )
);

drop policy if exists property_logos_update on storage.objects;
create policy property_logos_update on storage.objects for update to authenticated
using (
  bucket_id = 'property-logos'
  and (
    public.is_platform_owner()
    or public.property_role(((storage.foldername(name))[1])::uuid) in ('owner','admin','manager')
    or public.current_staff_role(((storage.foldername(name))[1])::uuid) in ('hotel_admin','super_admin')
  )
)
with check (
  bucket_id = 'property-logos'
);

notify pgrst, 'reload schema';
