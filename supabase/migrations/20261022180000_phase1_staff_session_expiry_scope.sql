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
        SELECT lower(trim(m)) FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS m
      )
  );
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
      SELECT lower(trim(m))
      FROM unnest(coalesce(st.assigned_modules, ARRAY[]::text[])) AS m
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
      SELECT lower(trim(m))
      FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS m
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
GRANT EXECUTE ON FUNCTION public.current_staff_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_id(uuid) TO authenticated;

COMMIT;
