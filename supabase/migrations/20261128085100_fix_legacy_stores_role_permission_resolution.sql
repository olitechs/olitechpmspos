-- Preserve legacy Stores manager role permissions when a stale linked role template
-- (for example, Cashier) conflicts with the staff row's built-in operational role.
-- The resolver still enforces authentication, property membership, assigned workspace,
-- permission catalog membership and temporary grants.

CREATE OR REPLACE FUNCTION public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
  v_current_staff_id uuid;
  v_has_property_access boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  v_current_staff_id := public.current_staff_id(p_property_id);
  v_has_property_access :=
    public.is_platform_owner()
    OR public.is_member_of_property(p_property_id)
    OR (
      p_staff_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.staff s
        WHERE s.property_id = p_property_id
          AND s.is_active = true
          AND (
            s.id = v_current_staff_id
            OR (
              v_current_staff_id IS NULL
              AND s.user_id = auth.uid()
            )
          )
      )
    );

  IF NOT v_has_property_access THEN
    RETURN '{}'::text[];
  END IF;

  IF public.is_platform_owner() OR public.property_role(p_property_id) IN ('owner','admin') THEN
    RETURN ARRAY(SELECT code FROM public.employee_permission_codes ORDER BY sort_order);
  END IF;

  SELECT s.* INTO v_staff
  FROM public.staff s
  WHERE s.property_id = p_property_id
    AND s.is_active = true
    AND (
      s.id = COALESCE(p_staff_id, v_current_staff_id)
      OR (
        p_staff_id IS NULL
        AND v_current_staff_id IS NULL
        AND s.user_id = auth.uid()
      )
    )
  LIMIT 1;

  IF v_staff.id IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  v_assigned := COALESCE(v_staff.assigned_modules, '{}'::text[]);

  -- Built-in operational roles take precedence over stale linked role templates.
  -- Do not expand assigned_modules or bypass the property/module checks above.
  IF v_staff.role_id IS NOT NULL
     AND LOWER(COALESCE(v_staff.role, '')) NOT IN (
       'super_admin', 'hotel_admin', 'store_manager', 'storekeeper', 'store_keeper'
     ) THEN
    SELECT COALESCE(r.permission_codes, '{}'::text[]) INTO v_role_codes
    FROM public.employee_roles r
    WHERE r.id = v_staff.role_id
      AND r.property_id = p_property_id;
    IF NOT FOUND THEN
      v_role_codes := '{}'::text[];
    END IF;
  ELSE
    v_role_codes := CASE LOWER(COALESCE(v_staff.role, ''))
      WHEN 'super_admin' THEN ARRAY(SELECT code FROM public.employee_permission_codes)
      WHEN 'hotel_admin' THEN ARRAY(SELECT code FROM public.employee_permission_codes)
      WHEN 'front_office_manager' THEN ARRAY['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      WHEN 'receptionist' THEN ARRAY['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment','pos.access']
      WHEN 'front_desk' THEN ARRAY['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','pos.access']
      WHEN 'pos_staff' THEN ARRAY['pos.access','pos.open_shift','pos.process_sale']
      WHEN 'waiter' THEN ARRAY['pos.access','pos.open_shift','pos.process_sale']
      WHEN 'cashier' THEN ARRAY['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      WHEN 'store_manager' THEN ARRAY['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      WHEN 'storekeeper' THEN ARRAY['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      WHEN 'store_keeper' THEN ARRAY['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      WHEN 'fb_manager' THEN ARRAY['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      WHEN 'housekeeping_supervisor' THEN ARRAY['front_office.access']
      ELSE '{}'::text[]
    END;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c.code), '{}'::text[]) INTO v_codes
  FROM public.employee_permission_codes c
  WHERE c.code = ANY(COALESCE(v_role_codes, '{}'::text[]))
    AND c.workspace = ANY(v_assigned);

  SELECT COALESCE(array_agg(DISTINCT g.permission_code), '{}'::text[]) INTO v_grant_codes
  FROM public.module_access_grants g
  JOIN public.employee_permission_codes c ON c.code = g.permission_code
  WHERE g.property_id = p_property_id
    AND g.staff_id = v_staff.id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
    AND c.workspace = ANY(v_assigned);

  RETURN (
    SELECT COALESCE(array_agg(DISTINCT x.code), '{}'::text[])
    FROM unnest(COALESCE(v_codes, '{}'::text[]) || COALESCE(v_grant_codes, '{}'::text[])) AS x(code)
  );
END;
$function$;
