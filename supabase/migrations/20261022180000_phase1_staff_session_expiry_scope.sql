-- Candidate forward-only Phase 1 remediation.
-- Additive only: legacy sessions without a module are intentionally invalidated
-- and must re-authenticate with their PIN. Do not apply to production until the
-- schema-equivalent isolated regression matrix passes.
BEGIN;

ALTER TABLE public.staff_sessions
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS hard_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Existing rows have no reliable module scope. Expire them rather than guessing
-- a module or carrying forward a potentially over-privileged session.
UPDATE public.staff_sessions
SET expires_at = COALESCE(expires_at, verified_at),
    hard_expires_at = COALESCE(hard_expires_at, verified_at),
    revoked_at = COALESCE(revoked_at, now())
WHERE module IS NULL
   OR expires_at IS NULL
   OR hard_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_sessions_active_property_idx
  ON public.staff_sessions(property_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_staff_session_allows_module(
  p_property_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_sessions ss
    JOIN public.staff s ON s.id = ss.staff_id
    JOIN public.properties p ON p.id = ss.property_id
    WHERE ss.user_id = auth.uid()
      AND ss.property_id = p_property_id
      AND lower(ss.module) = lower(trim(coalesce(p_module, '')))
      AND ss.revoked_at IS NULL
      AND ss.expires_at > now()
      AND ss.hard_expires_at > now()
      AND s.is_active IS TRUE
      AND s.property_id = ss.property_id
      AND p.status = 'active'
      AND lower(trim(coalesce(p_module, ''))) = ANY (
        SELECT lower(trim(module_name)) FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
      )
  );
$function$;


-- Module authorization must bind a PIN-selected staff identity to the module
-- stored in that same server-side session. Keep membership-only property-admin
-- access separate from staff-PIN access.
CREATE OR REPLACE FUNCTION public.fn_staff_module_access(
  p_property_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
  v_assigned text[];
  v_module text := lower(trim(coalesce(p_module, '')));
  v_has_session boolean;
BEGIN
  IF public.is_platform_owner() THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_member_of_property(p_property_id) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = p_property_id AND p.status = 'active' AND p.package <> 'none'
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_sessions ss
    WHERE ss.user_id = auth.uid()
  ) INTO v_has_session;

  IF v_has_session THEN
    IF NOT public.fn_staff_session_allows_module(p_property_id, v_module) THEN
      RETURN false;
    END IF;
    SELECT s.role, s.assigned_modules
      INTO v_role, v_assigned
    FROM public.staff_sessions ss
    JOIN public.staff s ON s.id = ss.staff_id
    WHERE ss.user_id = auth.uid()
      AND ss.property_id = p_property_id
      AND ss.revoked_at IS NULL
      AND ss.expires_at > now()
      AND ss.hard_expires_at > now()
      AND s.is_active IS TRUE
      AND s.property_id = p_property_id
    LIMIT 1;
    IF v_role IS NULL THEN
      RETURN false;
    END IF;
    IF v_role IN ('super_admin', 'hotel_admin') THEN
      RETURN true;
    END IF;
    IF coalesce(array_length(v_assigned, 1), 0) > 0 THEN
      RETURN v_module = ANY (
        SELECT lower(trim(module_name))
        FROM unnest(v_assigned) AS assigned(module_name)
      );
    END IF;
    RETURN CASE v_role
      WHEN 'front_office_manager' THEN v_module = 'frontoffice'
      WHEN 'receptionist' THEN v_module IN ('frontoffice', 'pos')
      WHEN 'front_desk' THEN v_module IN ('frontoffice', 'pos')
      WHEN 'pos_staff' THEN v_module = 'pos'
      WHEN 'waiter' THEN v_module = 'pos'
      WHEN 'cashier' THEN v_module = 'pos'
      WHEN 'store_manager' THEN v_module = 'store'
      WHEN 'fb_manager' THEN v_module IN ('pos', 'store')
      WHEN 'housekeeping_supervisor' THEN v_module = 'frontoffice'
      ELSE false
    END;
  END IF;

  -- A staff account without a current PIN session must not inherit permissions
  -- from the legacy staff.user_id mapping. Property membership remains a
  -- separate authority for non-staff property users.
  IF EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.user_id = auth.uid()
      AND s.property_id = p_property_id
      AND s.is_active IS TRUE
  ) THEN
    RETURN false;
  END IF;

  RETURN v_module IN ('backoffice', 'frontoffice', 'pos', 'store')
    AND public.property_role(p_property_id) IN ('owner', 'admin', 'manager', 'reception', 'housekeeping');
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_role(p_property_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.role
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  JOIN public.properties p ON p.id = ss.property_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND ss.module IS NOT NULL
    AND ss.revoked_at IS NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND p.status = 'active'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_id(p_property_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.id
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  JOIN public.properties p ON p.id = ss.property_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND ss.module IS NOT NULL
    AND ss.revoked_at IS NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND p.status = 'active'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  p_property_id uuid,
  p_module text,
  p_pin_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.staff;
  v_module text := lower(trim(coalesce(p_module, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_member_of_property(p_property_id) OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_module NOT IN ('frontoffice', 'pos', 'backoffice', 'store') THEN
    RAISE EXCEPTION 'Invalid module.' USING ERRCODE = '22023';
  END IF;

  SELECT st.* INTO s
  FROM public.staff st
  WHERE st.property_id = p_property_id
    AND st.is_active IS TRUE
    AND lower(v_module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(st.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    )
    AND st.pin_hash = p_pin_hash
  ORDER BY st.id
  LIMIT 1;

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  END IF;

  UPDATE public.staff
  SET last_login = now(), updated_at = now()
  WHERE id = s.id;

  INSERT INTO public.staff_sessions
    (user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at)
  VALUES
    (auth.uid(), s.id, s.property_id, now(), v_module, now() + interval '30 minutes',
     now() + interval '8 hours', NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET staff_id = EXCLUDED.staff_id,
      property_id = EXCLUDED.property_id,
      verified_at = EXCLUDED.verified_at,
      module = EXCLUDED.module,
      expires_at = EXCLUDED.expires_at,
      hard_expires_at = EXCLUDED.hard_expires_at,
      revoked_at = NULL;

  INSERT INTO public.staff_logs(property_id, staff_id, staff_name, module, action)
  VALUES (s.property_id, s.id, s.full_name, v_module, 'module_entry');

  RETURN jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'email', s.email,
      'role', s.role, 'assigned_modules', s.assigned_modules, 'avatar', s.avatar
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_active_staff_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.staff_sessions ss
  SET expires_at = LEAST(now() + interval '30 minutes', ss.hard_expires_at),
      verified_at = now()
  FROM public.staff s, public.properties p
  WHERE ss.user_id = auth.uid()
    AND ss.staff_id = s.id
    AND ss.property_id = p.id
    AND ss.revoked_at IS NULL
    AND ss.module IS NOT NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND s.property_id = ss.property_id
    AND p.status = 'active'
    AND lower(ss.module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_active_staff_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.staff_sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      expires_at = LEAST(COALESCE(expires_at, now()), now())
  WHERE user_id = auth.uid();

  RETURN true;
END;
$function$;

-- Ensure only authenticated callers can establish, refresh, or revoke their
-- own staff session. Internal helpers are callable by authenticated policies.
REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.touch_active_staff_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_active_staff_session() TO authenticated;
REVOKE ALL ON FUNCTION public.clear_active_staff_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_active_staff_session() TO authenticated;
REVOKE ALL ON FUNCTION public.fn_staff_session_allows_module(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_session_allows_module(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_staff_module_access(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_staff_module_access(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.current_staff_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_staff_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_id(uuid) TO authenticated;

COMMIT;
