-- Subscription renewal requests are written by the authenticated Edge Function only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_renewal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_email text NOT NULL,
  requester_name text,
  property_name text NOT NULL,
  package_code text,
  subscription_status text,
  period_ends_at timestamptz,
  grace_ends_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending','sent','failed')),
  notification_error text,
  provider_message_id text,
  notification_attempts integer NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_renewal_one_pending_per_property
  ON public.subscription_renewal_requests(property_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS subscription_renewal_requests_requested_at_idx
  ON public.subscription_renewal_requests(requested_at DESC);

ALTER TABLE public.subscription_renewal_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_renewal_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.subscription_renewal_requests TO service_role;

COMMIT;
