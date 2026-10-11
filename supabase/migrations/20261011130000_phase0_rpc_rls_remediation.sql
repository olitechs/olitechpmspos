-- Phase 0 forward-only remediation for confirmed RPC/RLS authorization defects.
-- Never rewrite historical migration versions. Apply first to a disposable database,
-- run two-tenant negative/positive tests, and only then schedule production rollout.

CREATE OR REPLACE FUNCTION public.create_pending_property_for_user(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_business_name text DEFAULT NULL
)
RETURNS public.properties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_property public.properties;
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'A user may only create or retrieve their own pending property.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_property
  FROM public.properties p
  JOIN public.property_users pu ON pu.property_id = p.id
  WHERE pu.user_id = auth.uid() AND pu.role = 'owner'
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_property;
  END IF;

  v_name := COALESCE(
    NULLIF(trim(p_business_name), ''),
    NULLIF(trim(p_full_name), '') || '''s Property',
    'New Property'
  );

  INSERT INTO public.properties
    (name, business_name, created_by, email, contact_person, status, package)
  VALUES
    (v_name, NULLIF(trim(p_business_name), ''), auth.uid(),
     NULLIF(trim(p_email), ''), NULLIF(trim(p_full_name), ''), 'pending', 'none')
  RETURNING * INTO v_property;

  INSERT INTO public.property_users (property_id, user_id, role)
  VALUES (v_property.id, auth.uid(), 'owner');

  RETURN v_property;
EXCEPTION
  WHEN unique_violation THEN
    SELECT p.* INTO v_property
    FROM public.properties p
    JOIN public.property_users pu ON pu.property_id = p.id
    WHERE pu.user_id = auth.uid() AND pu.role = 'owner'
    ORDER BY p.created_at DESC
    LIMIT 1;
    IF FOUND THEN RETURN v_property; END IF;
    RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_list_pos_menu(p_property_id uuid)
RETURNS TABLE(
  id uuid, sku text, name text, category text, unit text,
  current_stock numeric, min_stock numeric, selling_price numeric,
  production_center text, pos_sort integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, p.sku, p.name, COALESCE(NULLIF(p.pos_category, ''), p.category),
         p.unit, p.current_stock, p.min_stock, p.selling_price,
         p.production_center, p.pos_sort
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND p.pos_enabled = true
    AND p.pos_active = true
    AND (
      public.is_platform_owner()
      OR public.is_member_of_property(p_property_id)
      OR public.current_staff_role(p_property_id) IS NOT NULL
    )
  ORDER BY COALESCE(NULLIF(p.pos_category, ''), p.category), p.pos_sort, p.name;
$function$;

CREATE OR REPLACE FUNCTION public.fn_current_pos_shift(p_property_id uuid)
RETURNS public.pos_shifts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.*
  FROM public.pos_shifts s
  WHERE s.property_id = p_property_id
    AND s.status = 'open'
    AND s.date = (now() AT TIME ZONE 'Africa/Nairobi')::date
    AND (
      public.is_platform_owner()
      OR public.is_member_of_property(p_property_id)
      OR public.current_staff_role(p_property_id) IS NOT NULL
    )
  ORDER BY s.opened_at DESC
  LIMIT 1;
$function$;

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
    'currency', COALESCE(s.currency, 'USD'),
    'terms', s.terms,
    'cancellation_policy', s.cancellation_policy,
    'payment_instructions', s.payment_instructions
  )
  FROM public.properties p
  JOIN public.booking_engine_settings s
    ON s.property_id = p.id
   AND s.enabled IS TRUE
  WHERE p.id = p_property_id
    AND p.status = 'active';
$function$;

-- Keep sensitive entitlement fields immutable for property owners/admins.
-- Platform owners retain the existing ability to change status/package.
CREATE OR REPLACE FUNCTION public.guard_property_entitlement_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_platform_owner()
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.package IS DISTINCT FROM OLD.package) THEN
    RAISE EXCEPTION 'Only a platform owner may change property status or package.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_property_entitlement_updates ON public.properties;
CREATE TRIGGER guard_property_entitlement_updates
BEFORE UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.guard_property_entitlement_updates();

DROP POLICY IF EXISTS properties_update_owner_admin ON public.properties;
CREATE POLICY properties_update_owner_admin
ON public.properties
FOR UPDATE
USING (
  public.is_platform_owner()
  OR public.property_role(id) = ANY (ARRAY['owner'::public.property_member_role, 'admin'::public.property_member_role])
)
WITH CHECK (
  public.is_platform_owner()
  OR public.property_role(id) = ANY (ARRAY['owner'::public.property_member_role, 'admin'::public.property_member_role])
);

-- RPCs that return tenant-specific data or mutate a user's own property are
-- never executable by anon/public callers.
REVOKE ALL ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_list_pos_menu(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_list_pos_menu(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_current_pos_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_pos_shift(uuid) TO authenticated, service_role;

-- This is intentionally public-facing, but only for active properties whose
-- booking engine is enabled; disabled or inactive properties return no row.
REVOKE ALL ON FUNCTION public.fn_public_booking_engine_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_booking_engine_config(uuid) TO anon, authenticated, service_role;
