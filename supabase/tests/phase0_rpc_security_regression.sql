-- Phase 0 RPC authorization regression test.
-- Run ONLY against the existing disposable Supabase project, never production.
-- Requires one owner membership and a second property the owner does not belong to.
-- All attempted writes are rolled back. This validates the current disposable schema;
-- it does not substitute for production-equivalent two-tenant testing.

BEGIN;

-- Capture fixture identifiers before switching to the authenticated role.
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT pu.user_id::text FROM public.property_users pu WHERE pu.role = 'owner' LIMIT 1),
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT pu.user_id::text FROM public.property_users pu WHERE pu.role = 'owner' LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config(
  'app.phase0.own_property',
  (SELECT pu.property_id::text FROM public.property_users pu WHERE pu.role = 'owner' LIMIT 1),
  true
);
SELECT set_config(
  'app.phase0.other_property',
  (
    SELECT p.id::text
    FROM public.properties p
    WHERE p.id <> (
      SELECT pu.property_id FROM public.property_users pu WHERE pu.role = 'owner' LIMIT 1
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.property_users pu
        WHERE pu.property_id = p.id
          AND pu.user_id = (
            SELECT pu2.user_id FROM public.property_users pu2 WHERE pu2.role = 'owner' LIMIT 1
          )
      )
    LIMIT 1
  ),
  true
);

SET LOCAL ROLE authenticated;

DO $phase0$
DECLARE
  v_user uuid := auth.uid();
  v_own uuid := nullif(current_setting('app.phase0.own_property', true), '')::uuid;
  v_other uuid := nullif(current_setting('app.phase0.other_property', true), '')::uuid;
  v_returned uuid;
  v_rows integer;
BEGIN
  IF v_user IS NULL OR v_own IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: seed one owner membership and a second property outside that membership';
  END IF;

  SELECT p.id INTO v_returned
  FROM public.create_pending_property_for_user(
    v_user, 'phase0-test@example.invalid', 'Phase 0 Test', NULL
  ) AS p;

  IF v_returned IS DISTINCT FROM v_own THEN
    RAISE EXCEPTION 'FAIL: own-property lookup was not idempotent';
  END IF;
  RAISE NOTICE 'PASS: authenticated owner retrieves own existing property';

  PERFORM 1 FROM public.fn_list_pos_menu(v_own);
  RAISE NOTICE 'PASS: authenticated owner can invoke own-property POS menu RPC';

  PERFORM 1 FROM public.fn_list_pos_menu(v_other);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: cross-property POS menu exposed % rows', v_rows;
  END IF;
  RAISE NOTICE 'PASS: cross-property POS menu exposes no rows to a non-member';

  BEGIN
    PERFORM public.create_pending_property_for_user(
      gen_random_uuid(), 'phase0-test@example.invalid', 'Cross User', NULL
    );
    RAISE EXCEPTION 'FAIL: cross-user pending-property creation was allowed';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: cross-user pending-property creation is rejected';
  END;

  PERFORM public.fn_public_booking_engine_config(gen_random_uuid());
  RAISE NOTICE 'PASS: unknown property returns no public booking configuration';

  BEGIN
    UPDATE public.properties
    SET status = CASE
      WHEN status = 'active' THEN 'pending'::public.property_status
      ELSE 'active'::public.property_status
    END
    WHERE id = v_own;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'FAIL: expected owner update to reach one property, got %', v_rows;
    END IF;

    RAISE EXCEPTION 'FAIL: non-platform owner changed protected property status/package';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: property owner cannot change protected status/package';
  END;
END
$phase0$;

-- Reverts any fixture side effects, including a regression that unexpectedly allowed
-- the protected update. The test must never leave changes in the disposable project.
ROLLBACK;
