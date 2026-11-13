-- Booking engine public page URL.
-- Adds an optional, property-configured booking page URL that the
-- back-office Booking Engine screen opens instead of the previously
-- hard-coded (non-existent) /booking route.
-- Governance: new forward-only migration; no applied migration renamed.

BEGIN;

ALTER TABLE public.booking_engine_settings
  ADD COLUMN IF NOT EXISTS booking_url text;

COMMENT ON COLUMN public.booking_engine_settings.booking_url IS
  'Public booking page URL opened by the Booking Engine screen; empty until configured.';

-- Re-publish the RPC with booking_url included. Body mirrors the hardened
-- version from 20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql;
-- only the jsonb_build_object gains the booking_url field.
CREATE OR REPLACE FUNCTION public.fn_public_booking_engine_config(p_property_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'property_id', p.id,
    'name', p.name,
    'currency', COALESCE(s.currency, p.currency, 'USD'),
    'terms', s.terms,
    'cancellation_policy', s.cancellation_policy,
    'payment_instructions', s.payment_instructions,
    'booking_url', s.booking_url
  )
  FROM public.properties p
  JOIN public.booking_engine_settings s
    ON s.property_id = p.id
   AND s.enabled IS TRUE
  WHERE p.id = p_property_id
    AND p.status = 'active';
$function$;

REVOKE ALL ON FUNCTION public.fn_public_booking_engine_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_booking_engine_config(uuid) TO anon, authenticated, service_role;

COMMIT;
