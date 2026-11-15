\set ON_ERROR_STOP on

-- RUN ONLY on a production-equivalent disposable database with known fixtures.
-- Never run this test against production.
-- The test user must have an active Store-authorized staff session and the property
-- must have the Stores entitlement enabled.
-- Required psql variables:
--   test_user_id, test_property_id, test_product_id,
--   test_selected_location_id, test_default_location_id.
-- Product must be tracked, and the two locations must be distinct and belong to
-- the same property. Product aggregate must reconcile to the sum of its locations.

\if :{?test_user_id}
\else
  \echo 'Missing test_user_id'
  \quit 2
\endif
\if :{?test_property_id}
\else
  \echo 'Missing test_property_id'
  \quit 2
\endif
\if :{?test_product_id}
\else
  \echo 'Missing test_product_id'
  \quit 2
\endif
\if :{?test_selected_location_id}
\else
  \echo 'Missing test_selected_location_id'
  \quit 2
\endif
\if :{?test_default_location_id}
\else
  \echo 'Missing test_default_location_id'
  \quit 2
\endif

BEGIN;
SELECT set_config('test.user_id', :'test_user_id', true);
SELECT set_config('test.property_id', :'test_property_id', true);
SELECT set_config('test.product_id', :'test_product_id', true);
SELECT set_config('test.selected_location_id', :'test_selected_location_id', true);
SELECT set_config('test.default_location_id', :'test_default_location_id', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('test.user_id'), 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_user_id uuid := current_setting('test.user_id')::uuid;
  v_property_id uuid := current_setting('test.property_id')::uuid;
  v_product_id uuid := current_setting('test.product_id')::uuid;
  v_selected_location_id uuid := current_setting('test.selected_location_id')::uuid;
  v_default_location_id uuid := current_setting('test.default_location_id')::uuid;
  v_total_before numeric;
  v_total_after numeric;
  v_selected_before numeric;
  v_selected_after numeric;
  v_default_before numeric;
  v_default_after numeric;
  v_location_sum numeric;
  v_adjustment public.stock_adjustments%ROWTYPE;
  v_adjustment_retry public.stock_adjustments%ROWTYPE;
  v_wastage public.inventory_wastage%ROWTYPE;
  v_wastage_retry public.inventory_wastage%ROWTYPE;
  v_count public.inventory_counts%ROWTYPE;
  v_count_retry public.inventory_counts%ROWTYPE;
  v_count_approved public.inventory_counts%ROWTYPE;
  v_count_approved_retry public.inventory_counts%ROWTYPE;
  v_counted_qty numeric;
  v_variance numeric;
  v_movement_count_before integer;
  v_movement_count_after integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'AUTH-001: JWT subject was not applied';
  END IF;

  IF NOT public.is_member_of_property(v_property_id)
     OR NOT public.can_store_write(v_property_id, NULL) THEN
    RAISE EXCEPTION 'AUTH-002: fixture user needs active Store authorization and entitlement';
  END IF;

  IF v_selected_location_id = v_default_location_id THEN
    RAISE EXCEPTION 'FIXTURE-001: selected and default locations must be different';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = v_product_id
      AND property_id = v_property_id
      AND track_stock = true
  ) THEN
    RAISE EXCEPTION 'FIXTURE-002: tracked product must belong to the test property';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_selected_location_id AND property_id = v_property_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_default_location_id AND property_id = v_property_id
  ) THEN
    RAISE EXCEPTION 'FIXTURE-003: both locations must belong to the test property';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.inventory_locations il
      ON il.property_id=p.property_id
     AND il.name=COALESCE(NULLIF(BTRIM(p.location),''),'Main Store')
    WHERE p.id=v_product_id
      AND il.id=v_default_location_id
  ) THEN
    RAISE EXCEPTION 'FIXTURE-004: supplied default location must match products.location';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_stock_locations
    WHERE product_id=v_product_id AND location_id=v_default_location_id
  ) THEN
    RAISE EXCEPTION 'FIXTURE-005: default location balance row must exist before the test';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='products'
      AND t.tgname='products_sync_default_location'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'TRIGGER-001: default-location trigger must remain enabled';
  END IF;

  IF has_table_privilege('authenticated','public.product_stock_locations','INSERT')
     OR has_table_privilege('authenticated','public.product_stock_locations','UPDATE')
     OR has_table_privilege('authenticated','public.product_stock_locations','DELETE')
     OR has_table_privilege('authenticated','public.inventory_counts','INSERT')
     OR has_table_privilege('authenticated','public.inventory_counts','UPDATE')
     OR has_table_privilege('authenticated','public.inventory_counts','DELETE')
     OR has_table_privilege('authenticated','public.inventory_count_lines','INSERT')
     OR has_table_privilege('authenticated','public.inventory_count_lines','UPDATE')
     OR has_table_privilege('authenticated','public.inventory_count_lines','DELETE')
     OR has_table_privilege('authenticated','public.stock_adjustments','INSERT')
     OR has_table_privilege('authenticated','public.stock_adjustments','UPDATE')
     OR has_table_privilege('authenticated','public.stock_adjustments','DELETE')
     OR has_table_privilege('authenticated','public.inventory_wastage','INSERT')
     OR has_table_privilege('authenticated','public.inventory_wastage','UPDATE')
     OR has_table_privilege('authenticated','public.inventory_wastage','DELETE') THEN
    RAISE EXCEPTION 'ACL-001: authenticated direct DML must be revoked from RPC-owned inventory tables';
  END IF;

  SELECT current_stock INTO v_total_before
  FROM public.products WHERE id=v_product_id;
  SELECT COALESCE((
    SELECT qty FROM public.product_stock_locations
    WHERE product_id=v_product_id AND location_id=v_selected_location_id
  ),0) INTO v_selected_before;
  SELECT COALESCE((
    SELECT qty FROM public.product_stock_locations
    WHERE product_id=v_product_id AND location_id=v_default_location_id
  ),0) INTO v_default_before;
  SELECT COALESCE(SUM(qty),0) INTO v_location_sum
  FROM public.product_stock_locations WHERE product_id=v_product_id;

  IF ABS(COALESCE(v_location_sum,0)-v_total_before) > 0.01 THEN
    RAISE EXCEPTION 'FIXTURE-006: product aggregate and location balances must reconcile before the test';
  END IF;

  IF ABS(v_total_before - COALESCE((
    SELECT SUM(CASE WHEN type='in' THEN qty WHEN type='out' THEN -qty ELSE 0 END)
    FROM public.stock_movements
    WHERE property_id=v_property_id AND product_id=v_product_id
  ),0)) > 0.01 THEN
    RAISE EXCEPTION 'FIXTURE-007: product movement ledger must reconcile before the test';
  END IF;

  SELECT COUNT(*) INTO v_movement_count_before
  FROM public.stock_movements
  WHERE property_id=v_property_id AND product_id=v_product_id;

  -- Adjustment posts once to the selected location, not the default location.
  SELECT * INTO v_adjustment
  FROM public.fn_post_stock_adjustment(
    v_property_id,v_product_id,2.00,'phase3 adjustment contract',
    'phase3-adjustment-request',v_selected_location_id
  );
  SELECT * INTO v_adjustment_retry
  FROM public.fn_post_stock_adjustment(
    v_property_id,v_product_id,2.00,'phase3 adjustment contract',
    'phase3-adjustment-request',v_selected_location_id
  );

  IF v_adjustment.id IS DISTINCT FROM v_adjustment_retry.id THEN
    RAISE EXCEPTION 'IDEMP-001: repeated adjustment request must return the original record';
  END IF;

  SELECT current_stock INTO v_total_after FROM public.products WHERE id=v_product_id;
  SELECT COALESCE(qty,0) INTO v_selected_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_selected_location_id;
  SELECT COALESCE(qty,0) INTO v_default_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_default_location_id;

  IF v_total_after <> v_total_before+2
     OR v_selected_after <> v_selected_before+2
     OR v_default_after <> v_default_before THEN
    RAISE EXCEPTION 'ADJUST-001: adjustment must change aggregate and selected location once, leaving default location unchanged';
  END IF;

  -- Wastage also posts once and preserves the same location ownership.
  SELECT * INTO v_wastage
  FROM public.fn_post_wastage(
    v_property_id,v_product_id,0.50,'phase3 wastage contract',
    'phase3-wastage-request',v_selected_location_id,NULL
  );
  SELECT * INTO v_wastage_retry
  FROM public.fn_post_wastage(
    v_property_id,v_product_id,0.50,'phase3 wastage contract',
    'phase3-wastage-request',v_selected_location_id,NULL
  );

  IF v_wastage.id IS DISTINCT FROM v_wastage_retry.id THEN
    RAISE EXCEPTION 'IDEMP-002: repeated wastage request must return the original record';
  END IF;

  SELECT current_stock INTO v_total_after FROM public.products WHERE id=v_product_id;
  SELECT COALESCE(qty,0) INTO v_selected_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_selected_location_id;
  SELECT COALESCE(qty,0) INTO v_default_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_default_location_id;

  IF v_total_after <> v_total_before+1.50
     OR v_selected_after <> v_selected_before+1.50
     OR v_default_after <> v_default_before THEN
    RAISE EXCEPTION 'WASTAGE-001: wastage must change aggregate and selected location once';
  END IF;

  -- Count creation is idempotent. A later movement occurs before approval; the
  -- snapshot variance is applied to the live balance so that later movement remains.
  v_counted_qty := v_selected_after+3.00;

  SELECT * INTO v_count
  FROM public.fn_create_inventory_count(
    v_property_id,
    v_selected_location_id,
    jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'counted_qty',v_counted_qty
    )),
    'phase3-count-request',
    'phase3 location-aware count'
  );

  SELECT * INTO v_count_retry
  FROM public.fn_create_inventory_count(
    v_property_id,
    v_selected_location_id,
    jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'counted_qty',v_counted_qty
    )),
    'phase3-count-request',
    'phase3 location-aware count'
  );

  IF v_count.id IS DISTINCT FROM v_count_retry.id THEN
    RAISE EXCEPTION 'IDEMP-003: repeated count request must return the original count';
  END IF;

  PERFORM public.fn_post_stock_adjustment(
    v_property_id,v_product_id,1.00,'phase3 concurrent movement test',
    'phase3-between-count-and-approval',v_selected_location_id
  );

  SELECT * INTO v_count_approved
  FROM public.fn_approve_inventory_count(v_count.id);

  SELECT variance INTO v_variance
  FROM public.inventory_count_lines
  WHERE count_id=v_count.id AND product_id=v_product_id;

  IF v_count_approved.status <> 'approved'
     OR v_variance <> 3.00 THEN
    RAISE EXCEPTION 'COUNT-001: approval must post counted minus expected snapshot';
  END IF;

  SELECT current_stock INTO v_total_after FROM public.products WHERE id=v_product_id;
  SELECT COALESCE(qty,0) INTO v_selected_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_selected_location_id;
  SELECT COALESCE(qty,0) INTO v_default_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_default_location_id;
  SELECT COALESCE(SUM(qty),0) INTO v_location_sum
  FROM public.product_stock_locations WHERE product_id=v_product_id;

  IF v_selected_after <> v_counted_qty+1.00
     OR v_default_after <> v_default_before
     OR ABS(v_location_sum-v_total_after) > 0.01 THEN
    RAISE EXCEPTION 'COUNT-002: approved count must apply the snapshot variance to the live location balance and preserve aggregate reconciliation';
  END IF;

  SELECT COUNT(*) INTO v_movement_count_after
  FROM public.stock_movements
  WHERE property_id=v_property_id AND product_id=v_product_id;

  SELECT * INTO v_count_approved_retry
  FROM public.fn_approve_inventory_count(v_count.id);

  IF v_count_approved_retry.status <> 'approved' THEN
    RAISE EXCEPTION 'IDEMP-004: repeat count approval must return the already-approved count';
  END IF;

  IF (SELECT COUNT(*) FROM public.stock_movements
      WHERE property_id=v_property_id AND product_id=v_product_id) <> v_movement_count_after THEN
    RAISE EXCEPTION 'IDEMP-005: repeat count approval must not create another movement';
  END IF;

  -- A legacy aggregate-only posting still uses the installed default-location trigger.
  PERFORM public.fn_apply_stock_movement(
    v_product_id,1.00,'phase3 legacy trigger test','phase3_legacy',NULL
  );
  SELECT current_stock INTO v_total_after FROM public.products WHERE id=v_product_id;
  SELECT COALESCE(qty,0) INTO v_default_after FROM public.product_stock_locations
  WHERE product_id=v_product_id AND location_id=v_default_location_id;
  SELECT COALESCE(SUM(qty),0) INTO v_location_sum
  FROM public.product_stock_locations WHERE product_id=v_product_id;
  IF v_default_after <> v_default_before+1.00
     OR ABS(v_location_sum-v_total_after) > 0.01 THEN
    RAISE EXCEPTION 'TRIGGER-002: legacy aggregate posting must still sync through the retained default-location trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE source_type='adjustment' AND source_id=v_adjustment.id
      AND location_id=v_selected_location_id AND idempotency_key IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE source_type='wastage' AND source_id=v_wastage.id
      AND location_id=v_selected_location_id AND idempotency_key IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE source_type='count' AND source_id=v_count.id
      AND location_id=v_selected_location_id AND source_line_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SOURCE-001: every event must create a source-linked location movement';
  END IF;

  RAISE NOTICE 'Location-aware adjustment, wastage, count, retry and trigger checks passed.';
END
$test$;

ROLLBACK;
\echo 'Location-aware inventory runtime regression completed; fixture mutations rolled back.'
