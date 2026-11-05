-- Property-scoped settings for the unsettled bill thermal receipt only.
-- Receipt staff can read the settings needed to render a bill; only property
-- owners/admins can change them. No order or settled-receipt schema is changed.
create table if not exists public.property_unsettled_receipt_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  show_vat boolean not null default false,
  vat_rate numeric(6,3) not null default 16 check (vat_rate >= 0 and vat_rate <= 100),
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive','inclusive')),
  paper_width text not null default '80mm' check (paper_width in ('80mm','58mm')),
  feed_lines smallint not null default 5 check (feed_lines between 4 and 6),
  updated_at timestamptz not null default now()
);

alter table public.property_unsettled_receipt_settings enable row level security;

drop policy if exists unsettled_receipt_settings_select on public.property_unsettled_receipt_settings;
create policy unsettled_receipt_settings_select on public.property_unsettled_receipt_settings
for select to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists unsettled_receipt_settings_write on public.property_unsettled_receipt_settings;
create policy unsettled_receipt_settings_write on public.property_unsettled_receipt_settings
for all to authenticated
using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','admin')
)
with check (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','admin')
);

notify pgrst, 'reload schema';
