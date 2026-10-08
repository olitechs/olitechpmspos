-- Phase 2 PMS realtime: make operational room/reservation changes visible without manual refresh.
-- Only add tables that exist to the Supabase realtime publication.
DO $$
BEGIN
  IF to_regclass('public.rooms') IS NOT NULL THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF to_regclass('public.reservations') IS NOT NULL THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF to_regclass('public.guests') IS NOT NULL THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.guests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
