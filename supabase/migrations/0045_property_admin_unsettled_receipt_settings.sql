-- OliTechs PMS/POS — property admin unsettled receipt settings
-- Extends property_settings so Property Admin can configure open-bill printing
-- from Admin > Property Settings > Unsettled Receipt Settings.

alter table public.property_settings
  add column if not exists unsettled_receipt_title text not null default 'UNSETTLED RECEIPT';

alter table public.property_settings
  add column if not exists unsettled_receipt_copy_count integer not null default 2;

alter table public.property_settings
  add column if not exists unsettled_receipt_front_office_copy boolean not null default true;

alter table public.property_settings
  drop constraint if exists property_settings_unsettled_receipt_copy_count_check;

alter table public.property_settings
  add constraint property_settings_unsettled_receipt_copy_count_check
  check (unsettled_receipt_copy_count in (1, 2));

notify pgrst, 'reload schema';
