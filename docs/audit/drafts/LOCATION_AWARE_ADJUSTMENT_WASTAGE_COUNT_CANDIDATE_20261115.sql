-- CANDIDATE ONLY — DO NOT APPLY TO PRODUCTION.
-- Proposed migration: location-aware adjustment, wastage and inventory-count posting.
-- Generated from read-only production catalog inspection on 2026-11-15.
-- Must be replayed and runtime-tested on a production-equivalent disposable database first.
--
-- Scope:
--   1. Add a private transaction context so the existing default-location trigger can
--      remain enabled while a trusted location-aware writer updates a selected location.
--   2. Route adjustment, wastage and count creation/approval through one location-aware
--      writer, with source-linked movement rows.
--   3. Enforce Stores entitlement/action authorization inside each public RPC.
--   4. Remove direct client DML paths for the records owned by these RPCs.
--
-- This does NOT migrate POS, GRN, production, transfers, recipe consumption, product
-- import/upsert or generic stock usage. The trigger is intentionally NOT dropped.

BEGIN;

CREATE SCHEMA IF NOT EXISTS stock_internal;
REVOKE ALL ON SCHEMA stock_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS stock_internal.location_posting_context (
  transaction_id bigint NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, product_id)
);
REVOKE ALL ON TABLE stock_internal.location_posting_context
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.inventory_count_lines
  ADD COLUMN IF NOT EXISTS location_id uuid;

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.inventory_wastage
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.inventory_counts
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS stock_adjustments_property_request_key
  ON public.stock_adjustments(property_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_wastage_property_request_key
  ON public.inventory_wastage(property_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_property_request_key
  ON public.inventory_counts(property_id, request_key)
  WHERE request_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.inventory_count_lines'::regclass
      AND conname = 'inventory_count_lines_location_id_fkey'
  ) THEN
    ALTER TABLE public.inventory_count_lines
      ADD CONSTRAINT inventory_count_lines_location_id_fkey
      FOREIGN KEY (location_id)
      REFERENCES public.inventory_locations(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Production currently has no duplicate (count_id, product_id) lines.
-- Keep one physical-count line per product in a count.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_lines_count_product_key
  ON public.inventory_count_lines(count_id, product_id);

-- Keep the existing non-negative location-balance constraint. Location-specific
-- adjustment/wastage operations cannot overdraw the selected location; warn_allow
-- remains available to aggregate-only legacy flows. This avoids changing the behavior
-- of POS/GRN/transfer/product-import writers before their own migration phases.

-- Keep products_sync_default_location installed. The trusted location-aware writer
-- marks its product update in a private table; this trigger consumes that marker and
-- skips only its own default-location delta for that one product update. All legacy
-- writers continue through the original default-location sync path.
CREATE OR REPLACE FUNCTION public.fn_sync_product_default_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
  v_delta numeric;
  v_context_location_id uuid;
BEGIN
  IF NEW.current_stock IS DISTINCT FROM OLD.current_stock THEN
    DELETE FROM stock_internal.location_posting_context
    WHERE transaction_id = txid_current()
      AND product_id = NEW.id
    RETURNING location_id INTO v_context_location_id;

    IF FOUND THEN
      RETURN NEW;
    END IF;

    v_delta := COALESCE(NEW.current_stock, 0) - COALESCE(OLD.current_stock, 0);

    INSERT INTO public.inventory_locations(property_id, name)
    VALUES (
      NEW.property_id,
      COALESCE(NULLIF(BTRIM(NEW.location), ''), 'Main Store')
    )
    ON CONFLICT (property_id, name) DO NOTHING;

    SELECT id
    INTO v_location_id
    FROM public.inventory_locations
    WHERE property_id = NEW.property_id
      AND name = COALESCE(NULLIF(BTRIM(NEW.location), ''), 'Main Store')
    LIMIT 1;

    INSERT INTO public.product_stock_locations(
      property_id, product_id, location_id, qty
    )
    VALUES (
      NEW.property_id, NEW.id, v_location_id,
      GREATEST(0, COALESCE(NEW.current_stock, 0))
    )
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET qty = GREATEST(
      0,
      public.product_stock_locations.qty + v_delta
    );
  END IF;

  RETURN NEW;
END
$function$;

-- Fail closed if the trigger that consumes the private context is absent or disabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'products'
      AND t.tgname = 'products_sync_default_location'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION
      'Required trigger products_sync_default_location is missing or disabled; refusing location-aware posting setup';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION stock_internal.fn_resolve_product_location(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_location_name text;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in the selected property';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT id
    INTO v_location_id
    FROM public.inventory_locations
    WHERE id = p_location_id
      AND property_id = p_property_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory location does not belong to the selected property';
    END IF;

    RETURN v_location_id;
  END IF;

  v_location_name :=
    COALESCE(NULLIF(BTRIM(v_product.location), ''), 'Main Store');

  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, v_location_name)
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = v_location_name
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve the product default inventory location';
  END IF;

  RETURN v_location_id;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_post_stock_movement_at_location(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_change numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_source_line_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_name text;
  v_location_qty numeric;
  v_default_location_id uuid;
  v_default_location_name text;
  v_default_qty numeric;
  v_other_location_qty numeric;
  v_location_total numeric;
  v_ledger_stock numeric;
  v_policy text;
  v_new_stock numeric;
  v_idempotency_key text;
BEGIN
  IF p_change IS NULL OR p_change = 0 OR p_change <> ROUND(p_change, 2) THEN
    RAISE EXCEPTION 'Stock change must be non-zero and use the supported 2-decimal precision';
  END IF;

  IF p_location_id IS NULL
     OR NULLIF(BTRIM(p_source_type), '') IS NULL
     OR p_source_id IS NULL
     OR NULLIF(BTRIM(p_source_line_key), '') IS NULL THEN
    RAISE EXCEPTION 'Location and stable source identifiers are required for stock posting';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in the selected property';
  END IF;

  IF NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'This product is not configured for stock tracking';
  END IF;

  -- Do not compound a pre-existing ledger discrepancy. The live catalog currently
  -- contains one known product-level variance; that product must be physically
  -- reconciled before any new location-aware posting can proceed.
  SELECT COALESCE(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.qty
      WHEN sm.type = 'out' THEN -sm.qty
      ELSE 0
    END
  ), 0)
  INTO v_ledger_stock
  FROM public.stock_movements sm
  WHERE sm.property_id = p_property_id
    AND sm.product_id = p_product_id;

  IF ABS(v_ledger_stock - v_product.current_stock) > 0.01 THEN
    RAISE EXCEPTION
      'Stock ledger does not reconcile for %; perform a verified stocktake before posting',
      v_product.name;
  END IF;

  -- Ensure the default-location projection exists before skipping the trigger's
  -- automatic update. If it is missing, seed it as the residual between the
  -- product aggregate and all existing non-default location balances.
  v_default_location_name :=
    COALESCE(NULLIF(BTRIM(v_product.location), ''), 'Main Store');

  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, v_default_location_name)
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id
  INTO v_default_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = v_default_location_name
  FOR UPDATE;

  SELECT qty
  INTO v_default_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = v_default_location_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(SUM(qty), 0)
    INTO v_other_location_qty
    FROM public.product_stock_locations
    WHERE product_id = p_product_id
      AND location_id <> v_default_location_id;

    v_default_qty := v_product.current_stock - COALESCE(v_other_location_qty, 0);

    INSERT INTO public.product_stock_locations(
      property_id, product_id, location_id, qty
    )
    VALUES (
      p_property_id, p_product_id, v_default_location_id, v_default_qty
    )
    ON CONFLICT (product_id, location_id) DO NOTHING;
  END IF;

  SELECT COALESCE(SUM(qty), 0)
  INTO v_location_total
  FROM public.product_stock_locations
  WHERE product_id = p_product_id;

  IF ABS(v_location_total - v_product.current_stock) > 0.01 THEN
    RAISE EXCEPTION
      'Product and location balances do not reconcile; resolve the existing variance before posting';
  END IF;

  SELECT COALESCE(
    (
      SELECT ps.negative_stock_policy
      FROM public.property_settings ps
      WHERE ps.property_id = p_property_id
    ),
    'warn_allow'
  )
  INTO v_policy;

  v_new_stock := v_product.current_stock + p_change;

  IF p_change < 0 AND v_new_stock < 0 AND v_policy = 'block' THEN
    RAISE EXCEPTION 'Insufficient total stock for % (available %, required %)',
      v_product.name, v_product.current_stock, ABS(p_change);
  END IF;

  SELECT name
  INTO v_location_name
  FROM public.inventory_locations
  WHERE id = p_location_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory location does not belong to the selected property';
  END IF;

  INSERT INTO public.product_stock_locations(
    property_id, product_id, location_id, qty
  )
  VALUES (p_property_id, p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT qty
  INTO v_location_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF p_change < 0 AND v_location_qty + p_change < 0 THEN
    RAISE EXCEPTION 'Insufficient stock at selected location (available %, required %)',
      v_location_qty, ABS(p_change);
  END IF;

  -- The private context is consumed by the still-enabled AFTER UPDATE trigger.
  -- This prevents that trigger from applying the same delta to the default location.
  UPDATE public.product_stock_locations
  SET qty = qty + p_change
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  INSERT INTO stock_internal.location_posting_context(
    transaction_id, product_id, location_id
  )
  VALUES (txid_current(), p_product_id, p_location_id)
  ON CONFLICT (transaction_id, product_id)
  DO UPDATE SET location_id = EXCLUDED.location_id;

  UPDATE public.products
  SET current_stock = current_stock + p_change,
      updated_at = now()
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF EXISTS (
    SELECT 1
    FROM stock_internal.location_posting_context
    WHERE transaction_id = txid_current()
      AND product_id = p_product_id
  ) THEN
    RAISE EXCEPTION
      'Location sync trigger did not consume its private posting context; stock update rolled back';
  END IF;

  v_idempotency_key :=
    FORMAT('%s:%s:%s', p_source_type, p_source_id, p_source_line_key);

  INSERT INTO public.stock_movements(
    property_id,
    product_id,
    type,
    qty,
    reason,
    user_id,
    source_type,
    source_id,
    location_id,
    location_name_snapshot,
    source_line_key,
    idempotency_key,
    unit_code,
    base_qty,
    unit_cost
  )
  VALUES (
    p_property_id,
    p_product_id,
    CASE WHEN p_change > 0 THEN 'in' ELSE 'out' END,
    ABS(p_change),
    NULLIF(BTRIM(p_reason), ''),
    auth.uid(),
    p_source_type,
    p_source_id,
    p_location_id,
    v_location_name,
    p_source_line_key,
    v_idempotency_key,
    v_product.base_unit,
    ABS(p_change),
    v_product.cost_price
  );
END
$function$;

REVOKE ALL ON FUNCTION stock_internal.fn_resolve_product_location(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_post_stock_movement_at_location(
  uuid, uuid, uuid, numeric, text, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Replace the old RPC signature so every new adjustment supplies a stable
-- request key. The frontend is updated in the same commit.
DROP FUNCTION IF EXISTS public.fn_post_stock_adjustment(uuid, uuid, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.fn_post_stock_adjustment(
  p_property_id uuid,
  p_product_id uuid,
  p_change numeric,
  p_reason text,
  p_request_key text DEFAULT NULL::text,
  p_location_id uuid DEFAULT NULL::uuid
)
RETURNS public.stock_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_adjustment public.stock_adjustments%ROWTYPE;
  v_fingerprint text;
  v_request_key text;
BEGIN
  IF NOT (
    public.is_platform_owner()
    OR public.is_member_of_property(p_property_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;

  IF NOT public.can_store_write(p_property_id, NULL) THEN
    RAISE EXCEPTION 'Stores access and an authorized stock role are required';
  END IF;

  IF p_request_key IS NOT NULL
     AND (NULLIF(BTRIM(p_request_key), '') IS NULL OR LENGTH(BTRIM(p_request_key)) > 128) THEN
    RAISE EXCEPTION 'Request key must contain 1–128 non-whitespace characters';
  END IF;
  v_request_key :=
    COALESCE(NULLIF(BTRIM(p_request_key), ''), 'legacy:' || gen_random_uuid()::text);

  IF p_change IS NULL
     OR p_change = 0
     OR p_change <> ROUND(p_change, 2)
     OR NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Adjustment quantity (up to 2 decimals) and reason are required';
  END IF;

  v_fingerprint := MD5(JSONB_BUILD_OBJECT(
    'product_id', p_product_id,
    'change', p_change,
    'reason', BTRIM(p_reason),
    'location_id', p_location_id
  )::text);

  SELECT *
  INTO v_adjustment
  FROM public.stock_adjustments
  WHERE property_id = p_property_id
    AND request_key = v_request_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_adjustment.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request key was already used with different adjustment details';
    END IF;
    RETURN v_adjustment;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'Tracked product not found in the selected property';
  END IF;

  v_location_id :=
    stock_internal.fn_resolve_product_location(
      p_property_id, p_product_id, p_location_id
    );

  INSERT INTO public.stock_adjustments(
    property_id, product_id, location_id, change_qty, reason, created_by,
    request_key, request_fingerprint
  )
  VALUES (
    p_property_id, p_product_id, v_location_id, p_change,
    BTRIM(p_reason), auth.uid(), v_request_key, v_fingerprint
  )
  ON CONFLICT (property_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_adjustment;

  IF NOT FOUND THEN
    SELECT *
    INTO v_adjustment
    FROM public.stock_adjustments
    WHERE property_id = p_property_id
      AND request_key = v_request_key
    FOR UPDATE;

    IF NOT FOUND OR v_adjustment.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Adjustment request key conflict';
    END IF;
    RETURN v_adjustment;
  END IF;

  PERFORM stock_internal.fn_post_stock_movement_at_location(
    p_property_id, p_product_id, v_location_id, p_change,
    p_reason, 'adjustment', v_adjustment.id, 'adjustment'
  );

  RETURN v_adjustment;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_post_stock_adjustment(
  uuid, uuid, numeric, text, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_post_stock_adjustment(
  uuid, uuid, numeric, text, text, uuid
) TO authenticated, service_role;

-- Replace the old RPC signature with a stable request key for safe retries.
DROP FUNCTION IF EXISTS public.fn_post_wastage(uuid, uuid, numeric, text, uuid, date);

CREATE OR REPLACE FUNCTION public.fn_post_wastage(
  p_property_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_request_key text DEFAULT NULL::text,
  p_location_id uuid DEFAULT NULL::uuid,
  p_expiry_date date DEFAULT NULL::date
)
RETURNS public.inventory_wastage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_wastage public.inventory_wastage%ROWTYPE;
  v_fingerprint text;
  v_request_key text;
BEGIN
  IF NOT (
    public.is_platform_owner()
    OR public.is_member_of_property(p_property_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;

  IF NOT public.can_store_write(p_property_id, NULL) THEN
    RAISE EXCEPTION 'Stores access and an authorized stock role are required';
  END IF;

  IF p_request_key IS NOT NULL
     AND (NULLIF(BTRIM(p_request_key), '') IS NULL OR LENGTH(BTRIM(p_request_key)) > 128) THEN
    RAISE EXCEPTION 'Request key must contain 1–128 non-whitespace characters';
  END IF;
  v_request_key :=
    COALESCE(NULLIF(BTRIM(p_request_key), ''), 'legacy:' || gen_random_uuid()::text);

  IF p_quantity IS NULL
     OR p_quantity <= 0
     OR p_quantity <> ROUND(p_quantity, 2)
     OR NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Wastage quantity (up to 2 decimals) and reason are required';
  END IF;

  v_fingerprint := MD5(JSONB_BUILD_OBJECT(
    'product_id', p_product_id,
    'quantity', p_quantity,
    'reason', BTRIM(p_reason),
    'location_id', p_location_id,
    'expiry_date', p_expiry_date
  )::text);

  SELECT *
  INTO v_wastage
  FROM public.inventory_wastage
  WHERE property_id = p_property_id
    AND request_key = v_request_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_wastage.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request key was already used with different wastage details';
    END IF;
    RETURN v_wastage;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'Tracked product not found in the selected property';
  END IF;

  v_location_id :=
    stock_internal.fn_resolve_product_location(
      p_property_id, p_product_id, p_location_id
    );

  INSERT INTO public.inventory_wastage(
    property_id, product_id, location_id, quantity, reason,
    expiry_date, created_by, request_key, request_fingerprint
  )
  VALUES (
    p_property_id, p_product_id, v_location_id, p_quantity,
    BTRIM(p_reason), p_expiry_date, auth.uid(),
    v_request_key, v_fingerprint
  )
  ON CONFLICT (property_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_wastage;

  IF NOT FOUND THEN
    SELECT *
    INTO v_wastage
    FROM public.inventory_wastage
    WHERE property_id = p_property_id
      AND request_key = v_request_key
    FOR UPDATE;

    IF NOT FOUND OR v_wastage.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Wastage request key conflict';
    END IF;
    RETURN v_wastage;
  END IF;

  PERFORM stock_internal.fn_post_stock_movement_at_location(
    p_property_id, p_product_id, v_location_id, -p_quantity,
    p_reason, 'wastage', v_wastage.id, 'wastage'
  );

  RETURN v_wastage;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_post_wastage(
  uuid, uuid, numeric, text, text, uuid, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_post_wastage(
  uuid, uuid, numeric, text, text, uuid, date
) TO authenticated, service_role;

-- Replace the old count-creation RPC with request-key deduplication.
DROP FUNCTION IF EXISTS public.fn_create_inventory_count(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.fn_create_inventory_count(
  p_property_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_request_key text DEFAULT NULL::text,
  p_reference text DEFAULT NULL::text
)
RETURNS public.inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count public.inventory_counts%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_line jsonb;
  v_product_id uuid;
  v_location_id uuid;
  v_counted_qty numeric;
  v_expected_qty numeric;
  v_seen_products uuid[] := ARRAY[]::uuid[];
  v_line_count integer := 0;
  v_fingerprint text;
  v_request_key text;
BEGIN
  IF NOT (
    public.is_platform_owner()
    OR public.is_member_of_property(p_property_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;

  IF NOT public.can_store_write(p_property_id, NULL) THEN
    RAISE EXCEPTION 'Stores access and an authorized stock role are required';
  END IF;

  IF p_request_key IS NOT NULL
     AND (NULLIF(BTRIM(p_request_key), '') IS NULL OR LENGTH(BTRIM(p_request_key)) > 128) THEN
    RAISE EXCEPTION 'Request key must contain 1–128 non-whitespace characters';
  END IF;
  v_request_key :=
    COALESCE(NULLIF(BTRIM(p_request_key), ''), 'legacy:' || gen_random_uuid()::text);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Inventory count lines must be a non-empty JSON array';
  END IF;

  IF p_location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.inventory_locations
       WHERE id = p_location_id
         AND property_id = p_property_id
     ) THEN
    RAISE EXCEPTION 'Inventory location does not belong to the selected property';
  END IF;

  v_fingerprint := MD5(JSONB_BUILD_OBJECT(
    'location_id', p_location_id,
    'reference', NULLIF(BTRIM(p_reference), ''),
    'lines', p_lines
  )::text);

  SELECT *
  INTO v_count
  FROM public.inventory_counts
  WHERE property_id = p_property_id
    AND request_key = v_request_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_count.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request key was already used with different count details';
    END IF;
    RETURN v_count;
  END IF;

  INSERT INTO public.inventory_counts(
    property_id, location_id, reference, counted_by,
    request_key, request_fingerprint
  )
  VALUES (
    p_property_id, p_location_id,
    NULLIF(BTRIM(p_reference), ''), auth.uid(),
    v_request_key, v_fingerprint
  )
  ON CONFLICT (property_id, request_key) WHERE request_key IS NOT NULL
  DO NOTHING
  RETURNING * INTO v_count;

  IF NOT FOUND THEN
    SELECT *
    INTO v_count
    FROM public.inventory_counts
    WHERE property_id = p_property_id
      AND request_key = v_request_key
    FOR UPDATE;

    IF NOT FOUND OR v_count.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Inventory count request key conflict';
    END IF;
    RETURN v_count;
  END IF;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_counted_qty := COALESCE(NULLIF(v_line->>'counted_qty', '')::numeric, 0);

    IF v_product_id IS NULL
       OR v_counted_qty < 0
       OR v_counted_qty <> ROUND(v_counted_qty, 2) THEN
      RAISE EXCEPTION 'Each count line requires a product and a non-negative quantity up to 2 decimals';
    END IF;

    IF v_product_id = ANY(v_seen_products) THEN
      RAISE EXCEPTION 'A product may appear only once in an inventory count';
    END IF;
    v_seen_products := ARRAY_APPEND(v_seen_products, v_product_id);

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
      AND property_id = p_property_id;

    IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
      RAISE EXCEPTION 'Every count line must reference a tracked product in the selected property';
    END IF;

    v_location_id :=
      stock_internal.fn_resolve_product_location(
        p_property_id, v_product_id, p_location_id
      );

    SELECT COALESCE(qty, 0)
    INTO v_expected_qty
    FROM public.product_stock_locations
    WHERE product_id = v_product_id
      AND location_id = v_location_id;

    INSERT INTO public.inventory_count_lines(
      count_id, product_id, location_id, expected_qty, counted_qty
    )
    VALUES (
      v_count.id, v_product_id, v_location_id,
      COALESCE(v_expected_qty, 0), v_counted_qty
    );

    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'At least one inventory count line is required';
  END IF;

  UPDATE public.inventory_counts
  SET status = 'submitted'
  WHERE id = v_count.id
  RETURNING * INTO v_count;

  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_create_inventory_count(
  uuid, uuid, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_inventory_count(
  uuid, uuid, jsonb, text, text
) TO authenticated, service_role;

-- Approval is a one-way transition. The applied variance is calculated against
-- the live location balance at approval time (not the potentially stale count-start
-- snapshot), then stored in inventory_count_lines.variance. expected_qty is retained
-- as the original snapshot for audit.
CREATE OR REPLACE FUNCTION public.fn_approve_inventory_count(
  p_count_id uuid
)
RETURNS public.inventory_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count public.inventory_counts%ROWTYPE;
  v_line record;
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_current_qty numeric;
  v_applied_variance numeric;
BEGIN
  SELECT *
  INTO v_count
  FROM public.inventory_counts
  WHERE id = p_count_id
  FOR UPDATE;

  IF NOT FOUND
     OR NOT (
       public.is_platform_owner()
       OR public.is_member_of_property(v_count.property_id)
     ) THEN
    RAISE EXCEPTION 'Count not found or not authorized';
  END IF;

  IF NOT public.can_store_write(v_count.property_id, NULL) THEN
    RAISE EXCEPTION 'Stores access and an authorized stock role are required';
  END IF;

  IF v_count.status = 'approved' THEN
    RETURN v_count;
  END IF;

  IF v_count.status <> 'submitted' THEN
    RAISE EXCEPTION 'Count is not awaiting approval';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.inventory_count_lines
    WHERE count_id = v_count.id
    ORDER BY product_id
    FOR UPDATE
  LOOP
    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_line.product_id
      AND property_id = v_count.property_id
    FOR UPDATE;

    IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
      RAISE EXCEPTION 'Count contains a missing or untracked product';
    END IF;

    v_location_id :=
      stock_internal.fn_resolve_product_location(
        v_count.property_id,
        v_line.product_id,
        COALESCE(v_line.location_id, v_count.location_id)
      );

    SELECT COALESCE(qty, 0)
    INTO v_current_qty
    FROM public.product_stock_locations
    WHERE product_id = v_line.product_id
      AND location_id = v_location_id
    FOR UPDATE;

    v_applied_variance :=
      ROUND(v_line.counted_qty - COALESCE(v_current_qty, 0), 2);

    UPDATE public.inventory_count_lines
    SET location_id = v_location_id,
        variance = v_applied_variance
    WHERE id = v_line.id;

    IF v_applied_variance <> 0 THEN
      PERFORM stock_internal.fn_post_stock_movement_at_location(
        v_count.property_id,
        v_line.product_id,
        v_location_id,
        v_applied_variance,
        'Inventory count variance',
        'count',
        v_count.id,
        v_line.id::text
      );
    END IF;
  END LOOP;

  UPDATE public.inventory_counts
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now()
  WHERE id = v_count.id
  RETURNING * INTO v_count;

  RETURN v_count;
END
$function$;

-- RPCs above are the only intended client write paths for these records.
-- Read privileges are not changed; service_role and postgres privileges are retained.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.product_stock_locations,
  public.inventory_counts,
  public.inventory_count_lines,
  public.stock_adjustments,
  public.inventory_wastage
FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Post-apply checks required on a disposable production-equivalent database:
-- 1. has_table_privilege('authenticated', ..., 'INSERT'/'UPDATE'/'DELETE') is false
--    for all five protected tables.
-- 2. products_sync_default_location remains present and enabled.
-- 3. A location-aware adjustment/wastage/count posts one movement and one location
--    delta; the trigger consumes the private context and does not apply a second delta.
-- 4. A legacy fn_apply_stock_movement call without private context still syncs the
--    product default location through the trigger.
-- 5. block rejects negative aggregate stock; all location-specific adjustment and
--    wastage events reject a negative selected-location balance under the existing
--    product_stock_locations non-negative constraint. warn_allow remains available
--    to aggregate-only legacy flows until their own migration phases.
-- 6. Store entitlement, role, tenant, count status, duplicate line, and retry cases
--    are tested under authenticated identities.
