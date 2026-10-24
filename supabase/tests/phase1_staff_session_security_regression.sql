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
  v_property_b uuid;
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

  SELECT pu.user_id, pu.property_id
    INTO v_user_b, v_property_b
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
     OR v_module IS NULL OR v_user_b IS NULL OR v_property_b IS NULL THEN
    RAISE EXCEPTION
      'PRECONDITION_FAILED: seed two active properties/users and an active staff member with an assigned supported module';
  END IF;

  PERFORM set_config('app.phase1.user_a', v_user_a::text, true);
  PERFORM set_config('app.phase1.property_a', v_property_a::text, true);
  PERFORM set_config('app.phase1.staff_id', v_staff_id::text, true);
  PERFORM set_config('app.phase1.module', v_module, true);
  PERFORM set_config('app.phase1.user_b', v_user_b::text, true);
  PERFORM set_config('app.phase1.property_b', v_property_b::text, true);

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


DO $policy_module_guards$
DECLARE
  v_pos text;
  v_store text;
  v_payments text;
BEGIN
  SELECT qual INTO v_pos FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'pos_shifts'
    AND policyname = 'fixture_pos_shifts_update';
  SELECT qual INTO v_store FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'stores'
    AND policyname = 'fixture_stores_update';
  SELECT with_check INTO v_payments FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'payments'
    AND policyname = 'fixture_payments_insert';

  IF v_pos IS NULL OR v_pos NOT ILIKE '%fn_staff_module_access%'
     OR v_pos NOT ILIKE '%pos%' THEN
    RAISE EXCEPTION 'FAIL: POS RLS staff-role branch lacks POS module guard: %', v_pos;
  END IF;
  IF v_store IS NULL OR v_store NOT ILIKE '%fn_staff_module_access%'
     OR v_store NOT ILIKE '%store%' THEN
    RAISE EXCEPTION 'FAIL: store RLS staff-role branch lacks store module guard: %', v_store;
  END IF;
  IF v_payments IS NULL OR v_payments NOT ILIKE '%fn_staff_module_access%'
     OR v_payments NOT ILIKE '%pos%'
     OR v_payments NOT ILIKE '%backoffice%' THEN
    RAISE EXCEPTION 'FAIL: payment RLS staff-role branch lacks POS/back-office module guard: %', v_payments;
  END IF;
  RAISE NOTICE 'PASS: direct staff-role RLS predicates are module guarded';
END
$policy_module_guards$;

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
  IF public.fn_staff_session_allows_module(current_setting('app.phase1.property_b')::uuid, v_module) THEN
    RAISE EXCEPTION 'FAIL: staff session crossed into another property';
  END IF;

  SELECT candidate INTO v_other_module
  FROM unnest(ARRAY['frontoffice','pos','backoffice','store']) AS modules(candidate)
  WHERE candidate <> v_module
  LIMIT 1;

  IF v_other_module IS NOT NULL
     AND public.fn_staff_session_allows_module(v_property, v_other_module) THEN
    RAISE EXCEPTION 'FAIL: staff session was accepted for wrong module %', v_other_module;
  END IF;
  RAISE NOTICE 'PASS: session is bound to its assigned module';
END
$valid_session$;


-- Verify failed PIN attempts remain throttled after the session migration.
DO $pin_lockout$
DECLARE
  v_property uuid := current_setting('app.phase1.property_a')::uuid;
  v_module text := current_setting('app.phase1.module');
  v_result jsonb;
  v_count integer;
  i integer;
BEGIN
  DELETE FROM public.staff_pin_attempts
  WHERE user_id = current_setting('app.phase1.user_a')::uuid
    AND property_id = v_property;

  FOR i IN 1..5 LOOP
    v_result := public.verify_staff_pin(v_property, v_module, 'definitely-not-a-valid-pin-hash');
  END LOOP;

  IF v_result->>'reason' <> 'locked' THEN
    RAISE EXCEPTION 'FAIL: fifth failed PIN attempt did not trigger lockout: %', v_result;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.staff_pin_attempts
  WHERE user_id = current_setting('app.phase1.user_a')::uuid
    AND property_id = v_property
    AND failed_count >= 5
    AND locked_until > now();

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: failed PIN attempts were not persisted with active lockout';
  END IF;
  RAISE NOTICE 'PASS: five failed PIN attempts trigger timed lockout';
END
$pin_lockout$;

RESET ROLE;
UPDATE public.staff_pin_attempts
SET locked_until = now() - interval '1 second'
WHERE user_id = current_setting('app.phase1.user_a')::uuid
  AND property_id = current_setting('app.phase1.property_a')::uuid;
SET LOCAL ROLE authenticated;

DO $pin_success_clears_attempts$
DECLARE
  v_property uuid := current_setting('app.phase1.property_a')::uuid;
  v_module text := current_setting('app.phase1.module');
  v_pin_hash text;
  v_result jsonb;
  v_count integer;
BEGIN
  SELECT pin_hash INTO v_pin_hash
  FROM public.staff
  WHERE id = current_setting('app.phase1.staff_id')::uuid;

  v_result := public.verify_staff_pin(v_property, v_module, v_pin_hash);
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: valid PIN did not establish a scoped session after lock expiry: %', v_result;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.staff_pin_attempts
  WHERE user_id = current_setting('app.phase1.user_a')::uuid
    AND property_id = v_property;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: successful PIN verification did not clear failed attempts';
  END IF;
  RAISE NOTICE 'PASS: successful PIN verification clears failed attempts';
END
$pin_success_clears_attempts$;


RESET ROLE;
UPDATE public.staff
SET assigned_modules = ARRAY['frontoffice']::text[]
WHERE id = current_setting('app.phase1.staff_id')::uuid;

SET LOCAL ROLE authenticated;
DO $module_assignment_changed$
BEGIN
  IF public.fn_staff_session_allows_module(
    current_setting('app.phase1.property_a')::uuid,
    current_setting('app.phase1.module')
  ) THEN
    RAISE EXCEPTION 'FAIL: session retained access after its module assignment was removed';
  END IF;
  IF public.current_staff_role(current_setting('app.phase1.property_a')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: current_staff_role returned a role after module assignment changed';
  END IF;
  IF public.touch_active_staff_session() THEN
    RAISE EXCEPTION 'FAIL: session refreshed after module assignment changed';
  END IF;
  RAISE NOTICE 'PASS: changed staff module assignment invalidates the session';
END
$module_assignment_changed$;

RESET ROLE;
UPDATE public.staff
SET assigned_modules = ARRAY[current_setting('app.phase1.module')]::text[]
WHERE id = current_setting('app.phase1.staff_id')::uuid;

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



DO $membership_role_scope$
DECLARE
  v_property uuid := current_setting('app.phase1.property_b')::uuid;
BEGIN
  IF NOT public.fn_staff_module_access(v_property, 'pos') THEN
    RAISE EXCEPTION 'FAIL: receptionist membership lost permitted POS access';
  END IF;
  IF public.fn_staff_module_access(v_property, 'store') THEN
    RAISE EXCEPTION 'FAIL: receptionist membership gained store access';
  END IF;
  IF public.fn_staff_module_access(v_property, 'backoffice') THEN
    RAISE EXCEPTION 'FAIL: receptionist membership gained back-office access';
  END IF;
  RAISE NOTICE 'PASS: email/property membership retains only its assigned module scope';
END
$membership_role_scope$;

DO $subscription_existing$
DECLARE
  v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(
    current_setting('app.phase1.property_b')::uuid, 'pos'
  );
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: existing active subscription was not evaluated as allowed: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: existing active subscription access remains allowed';
END
$subscription_existing$;


RESET ROLE;
UPDATE public.property_subscriptions
SET status = 'trial', trial_ends_at = now() + interval '1 day',
    current_period_ends_at = NULL, grace_ends_at = NULL
WHERE property_id = current_setting('app.phase1.property_b')::uuid;
SET LOCAL ROLE authenticated;
DO $subscription_trial$
DECLARE v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(current_setting('app.phase1.property_b')::uuid, 'pos');
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: valid trial access changed: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: valid trial access preserved';
END
$subscription_trial$;

RESET ROLE;
UPDATE public.property_subscriptions
SET trial_ends_at = now() - interval '1 day'
WHERE property_id = current_setting('app.phase1.property_b')::uuid;
SET LOCAL ROLE authenticated;
DO $subscription_expired_trial$
DECLARE v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(current_setting('app.phase1.property_b')::uuid, 'pos');
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: expired trial was allowed: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: expired trial remains denied';
END
$subscription_expired_trial$;

RESET ROLE;
UPDATE public.property_subscriptions
SET status = 'past_due', current_period_ends_at = now() - interval '1 day',
    grace_ends_at = now() + interval '1 day'
WHERE property_id = current_setting('app.phase1.property_b')::uuid;
SET LOCAL ROLE authenticated;
DO $subscription_past_due_grace$
DECLARE v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(current_setting('app.phase1.property_b')::uuid, 'pos');
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: active grace period was denied: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: past-due grace period preserved';
END
$subscription_past_due_grace$;

RESET ROLE;
UPDATE public.property_subscriptions
SET status = 'suspended', grace_ends_at = now() + interval '1 day'
WHERE property_id = current_setting('app.phase1.property_b')::uuid;
SET LOCAL ROLE authenticated;
DO $subscription_suspended_grace$
DECLARE v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(current_setting('app.phase1.property_b')::uuid, 'pos');
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: suspended subscription inside grace period was denied: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: suspended grace period preserved';
END
$subscription_suspended_grace$;

RESET ROLE;
UPDATE public.property_subscriptions
SET status = 'cancelled', grace_ends_at = NULL
WHERE property_id = current_setting('app.phase1.property_b')::uuid;
SET LOCAL ROLE authenticated;
DO $subscription_cancelled$
DECLARE v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(current_setting('app.phase1.property_b')::uuid, 'pos');
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: cancelled subscription was allowed: %', v_access;
  END IF;
  RAISE NOTICE 'PASS: cancelled subscription remains denied';
END
$subscription_cancelled$;

RESET ROLE;
DELETE FROM public.property_subscriptions
WHERE property_id = current_setting('app.phase1.property_b')::uuid;

SET LOCAL ROLE authenticated;
DO $subscription_missing$
DECLARE
  v_access jsonb;
BEGIN
  v_access := public.fn_subscription_access(
    current_setting('app.phase1.property_b')::uuid, 'pos'
  );
  IF coalesce((v_access->>'allowed')::boolean, false) IS NOT FALSE
     OR v_access->>'reason' <> 'subscription_not_configured' THEN
    RAISE EXCEPTION 'FAIL: missing subscription did not fail closed: %', v_access;
  END IF;
  IF public.fn_staff_module_access(current_setting('app.phase1.property_b')::uuid, 'pos') THEN
    RAISE EXCEPTION 'FAIL: module access bypassed a missing subscription';
  END IF;
  RAISE NOTICE 'PASS: missing subscription denies access without provisioning';
END
$subscription_missing$;

RESET ROLE;
DO $subscription_no_side_effect$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.property_subscriptions
  WHERE property_id = current_setting('app.phase1.property_b')::uuid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: access evaluation inserted a missing subscription';
  END IF;
  RAISE NOTICE 'PASS: subscription access evaluation has no provisioning side effect';
END
$subscription_no_side_effect$;


-- Restore an active subscription for property B before exercising the POS RPCs.
RESET ROLE;
INSERT INTO public.property_subscriptions(property_id,plan_code,status,enabled_modules)
VALUES (current_setting('app.phase1.property_b')::uuid,'professional','active',
        ARRAY['frontoffice','pos','backoffice','store']::text[])
ON CONFLICT (property_id) DO UPDATE
SET status='active', trial_ends_at=NULL, current_period_ends_at=NULL,
    grace_ends_at=NULL, enabled_modules=EXCLUDED.enabled_modules;

SELECT set_config('request.jwt.claim.sub', current_setting('app.phase1.user_b'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('app.phase1.user_b'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $pos_rpc_tenant_guards$
DECLARE
  v_property_a uuid := current_setting('app.phase1.property_a')::uuid;
  v_property_b uuid := current_setting('app.phase1.property_b')::uuid;
  v_count integer;
  v_shift public.pos_shifts;
BEGIN
  SELECT count(*) INTO v_count FROM public.fn_list_pos_menu(v_property_b);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: authorized property B receptionist could not read own POS menu; rows=%', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.fn_list_pos_menu(v_property_a);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: property B user read property A POS menu; rows=%', v_count;
  END IF;

  v_shift := public.fn_current_pos_shift(v_property_b);
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'FAIL: authorized property B user could not read own open POS shift';
  END IF;
  v_shift := public.fn_current_pos_shift(v_property_a);
  IF v_shift IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: property B user read property A POS shift';
  END IF;

  IF has_function_privilege('authenticated',
       'public.create_pending_property_for_user(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated role can call low-level pending-property helper directly';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.create_pending_property_for_user(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: trusted service role lost low-level pending-property helper access';
  END IF;

  RAISE NOTICE 'PASS: POS menu and shift RPCs enforce property/module authorization';
  RAISE NOTICE 'PASS: low-level property creation helper is not directly executable by authenticated clients';
END
$pos_rpc_tenant_guards$;

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
SET LOCAL ROLE anon;

DO $public_booking_guards$
DECLARE
  v_enabled jsonb;
  v_disabled jsonb;
BEGIN
  v_enabled := public.fn_public_booking_engine_config(current_setting('app.phase1.property_a')::uuid);
  v_disabled := public.fn_public_booking_engine_config(current_setting('app.phase1.property_b')::uuid);
  IF v_enabled IS NULL OR v_enabled->>'name' <> 'Fixture Property A' THEN
    RAISE EXCEPTION 'FAIL: active enabled public booking config was not returned: %', v_enabled;
  END IF;
  IF v_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: disabled booking engine leaked public config: %', v_disabled;
  END IF;
  RAISE NOTICE 'PASS: public booking config requires enabled engine';
END
$public_booking_guards$;

RESET ROLE;
UPDATE public.properties SET status='pending'
WHERE id = current_setting('app.phase1.property_a')::uuid;
SET LOCAL ROLE anon;
DO $inactive_booking_guard$
BEGIN
  IF public.fn_public_booking_engine_config(current_setting('app.phase1.property_a')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: inactive property booking config was exposed';
  END IF;
  RAISE NOTICE 'PASS: inactive property booking config denied';
END
$inactive_booking_guard$;


ROLLBACK;
