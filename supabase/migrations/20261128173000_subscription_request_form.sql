-- Subscription request form: records commercial choices from the owner/admin
-- form and exposes a platform-owner-only inbox through a SECURITY DEFINER RPC.
-- The request table stays service-role only; no tenant RLS is weakened.
BEGIN;

ALTER TABLE public.subscription_renewal_requests
  ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'renewal'
    CHECK (request_kind IN ('subscribe', 'upgrade', 'renewal')),
  ADD COLUMN IF NOT EXISTS requested_package text,
  ADD COLUMN IF NOT EXISTS billing_cycle text
    CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS request_notes text;

CREATE OR REPLACE FUNCTION public.admin_list_subscription_requests()
RETURNS TABLE (
  id uuid,
  property_id uuid,
  property_name text,
  requester_name text,
  requester_email text,
  request_kind text,
  requested_package text,
  billing_cycle text,
  contact_phone text,
  request_notes text,
  subscription_status text,
  period_ends_at timestamptz,
  grace_ends_at timestamptz,
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
    r.property_id,
    r.property_name,
    r.requester_name,
    r.requester_email,
    r.request_kind,
    r.requested_package,
    r.billing_cycle,
    r.contact_phone,
    r.request_notes,
    r.subscription_status,
    r.period_ends_at,
    r.grace_ends_at,
    r.status,
    r.notification_status,
    r.notification_error,
    r.requested_at
  FROM public.subscription_renewal_requests r
  WHERE public.is_platform_owner()
  ORDER BY r.requested_at DESC
  LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_subscription_requests() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_subscription_requests() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
