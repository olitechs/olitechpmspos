-- Public homepage demo requests: anonymous enquiries are written by the
-- Edge Function only. No tenant RLS is weakened and the table is never
-- readable or writable by anon/authenticated clients.
BEGIN;

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  property_name text NOT NULL,
  contact_phone text,
  requested_package text CHECK (requested_package IS NULL OR requested_package IN ('starter','standard','professional','enterprise')),
  billing_cycle text CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual')),
  request_notes text,
  source text NOT NULL DEFAULT 'homepage' CHECK (source IN ('homepage','other')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','closed')),
  notification_status text NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending','sent','failed')),
  notification_error text,
  provider_message_id text,
  notification_attempts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS demo_requests_requested_at_idx
  ON public.demo_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_email_pending_idx
  ON public.demo_requests(requester_email, status, requested_at DESC);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.demo_requests TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_demo_requests()
RETURNS TABLE (
  id uuid,
  requester_name text,
  requester_email text,
  property_name text,
  contact_phone text,
  requested_package text,
  billing_cycle text,
  request_notes text,
  source text,
  status text,
  notification_status text,
  notification_error text,
  requested_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.id,
    r.requester_name,
    r.requester_email,
    r.property_name,
    r.contact_phone,
    r.requested_package,
    r.billing_cycle,
    r.request_notes,
    r.source,
    r.status,
    r.notification_status,
    r.notification_error,
    r.requested_at
  FROM public.demo_requests r
  WHERE public.is_platform_owner()
  ORDER BY r.requested_at DESC
  LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_demo_requests() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_demo_requests() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
