-- Forward repair for environments where the printer cash-drawer migration
-- was not applied or the PostgREST schema cache has not picked it up.
-- Safe to re-run; existing printer rows and settings are preserved.
begin;

alter table public.property_printers
  add column if not exists open_drawer_after_sale boolean not null default false;

comment on column public.property_printers.open_drawer_after_sale is
  'When true, send an ESC/POS cash-drawer pulse after a completed cash sale from the POS.';

commit;

-- Refresh PostgREST's schema cache so the Data API recognizes the new column.
notify pgrst, 'reload schema';
