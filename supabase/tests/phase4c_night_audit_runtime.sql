\set ON_ERROR_STOP on

-- Runs only after 20261128120000_phase4c_night_audit_boundary.sql on the
-- disposable CI database. Every write is rolled back at the end.
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('11000000-0000-0000-0000-000000000001', 'auditor@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'unauthorized@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'another-employee@example.test');

-- Property 1 is seeded by the fixture before the migration so the built-in
-- role template reconciliation can be verified at migration apply time.
INSERT INTO public.properties(id) VALUES
  ('21000000-0000-0000-0000-000000000002'),
  ('21000000-0000-0000-0000-000000000003'),
  ('21000000-0000-0000-0000-000000000004');

INSERT INTO public.staff(id, property_id, user_id, is_active, role)
VALUES
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', true, 'manager'),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', true, 'manager'),
  ('61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000003', true, 'receptionist'),
  ('61000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', true, 'manager'),
  ('61000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', true, 'manager');

-- A browser has one active PIN staff session. Permission and grant checks for
-- the other properties are exercised through their explicit server grants.
INSERT INTO public.staff_sessions(user_id, staff_id, property_id) VALUES
  ('11000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002');

INSERT INTO public.test_permission_grants(user_id, permission_code) VALUES
  ('11000000-0000-0000-0000-000000000001', 'nightaudit.run'),
  ('11000000-0000-0000-0000-000000000003', 'nightaudit.run');

INSERT INTO public.property_business_dates(property_id, business_date) VALUES
  ('21000000-0000-0000-0000-000000000001', DATE '2026-11-28'),
  ('21000000-0000-0000-0000-000000000002', DATE '2026-11-28'),
  ('21000000-0000-0000-0000-000000000003', DATE '2026-11-28');

-- Property 1 reconciles: posted receipts and room payments agree, and the
-- voided receipt must be reported but never counted as revenue.
INSERT INTO public.rooms(id, property_id, number) VALUES
  ('81000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '101');

INSERT INTO public.reservations(id, property_id, room_id, status, arrival, departure, rate)
VALUES (
  '82000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'checked-in', DATE '2026-11-27', DATE '2026-11-30', 200
);

INSERT INTO public.folio_charges(id, property_id, reservation_id, source, description, amount, created_at)
VALUES (
  '83000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  'room', 'Room charge', 200, '2026-11-28 07:00:00+03'
);

INSERT INTO public.payments(property_id, reservation_id, folio_charge_id, amount, created_at)
VALUES ('21000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001',
        '83000000-0000-0000-0000-000000000001', 200, '2026-11-28 07:30:00+03');

INSERT INTO public.pos_receipts(id, property_id, subtotal, discount_amount, vat, total, payment_method, status, created_at)
VALUES
  ('84000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
    100, 0, 16, 116, 'cash', 'posted', '2026-11-28 08:00:00+03'),
  ('84000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001',
    50, 0, 0, 50, 'cash', 'voided', '2026-11-28 09:00:00+03');

UPDATE public.pos_receipts
SET voided_at = '2026-11-28 10:00:00+03'
WHERE id = '84000000-0000-0000-0000-000000000002';

INSERT INTO public.cashier_shifts(property_id, status, variance, closed_at)
VALUES ('21000000-0000-0000-0000-000000000001', 'closed', 0, '2026-11-28 20:00:00+03');

-- Property 2 has an unreconciled room folio.
INSERT INTO public.folio_charges(id, property_id, reservation_id, source, description, amount, created_at)
VALUES (
  '83000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000002',
  '82000000-0000-0000-0000-000000000002',
  'room', 'Unpaid room charge', 200, '2026-11-28 08:00:00+03'
);

INSERT INTO public.module_access_grants(
  id, property_id, staff_id, permission_code, granted_by_staff_id, reason, expires_at
) VALUES (
  '93000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000002',
  '61000000-0000-0000-0000-000000000002',
  'nightaudit.override',
  '61000000-0000-0000-0000-000000000002',
  'verified variance review',
  now() + interval '1 hour'
);

-- Property 3 has a failed audit that must not close accommodation posting.
INSERT INTO public.rooms(id, property_id, number) VALUES
  ('81000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000003', '301');
INSERT INTO public.reservations(id, property_id, room_id, status, arrival, departure, rate)
VALUES (
  '82000000-0000-0000-0000-000000000003',
  '21000000-0000-0000-0000-000000000003',
  '81000000-0000-0000-0000-000000000003',
  'checked-in', DATE '2026-11-27', DATE '2026-11-30', 100
);
INSERT INTO public.night_audits(
  id, property_id, business_date, next_business_date, status, started_by, request_key
) VALUES (
  '74000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000003',
  DATE '2026-11-28', DATE '2026-11-29', 'failed',
  '11000000-0000-0000-0000-000000000001', 'fixture-failed-boundary'
);

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_p1 uuid := '21000000-0000-0000-0000-000000000001';
  v_p2 uuid := '21000000-0000-0000-0000-000000000002';
  v_p3 uuid := '21000000-0000-0000-0000-000000000003';
  v_p4 uuid := '21000000-0000-0000-0000-000000000004';
  v_user uuid := '11000000-0000-0000-0000-000000000001';
  v_other_user uuid := '11000000-0000-0000-0000-000000000003';
  v_unauthorized uuid := '11000000-0000-0000-0000-000000000002';
  v_grant uuid := '93000000-0000-0000-0000-000000000001';
  v_date date := DATE '2026-11-28';
  v_audit public.night_audits%ROWTYPE;
  v_retry public.night_audits%ROWTYPE;
  v_check jsonb;
  v_snapshot jsonb;
  v_count integer;
  v_roles text[];
BEGIN
  -- Permission authority is server-side.
  PERFORM set_config('request.jwt.claim.sub', v_unauthorized::text, true);
  BEGIN
    PERFORM public.fn_phase4c_reconciliation_snapshot(v_p1, v_date);
    RAISE EXCEPTION 'EXPECTED-SNAPSHOT-DENIAL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-SNAPSHOT-DENIAL'
       OR POSITION('Missing employee permission: nightaudit.run' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  v_check := public.fn_night_audit_precheck(v_p1, v_date);
  v_snapshot := v_check -> 'reconciliation';
  IF (v_check ->> 'ready')::boolean IS DISTINCT FROM true
     OR (v_check ->> 'blocking_variance')::boolean IS DISTINCT FROM false
     OR (v_check ->> 'transactions')::integer <> 1
     OR (v_snapshot ->> 'voids_excluded')::numeric <> 50
     OR (v_snapshot ->> 'room_revenue_variance')::numeric <> 0
     OR (v_snapshot ->> 'pos_tax_discount_variance')::numeric <> 0 THEN
    RAISE EXCEPTION 'RECON-001: clean precheck must exclude voids and reconcile all variances';
  END IF;

  v_audit := public.fn_phase4c_run_night_audit(v_p1, 'runtime-clean-1', v_date, 'clean close');
  IF v_audit.status <> 'closed'
     OR v_audit.total_revenue <> 316
     OR v_audit.cash_revenue <> 116
     OR v_audit.room_revenue <> 200
     OR v_audit.voids <> 50
     OR v_audit.next_business_date <> DATE '2026-11-29' THEN
    RAISE EXCEPTION 'CLOSE-001: posted ledgers must produce the reconciled close';
  END IF;
  IF (SELECT business_date FROM public.property_business_dates WHERE property_id = v_p1)
     <> DATE '2026-11-29' THEN
    RAISE EXCEPTION 'CLOSE-002: a successful close must advance the business date';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE property_id = v_p1 AND action = 'night_audit_closed';
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE property_id = v_p1
       AND action = 'night_audit_closed'
       AND (new_value ->> 'voids')::numeric = 50
       AND (new_value -> 'reconciliation_snapshot' ->> 'voids_excluded')::numeric = 50
  ) THEN
    RAISE EXCEPTION 'AUDIT-001: close audit must record the reconciliation snapshot once';
  END IF;

  v_retry := public.fn_phase4c_run_night_audit(v_p1, 'runtime-clean-1', v_date, 'clean close');
  IF v_retry.id <> v_audit.id OR v_retry.status <> 'closed' THEN
    RAISE EXCEPTION 'REPLAY-001: an identical retry must return the original close';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE property_id = v_p1 AND action = 'night_audit_closed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'REPLAY-002: retry must not write a second close audit';
  END IF;
  BEGIN
    PERFORM public.fn_phase4c_run_night_audit(v_p1, 'runtime-clean-1', v_date, 'changed notes');
    RAISE EXCEPTION 'EXPECTED-FINGERPRINT-CONFLICT';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-FINGERPRINT-CONFLICT'
       OR POSITION('request key was reused with a different payload' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- The legacy two-argument RPC must replay after the business date advanced.
  v_audit := public.fn_run_night_audit(v_p1, 'legacy close');
  IF v_audit.business_date <> DATE '2026-11-29' OR v_audit.status <> 'closed' THEN
    RAISE EXCEPTION 'LEGACY-001: legacy close must close the current business date';
  END IF;
  v_retry := public.fn_run_night_audit(v_p1, 'legacy close');
  IF v_retry.id <> v_audit.id THEN
    RAISE EXCEPTION 'LEGACY-002: legacy retry must replay the original close';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE property_id = v_p1 AND action = 'night_audit_closed';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'LEGACY-003: replay must not create a second close audit';
  END IF;

  -- A blocking variance produces a failed investigation row, not a closed day.
  v_check := public.fn_night_audit_precheck(v_p2, v_date);
  IF (v_check ->> 'blocking_variance')::boolean IS DISTINCT FROM true
     OR POSITION('Room folio revenue does not reconcile'
                 IN COALESCE(v_check -> 'reconciliation' ->> 'blocking_reason', '')) = 0 THEN
    RAISE EXCEPTION 'VARIANCE-001: unpaid room folio must block the close';
  END IF;
  v_audit := public.fn_phase4c_run_night_audit(v_p2, 'runtime-blocked-1', v_date, 'blocked close');
  IF v_audit.status <> 'failed' THEN
    RAISE EXCEPTION 'VARIANCE-002: unauthorised close must be recorded as failed';
  END IF;
  IF (SELECT business_date FROM public.property_business_dates WHERE property_id = v_p2)
     <> v_date THEN
    RAISE EXCEPTION 'VARIANCE-003: a failed close must not advance the business date';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE property_id = v_p2 AND action = 'night_audit_failed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VARIANCE-004: failed close must be audited';
  END IF;

  IF NOT public.fn_phase4c_night_audit_override(v_p2, v_grant) THEN
    RAISE EXCEPTION 'OVERRIDE-001: a valid grant for this employee must be accepted';
  END IF;

  -- A different employee cannot spend the first employee's grant.
  PERFORM set_config('request.jwt.claim.sub', v_other_user::text, true);
  IF public.fn_phase4c_night_audit_override(v_p2, v_grant) THEN
    RAISE EXCEPTION 'OVERRIDE-002: another employee must not be able to spend the grant';
  END IF;
  v_audit := public.fn_phase4c_run_night_audit(
    v_p2, 'runtime-stolen-override', v_date, 'stolen override', 'no authority', v_grant
  );
  IF v_audit.status <> 'failed' THEN
    RAISE EXCEPTION 'OVERRIDE-003: a stolen grant must not close a blocked day';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.fn_phase4c_run_night_audit(
      v_p2, 'runtime-override-no-reason', v_date, 'override close', null, v_grant
    );
    RAISE EXCEPTION 'EXPECTED-MISSING-REASON';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-MISSING-REASON'
       OR POSITION('An override reason is required' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  v_audit := public.fn_phase4c_run_night_audit(
    v_p2, 'runtime-override-1', v_date, 'override close', 'verified manual room settlement', v_grant
  );
  IF v_audit.status <> 'closed'
     OR v_audit.override_by <> v_user
     OR v_audit.override_grant_id <> v_grant
     OR COALESCE(v_audit.override_reason, '') <> 'verified manual room settlement'
     OR v_audit.next_business_date <> DATE '2026-11-29' THEN
    RAISE EXCEPTION 'OVERRIDE-004: an authorised override must close and record its evidence';
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE property_id = v_p2 AND action = 'night_audit_variance_override';
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE property_id = v_p2
       AND action = 'night_audit_variance_override'
       AND new_value ->> 'grant_id' = v_grant::text
       AND POSITION('verified manual room settlement' IN (new_value ->> 'reason')) > 0
  ) THEN
    RAISE EXCEPTION 'OVERRIDE-005: override evidence must be audited';
  END IF;

  -- A failed row is an investigation state, not a closed financial boundary.
  v_check := public.fn_post_accommodation_charges(v_p3, v_date);
  IF (v_check ->> 'accommodationPosted')::integer <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.folio_charges
        WHERE property_id = v_p3
          AND idempotency_key = 'night:82000000-0000-0000-0000-000000000003:2026-11-28'
     ) THEN
    RAISE EXCEPTION 'BOUNDARY-001: a failed audit must not block accommodation posting';
  END IF;

  -- Future properties are provisioned with the reconciled role template.
  PERFORM public.fn_seed_employee_roles(v_p4);
  SELECT permission_codes INTO v_roles
  FROM public.employee_roles
  WHERE property_id = v_p4 AND name = 'Property Manager' AND is_system;
  IF NOT ('nightaudit.run' = ANY(COALESCE(v_roles, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ROLE-001: new Property Manager templates must include nightaudit.run';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE property_id = v_p1 AND action = 'phase4c_role_template_reconciled'
       AND (new_value -> 'permission_codes') ? 'nightaudit.run'
  ) THEN
    RAISE EXCEPTION 'ROLE-002: built-in template reconciliation must be audited';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_phase4c_run_night_audit(uuid,text,date,text,text,uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.fn_phase4c_run_night_audit(uuid,text,date,text,text,uuid)', 'EXECUTE'
     )
     OR has_function_privilege('anon', 'public.fn_night_audit_precheck(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_phase4c_reconciliation_snapshot(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL-001: night audit RPCs must be authenticated-only';
  END IF;

  RAISE NOTICE 'Phase 4C-1 night audit PostgreSQL runtime assertions passed.';
END
$test$;

ROLLBACK;
\echo 'Phase 4C-1 runtime test completed; all fixture changes rolled back.'
