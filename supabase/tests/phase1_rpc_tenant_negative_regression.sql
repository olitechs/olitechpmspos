-- Phase 1 tenant/RPC negative regression harness.
-- RUN ONLY on a schema-equivalent, isolated test database with seeded fixtures.
-- NEVER run on production. Requires a privileged test connection because the
-- fixture mutations below are inside this transaction and are rolled back.
-- Preconditions: two distinct users (A/B), each with a distinct property (A/B),
-- neither user is a member of the other user's property. Property B must be active.
-- This script deliberately fails if the security remediation is absent.
BEGIN;

DO $preconditions$
DECLARE
  v_user_a uuid;
  v_property_a uuid;
  v_user_b uuid;
  v_property_b uuid;
BEGIN
  SELECT pu.user_id, pu.property_id
    INTO v_user_a, v_property_a
  FROM public.property_users pu
  JOIN public.properties p ON p.id = pu.property_id
  WHERE p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.property_users duplicate_member
      WHERE duplicate_member.property_id = pu.property_id
        AND duplicate_member.user_id <> pu.user_id
    )
  ORDER BY pu.created_at
  LIMIT 1;

  SELECT pu.user_id, pu.property_id
    INTO v_user_b, v_property_b
  FROM public.property_users pu
  JOIN public.properties p ON p.id = pu.property_id
  WHERE pu.user_id IS DISTINCT FROM v_user_a
    AND pu.property_id IS DISTINCT FROM v_property_a
    AND p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.property_users cross_member
      WHERE cross_member.property_id = v_property_a
        AND cross_member.user_id = pu.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.property_users cross_member
      WHERE cross_member.property_id = pu.property_id
        AND cross_member.user_id = v_user_a
    )
  ORDER BY pu.created_at
  LIMIT 1;

  IF v_user_a IS NULL OR v_property_a IS NULL
     OR v_user_b IS NULL OR v_property_b IS NULL
     OR v_user_a = v_user_b OR v_property_a = v_property_b THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: seed two distinct users with separate active properties and no cross-membership';
  END IF;

  PERFORM set_config('app.phase1.user_a', v_user_a::text, true);
  PERFORM set_config('app.phase1.property_a', v_property_a::text, true);
  PERFORM set_config('app.phase1.user_b', v_user_b::text, true);
  PERFORM set_config('app.phase1.property_b', v_property_b::text, true);
END
$preconditions$;

-- Set JWT claims for user A. All cross-tenant RPC calls below run as A.
SELECT set_config('request.jwt.claim.sub', current_setting('app.phase1.user_a'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('app.phase1.user_a'),
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $negative_tests$
DECLARE
  v_user_b uuid := current_setting('app.phase1.user_b')::uuid;
  v_property_a uuid := current_setting('app.phase1.property_a')::uuid;
  v_property_b uuid := current_setting('app.phase1.property_b')::uuid;
  v_count integer;
  v_shift_id uuid;
BEGIN
  -- A may not create/retrieve a property on behalf of B.
  BEGIN
    PERFORM public.create_pending_property_for_user(
      v_user_b, 'phase1-negative-test@example.invalid', 'Foreign User', NULL
    );
    RAISE EXCEPTION 'FAIL: cross-user pending-property creation was allowed';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      RAISE NOTICE 'PASS: cross-user pending-property creation denied';
  END;

  -- The menu RPC must not disclose B's products to A.
  SELECT count(*) INTO v_count
  FROM public.fn_list_pos_menu(v_property_b);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: POS menu leaked % product rows from another property', v_count;
  END IF;
  RAISE NOTICE 'PASS: cross-property POS menu returns zero rows';

  -- The shift RPC must not disclose B's active shift to A.
  SELECT shift_row.id INTO v_shift_id
  FROM public.fn_current_pos_shift(v_property_b) AS shift_row;
  IF v_shift_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: cross-property current POS shift was returned';
  END IF;
  RAISE NOTICE 'PASS: cross-property current POS shift returns no row';

  -- A remains able to call the RPC for its own property (authorization must not
  -- be implemented by indiscriminately disabling the RPC).
  PERFORM 1 FROM public.fn_list_pos_menu(v_property_a);
  RAISE NOTICE 'PASS: own-property POS menu RPC remains callable';
END
$negative_tests$;

-- Test public booking config with inactive property and disabled booking engine.
-- Reset the test role for fixture setup; all fixture changes are rolled back.
RESET ROLE;
UPDATE public.properties
SET status = 'pending'::public.property_status
WHERE id = current_setting('app.phase1.property_b')::uuid;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

DO $booking_inactive$
DECLARE
  v_config jsonb;
BEGIN
  SELECT public.fn_public_booking_engine_config(
    current_setting('app.phase1.property_b')::uuid
  ) INTO v_config;
  IF v_config IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: inactive property exposed public booking config';
  END IF;
  RAISE NOTICE 'PASS: inactive property has no public booking config';
END
$booking_inactive$;

RESET ROLE;
UPDATE public.properties
SET status = 'active'::public.property_status
WHERE id = current_setting('app.phase1.property_b')::uuid;

INSERT INTO public.booking_engine_settings (property_id, enabled)
VALUES (current_setting('app.phase1.property_b')::uuid, false)
ON CONFLICT (property_id) DO UPDATE SET enabled = false;

SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

DO $booking_disabled$
DECLARE
  v_config jsonb;
BEGIN
  SELECT public.fn_public_booking_engine_config(
    current_setting('app.phase1.property_b')::uuid
  ) INTO v_config;
  IF v_config IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: disabled booking engine exposed public config';
  END IF;
  RAISE NOTICE 'PASS: disabled booking engine has no public config';
END
$booking_disabled$;

-- Mandatory: every fixture mutation and any unexpected side effect is reverted.
ROLLBACK;
