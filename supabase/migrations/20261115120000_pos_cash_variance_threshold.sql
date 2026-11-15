-- Manager approval for a cash variance at shift close was a hardcoded KES 500
-- in the POS close-shift dialog. Properties need their own tolerance, so it is
-- stored on property_settings next to the other POS printing/operation policy.
--
-- Additive and defaulted: existing rows keep the historical KES 500 behaviour
-- and the frontend falls back to 500 when the column is absent, so this
-- migration must still be applied before the frontend that edits it is
-- deployed.

alter table public.property_settings
  add column if not exists pos_cash_variance_threshold numeric(12,2) not null default 500;

alter table public.property_settings
  drop constraint if exists property_settings_pos_cash_variance_threshold_check;

alter table public.property_settings
  add constraint property_settings_pos_cash_variance_threshold_check
  check (pos_cash_variance_threshold >= 0);

notify pgrst, 'reload schema';
