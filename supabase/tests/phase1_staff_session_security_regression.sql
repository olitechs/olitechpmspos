-- Phase 1 staff-session security regression harness.
-- RUN ONLY on a schema-equivalent isolated database with two seeded properties.
-- Fixture mutations are rolled back. Never run against production.
BEGIN;

DO $seed$
DECLARE
  v_user_a uuid;
  v_property_a uuid;
  v_staff_id uuid;
  v_module text;
  v_user_b uuid;
BEGIN
  SELECT pu.user_id, pu.property_id
    INTO v_user_a, v_property_a
  FROM public.property_users pu
  JOIN public.properties p ON p.id = pu.property_id
  JOIN public.staff s ON s.property_id = pu.property_id AND s.is_active IS TRUE
  WHERE p.status = 'active'
    AND p.package <> 'none'
    AND coalesce(array_length(s.assigned_modules, 1), 0) > 0
  ORDER BY pu.created_at
  LIMIT 1;

  SELECT pu.user_id
    INTO v_user_b
  FROM public.property_users pu
  JOIN public.properties p ON p.id = pu.property_id
  WHERE p.status = 'active'
    AND pu.user_id IS DISTINCT FROM v_user_a
    AND pu.property_id IS DISTINCT FROM v_property_a
  ORDER BY pu.created_at
  LIMIT 1;

  SELECT s.id,
         (SELECT lower(trim(x))
          FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(x)
          WHERE lower(trim(x)) IN ('frontoffice', 'pos', 'backoffice', 'store')
          ORDER BY lower(trim(x))
          LIMIT 1)
    INTO v_staff_id, v_module
  FROM public.staff s
  WHERE s.property_id = v_property_a
    AND s.is_active IS TRUE
    AND coalesce(array_length(s.assigned_modules, 1), 0) > 0
  ORDER BY s.id
  LIMIT 1;

  IF v_user_a IS NULL OR v_property_a IS NULL OR v_staff_id IS NULL
     OR v_module IS NULL OR v_user_b IS NULL THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: seed two active properties/users and an active staff member with an assigned supported module';
  END IF;

  PERFORM set_config('app.phase1.user_a', v_user_a::text, true);
  PERFORM set_config('app.phase1.property_a', v_property_a::text, true);
  PERFORM set_config('app.phase1.staff_id', v_staff_id::text, true);
  PERFORM set_config('app.phase1.module', v_module, true);
  PERFORM set_config('app.phase1.user_b', v_user_b::text, true);

  -- The test fixture is transactional. Replace the user's current session and
  -- ensure user B has no session; rollback restores both original rows.
  DELETE FROM public.staff_sessions WHERE user_id = v_user_b;
  INSERT INTO public.staff_sessions
    (user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at)
  VALUES
    (v_user_a, v_staff_id, v_property_a, now(), v_module,
     now() + interval '30 minutes', now() + interval '8 hours', NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET staff_id = EXCLUDED.staff_id,
      property_id = EXCLUDED.property_id,
      verified_at = EXCLUDED.verified_at,
      module = EXCLUDED.module,
      expires_at = EXCLUDED.expires_at,
      hard_expires_at = EXCLUDED.hard_expires_at,
      revoked_at = NULL;
END
$seed$;

SELECT set_config('request.jwt.claim.sub', current_setting('app.phase1.user_a'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.phase1.user_a'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $valid_session$
DECLARE
  v_property uuid := current_setting('app.phase1.property_a')::uuid;
  v_module text := current_setting('app.phase1.module');
  v_other_module text;
BEGIN
  IF NOT public.fn_staff_session_allows_module(v_property, v_module) THEN
    RAISE EXCEPTION 'FAIL: valid session was rejected for its assigned module';
  END IF;
  IF NOT public.fn_staff_module_access(v_property, v_module) THEN
    RAISE EXCEPTION 'FAIL: module access rejected for a valid assigned staff session';
  END IF;

  SELECT candidate INTO v_other_module
  FROM unnest(ARRAY['frontoffice','pos','backoffice','store']) AS modules(candidate)
  WHERE candidate <> v_module
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_sessions ss
      WHERE ss.user_id = auth.uid()
        AND lower(ss.module) = lower(candidate)
    )
  LIMIT 1;

  IF v_other_module IS NOT NULL
     AND public.fn_staff_session_allows_module(v_property, v_other_module) THEN
    RAISE EXCEPTION 'FAIL: staff session was accepted for wrong module %', v_other_module;
  END IF;
  RAISE NOTICE 'PASS: session is bound to its assigned module';
END
$valid_session$;

RESET ROLE;
UPDATE public.staff_sessions
SET expires_at = now() - interval '1 minute'
WHERE user_id = current_setting('app.phase1.user_a')::uuid;

SET LOCAL ROLE authenticated;
DO $expired_session$
BEGIN
  IF public.fn_staff_session_allows_module(
    current_setting('app.phase1.property_a')::uuid,
    current_setting('app.phase1.module')
  ) THEN
    RAISE EXCEPTION 'FAIL: expired session still authorizes module access';
  END IF;
  IF public.touch_active_staff_session() THEN
    RAISE EXCEPTION 'FAIL: expired session was refreshed';
  END IF;
  RAISE NOTICE 'PASS: expired session denied and cannot refresh';
END
$expired_session$;

RESET ROLE;
UPDATE public.staff_sessions
SET expires_at = now() + interval '30 minutes',
    hard_expires_at = now() - interval '1 second',
    revoked_at = NULL
WHERE user_id = current_setting('app.phase1.user_a')::uuid;

SET LOCAL ROLE authenticated;
DO $hard_expired_session$
BEGIN
  IF public.touch_active_staff_session() THEN
    RAISE EXCEPTION 'FAIL: hard-expired session was refreshed';
  END IF;
  RAISE NOTICE 'PASS: hard lifetime cannot be extended';
END
$hard_expired_session$;

RESET ROLE;
UPDATE public.staff_sessions
SET expires_at = now() + interval '30 minutes',
    hard_expires_at = now() + interval '8 hours',
    revoked_at = now()
WHERE user_id = current_setting('app.phase1.user_a')::uuid;

SET LOCAL ROLE authenticated;
DO $revoked_session$
BEGIN
  IF public.fn_staff_session_allows_module(
    current_setting('app.phase1.property_a')::uuid,
    current_setting('app.phase1.module')
  ) THEN
    RAISE EXCEPTION 'FAIL: revoked session still authorizes module access';
  END IF;
  IF public.touch_active_staff_session() THEN
    RAISE EXCEPTION 'FAIL: revoked session was refreshed';
  END IF;
  RAISE NOTICE 'PASS: revoked session denied and cannot refresh';
END
$revoked_session$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('app.phase1.user_b'), true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.phase1.user_b'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $no_session$
BEGIN
  IF public.touch_active_staff_session() THEN
    RAISE EXCEPTION 'FAIL: caller without a session received successful refresh';
  END IF;
  RAISE NOTICE 'PASS: refresh without session fails closed';
END
$no_session$;

ROLLBACK;
