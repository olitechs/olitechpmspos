-- Phase 1 Stores: backfill settings, cost centres and department locations for
-- every existing property. Idempotent; safe to re-run.

BEGIN;

INSERT INTO public.stores_settings(property_id)
SELECT p.id
FROM public.properties p
ON CONFLICT (property_id) DO NOTHING;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.properties ORDER BY created_at
  LOOP
    PERFORM stock_internal.fn_stores_ensure_settings(r.id);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
