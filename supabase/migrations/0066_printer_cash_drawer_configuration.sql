-- Optional cash-drawer pulse for configured network thermal printers.
-- Additive only; do not apply to production without the normal migration review.
alter table public.property_printers
  add column if not exists open_drawer_after_sale boolean not null default false;

comment on column public.property_printers.open_drawer_after_sale is
  'When true, send an ESC/POS cash-drawer pulse after a completed cash sale from the POS.';
