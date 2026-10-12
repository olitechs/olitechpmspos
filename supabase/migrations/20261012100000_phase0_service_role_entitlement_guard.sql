-- Phase 0 follow-up: allow the trusted Supabase service_role to perform
-- server-side entitlement updates while keeping tenant roles restricted.
-- This does not grant service_role to client users; never expose a service-role
-- key in a browser/mobile client.
--
-- PostgREST sets the effective database role to service_role for requests
-- authenticated with the service-role key. Check current_user rather than
-- auth.role(): auth.role() is a JWT claim and is not the database privilege
-- boundary for privileged SQL execution.

CREATE OR REPLACE FUNCTION public.guard_property_entitlement_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_platform_owner()
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.package IS DISTINCT FROM OLD.package) THEN
    RAISE EXCEPTION 'Only a platform owner or trusted database service may change property status or package.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Introspection-only checks for a disposable validation run:
-- SELECT pg_get_functiondef('public.guard_property_entitlement_updates()'::regprocedure);
-- SELECT tgname, tgenabled FROM pg_trigger
-- WHERE tgrelid = 'public.properties'::regclass AND NOT tgisinternal
--   AND tgname = 'guard_property_entitlement_updates';
