\set ON_ERROR_STOP on

-- Runs only after phase7_1_wastage_approval_workflow.sql on the disposable CI database.
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('10000000-0000-0000-0000-000000000001', 'requester@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'approver@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'unauthorized@example.test');

INSERT INTO public.test_permission_grants(user_id, permission_code) VALUES
  ('10000000-0000-0000-0000-000000000001', 'stores.stock.wastage.submit'),
  ('10000000-0000-0000-0000-000000000002', 'stores.stock.wastage.approve');

INSERT INTO public.property_settings(property_id, negative_stock_policy)
VALUES ('20000000-0000-0000-0000-000000000001', 'block');

INSERT INTO public.inventory_locations(id, property_id, name) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Main Store'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Kitchen');

INSERT INTO public.products(
  id, property_id, name, current_stock, location, track_stock, base_unit, cost_price
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Runtime test ingredient', 10, 'Main Store', true, 'pcs', 2.50
);

INSERT INTO public.product_stock_locations(property_id, product_id, location_id, qty) VALUES
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 10);

INSERT INTO public.stock_movements(
  property_id, product_id, type, qty, reason, source_type, location_id, unit_code, base_qty, unit_cost
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'in', 10, 'opening balance', 'fixture',
  '30000000-0000-0000-0000-000000000002', 'pcs', 10, 2.50
);

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_property uuid := '20000000-0000-0000-0000-000000000001';
  v_product uuid := '40000000-0000-0000-0000-000000000001';
  v_default_location uuid := '30000000-0000-0000-0000-000000000001';
  v_kitchen_location uuid := '30000000-0000-0000-0000-000000000002';
  v_request public.inventory_wastage%ROWTYPE;
  v_retry public.inventory_wastage%ROWTYPE;
  v_rejected public.inventory_wastage%ROWTYPE;
  v_before_movements integer;
  v_after_movements integer;
  v_before_stock numeric;
BEGIN
  -- A requester may submit, but stock must remain unchanged until approval.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  v_request := public.fn_submit_inventory_wastage(
    v_property, v_product, 2, 'damaged stock', 'runtime-request-1', v_kitchen_location, NULL
  );
  v_retry := public.fn_submit_inventory_wastage(
    v_property, v_product, 2, 'damaged stock', 'runtime-request-1', v_kitchen_location, NULL
  );
  IF v_request.id IS DISTINCT FROM v_retry.id OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'SUBMIT-001: repeated request must return the same pending row';
  END IF;
  IF (SELECT current_stock FROM public.products WHERE id = v_product) <> 10
     OR (SELECT qty FROM public.product_stock_locations WHERE product_id=v_product AND location_id=v_kitchen_location) <> 10
     OR (SELECT count(*) FROM public.stock_movements WHERE product_id=v_product) <> 1 THEN
    RAISE EXCEPTION 'SUBMIT-002: submission must not change stock or movements';
  END IF;

  -- Reusing a request key with a different fingerprint must fail.
  BEGIN
    PERFORM public.fn_submit_inventory_wastage(
      v_property, v_product, 3, 'damaged stock', 'runtime-request-1', v_kitchen_location, NULL
    );
    RAISE EXCEPTION 'EXPECTED-KEY-CONFLICT';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-KEY-CONFLICT'
       OR POSITION('request key was already used with different wastage details' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- The requester cannot decide their own request.
  BEGIN
    PERFORM public.fn_decide_inventory_wastage(v_request.id, 'approve', NULL);
    RAISE EXCEPTION 'EXPECTED-SELF-APPROVAL-DENIAL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-SELF-APPROVAL-DENIAL'
       OR POSITION('requester cannot approve or reject' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- A separate approver posts exactly one location-aware movement.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
  SELECT count(*) INTO v_before_movements FROM public.stock_movements WHERE product_id=v_product;
  v_request := public.fn_decide_inventory_wastage(v_request.id, 'approve', NULL);
  v_retry := public.fn_decide_inventory_wastage(v_request.id, 'approve', NULL);
  SELECT count(*) INTO v_after_movements FROM public.stock_movements WHERE product_id=v_product;
  IF v_request.status <> 'approved' OR v_request.stock_movement_id IS NULL
     OR v_retry.id IS DISTINCT FROM v_request.id
     OR v_after_movements <> v_before_movements + 1 THEN
    RAISE EXCEPTION 'APPROVE-001: approval and repeated approval must post exactly one movement';
  END IF;
  IF (SELECT current_stock FROM public.products WHERE id=v_product) <> 8
     OR (SELECT qty FROM public.product_stock_locations WHERE product_id=v_product AND location_id=v_kitchen_location) <> 8
     OR (SELECT qty FROM public.product_stock_locations WHERE product_id=v_product AND location_id=v_default_location) <> 0
     OR (SELECT COALESCE(sum(qty),0) FROM public.product_stock_locations WHERE product_id=v_product) <> 8
     OR (SELECT COALESCE(sum(CASE WHEN type='in' THEN qty ELSE -qty END),0) FROM public.stock_movements WHERE product_id=v_product) <> 8 THEN
    RAISE EXCEPTION 'APPROVE-002: aggregate, ledger and selected location must reconcile; default location must remain unchanged';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE id=v_request.stock_movement_id
      AND source_type='wastage'
      AND source_id=v_request.id
      AND source_line_key='wastage'
      AND location_id=v_kitchen_location
  ) THEN
    RAISE EXCEPTION 'APPROVE-003: stock movement must be linked to the request and selected location';
  END IF;
  -- Rejection requires a reason and does not change stock.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  v_rejected := public.fn_submit_inventory_wastage(
    v_property, v_product, 1, 'expired item', 'runtime-request-2', v_kitchen_location, NULL
  );
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
  v_before_stock := (SELECT current_stock FROM public.products WHERE id=v_product);
  BEGIN
    PERFORM public.fn_decide_inventory_wastage(v_rejected.id, 'reject', NULL);
    RAISE EXCEPTION 'EXPECTED-REJECTION-REASON';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-REJECTION-REASON'
       OR POSITION('rejection reason is required' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
  v_rejected := public.fn_decide_inventory_wastage(v_rejected.id, 'reject', 'verified expired');
  IF v_rejected.status <> 'rejected'
     OR (SELECT current_stock FROM public.products WHERE id=v_product) <> v_before_stock THEN
    RAISE EXCEPTION 'REJECT-001: rejection must record reason without changing stock';
  END IF;

  -- An employee without submit permission cannot create requests.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM public.fn_submit_inventory_wastage(
      v_property, v_product, 1, 'unauthorized request', 'runtime-request-3', v_kitchen_location, NULL
    );
    RAISE EXCEPTION 'EXPECTED-PERMISSION-DENIAL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-PERMISSION-DENIAL'
       OR POSITION('submission permission is required' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- Property scoping rejects a product supplied under another tenant ID.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM public.fn_submit_inventory_wastage(
      '20000000-0000-0000-0000-000000000099', v_product, 1, 'cross tenant', 'runtime-request-4', v_kitchen_location, NULL
    );
    RAISE EXCEPTION 'EXPECTED-CROSS-TENANT-DENIAL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-CROSS-TENANT-DENIAL'
       OR POSITION('tracked product not found in the selected property' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  -- Insufficient stock is rejected during approval, and the pending request is retained.
  v_request := public.fn_submit_inventory_wastage(
    v_property, v_product, 99, 'overdraw attempt', 'runtime-request-5', v_kitchen_location, NULL
  );
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
  BEGIN
    PERFORM public.fn_decide_inventory_wastage(v_request.id, 'approve', NULL);
    RAISE EXCEPTION 'EXPECTED-INSUFFICIENT-STOCK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED-INSUFFICIENT-STOCK'
       OR POSITION('Insufficient total stock' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
  IF (SELECT status FROM public.inventory_wastage WHERE id=v_request.id) <> 'pending'
     OR (SELECT current_stock FROM public.products WHERE id=v_product) <> v_before_stock THEN
    RAISE EXCEPTION 'STOCK-001: failed approval must roll back and leave the request pending';
  END IF;

  IF has_function_privilege('authenticated', 'public.fn_post_wastage(uuid,uuid,numeric,text,uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL-001: legacy direct-post RPC must not be executable by authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.inventory_wastage', 'INSERT')
     OR has_table_privilege('authenticated', 'public.inventory_wastage', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.inventory_wastage', 'DELETE') THEN
    RAISE EXCEPTION 'ACL-002: authenticated direct DML on wastage must be revoked';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_decide_inventory_wastage(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL-003: authenticated must be able to execute the new permissioned RPCs';
  END IF;

  RAISE NOTICE 'Phase 7.1 wastage PostgreSQL runtime assertions passed.';
END
$test$;

ROLLBACK;
\echo 'Phase 7.1 runtime test completed; all fixture changes rolled back.'
