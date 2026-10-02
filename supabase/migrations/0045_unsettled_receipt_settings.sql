-- OliTechs PMS/POS — property-level unsettled receipt configuration
alter table public.property_settings
  add column if not exists unsettled_receipt_title text not null default 'UNSETTLED RECEIPT',
  add column if not exists unsettled_receipt_copy_count integer not null default 2 check (unsettled_receipt_copy_count in (1,2)),
  add column if not exists unsettled_receipt_front_office_copy boolean not null default true;

notify pgrst, 'reload schema';
