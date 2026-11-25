-- Phase 1 Stores: location-aware internal stock posting service.
--
-- Additive only. The existing public.fn_apply_stock_movement(uuid, numeric,
-- text, text, uuid) stays untouched for legacy callers, and the
-- products_sync_default_location trigger stays installed. This service marks
-- its own product update in a private transaction table so the trigger skips
-- exactly one default-location delta and never double-applies it.
--
-- Nothing in this migration is callable by a browser role. Public Stores
-- lifecycle RPCs in 20261123092000 are the only entry points.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Private posting context consumed by the default-location trigger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_internal.stores_posting_context (
  transaction_id bigint NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, product_id)
);
REVOKE ALL ON TABLE stock_internal.stores_posting_context
  FROM PUBLIC, anon, authenticated, service_role;

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
    -- A trusted location-aware writer already moved the selected location.
    -- Consume its marker and let that writer own the full delta.
    DELETE FROM stock_internal.stores_posting_context
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

-- Fail closed if the trigger that consumes the private context is missing.
-- Legacy writers keep the original default-location sync behaviour.
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
      AND t.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION
      'Required trigger products_sync_default_location is missing or disabled; refusing to install the Stores posting service';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Location and projection helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_resolve_location(
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

-- Confirms that the aggregate ledger and the per-location projection agree
-- before a Stores document posts. Creates the product default location row if
-- it is missing. Fails closed on pre-existing variance.
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_ensure_projection(
  p_property_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_default_location_id uuid;
  v_default_location_name text;
  v_default_qty numeric;
  v_other_location_qty numeric;
  v_location_total numeric;
  v_ledger_stock numeric;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'Tracked product not found in the selected property';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN sm.type = 'in' THEN sm.qty ELSE -sm.qty END
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

    v_default_qty :=
      v_product.current_stock - COALESCE(v_other_location_qty, 0);

    INSERT INTO public.product_stock_locations(
      property_id, product_id, location_id, qty
    )
    VALUES (
      p_property_id, p_product_id, v_default_location_id,
      GREATEST(0, v_default_qty)
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
END
$function$;

-- Weighted-average unit cost for a product at a location, taken from inbound
-- movement unit costs. Falls back to the catalogue cost_price.
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_weighted_average_cost(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_average numeric;
  v_fallback numeric;
BEGIN
  SELECT CASE
           WHEN SUM(sm.qty) > 0
             THEN SUM(sm.qty * COALESCE(sm.unit_cost, 0)) / SUM(sm.qty)
         END
  INTO v_average
  FROM public.stock_movements sm
  WHERE sm.property_id = p_property_id
    AND sm.product_id = p_product_id
    AND sm.location_id = p_location_id
    AND sm.type = 'in'
    AND sm.unit_cost IS NOT NULL;

  IF v_average IS NOT NULL THEN
    RETURN ROUND(v_average, 6);
  END IF;

  SELECT COALESCE(cost_price, 0)
  INTO v_fallback
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id;

  RETURN ROUND(COALESCE(v_fallback, 0), 6);
END
$function$;

-- Converts an entered quantity to the product base unit using the shared
-- inventory_unit_conversions table. Whole-unit products reject fractions.
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_convert_qty(
  p_property_id uuid,
  p_product_id uuid,
  p_qty numeric,
  p_unit_code text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_base_unit text;
  v_unit_code text;
  v_factor numeric;
  v_allows_fraction boolean;
  v_base_qty numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT base_unit
  INTO v_base_unit
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in the selected property';
  END IF;

  v_unit_code := COALESCE(NULLIF(BTRIM(p_unit_code), ''), v_base_unit);

  IF v_unit_code = v_base_unit THEN
    RETURN ROUND(p_qty, 6);
  END IF;

  SELECT CASE
           WHEN c.from_unit = v_unit_code AND c.to_unit = v_base_unit
             THEN c.factor
           WHEN c.from_unit = v_base_unit AND c.to_unit = v_unit_code
             THEN 1 / c.factor
         END
  INTO v_factor
  FROM public.inventory_unit_conversions c
  WHERE c.from_unit = v_unit_code
    AND c.to_unit = v_base_unit
    AND (c.property_id IS NULL OR c.property_id = p_property_id)
  ORDER BY c.property_id NULLS LAST
  LIMIT 1;

  IF v_factor IS NULL THEN
    SELECT CASE
             WHEN c.from_unit = v_base_unit AND c.to_unit = v_unit_code
               THEN 1 / c.factor
           END
    INTO v_factor
    FROM public.inventory_unit_conversions c
    WHERE c.from_unit = v_base_unit
      AND c.to_unit = v_unit_code
      AND (c.property_id IS NULL OR c.property_id = p_property_id)
    ORDER BY c.property_id NULLS LAST
    LIMIT 1;
  END IF;

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'No unit conversion from % to % is configured',
      v_unit_code, v_base_unit;
  END IF;

  v_base_qty := ROUND(p_qty * v_factor, 6);

  SELECT allows_fraction
  INTO v_allows_fraction
  FROM public.inventory_units
  WHERE code = v_base_unit;

  IF v_allows_fraction IS false AND v_base_qty <> ROUND(v_base_qty, 0) THEN
    RAISE EXCEPTION 'Product % only accepts whole % units', p_product_id, v_base_unit;
  END IF;

  RETURN v_base_qty;
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Single-location aggregate posting (+/- one location)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_post_movement(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_change numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_source_line_key text,
  p_unit_cost numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_location_name text;
  v_location_qty numeric;
  v_policy text;
  v_new_stock numeric;
  v_type text;
  v_idempotency_key text;
BEGIN
  IF p_change IS NULL OR p_change = 0 OR p_change <> ROUND(p_change, 2) THEN
    RAISE EXCEPTION 'Stock change must be non-zero and use the supported 2-decimal precision';
  END IF;

  IF NULLIF(BTRIM(p_source_type), '') IS NULL
     OR p_source_id IS NULL
     OR NULLIF(BTRIM(p_source_line_key), '') IS NULL THEN
    RAISE EXCEPTION 'Stable source identifiers are required for stock posting';
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

  PERFORM stock_internal.fn_stores_ensure_projection(p_property_id, p_product_id);

  v_location_id := stock_internal.fn_stores_resolve_location(
    p_property_id, p_product_id, p_location_id
  );

  IF p_change < 0 THEN
    SELECT COALESCE(
      (SELECT ps.negative_stock_policy
       FROM public.property_settings ps
       WHERE ps.property_id = p_property_id),
      'warn_allow'
    )
    INTO v_policy;

    v_new_stock := v_product.current_stock + p_change;

    IF v_new_stock < 0 AND v_policy = 'block' THEN
      RAISE EXCEPTION 'Insufficient total stock for % (available %, required %)',
        v_product.name, v_product.current_stock, ABS(p_change);
    END IF;
  END IF;

  SELECT name
  INTO v_location_name
  FROM public.inventory_locations
  WHERE id = v_location_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory location does not belong to the selected property';
  END IF;

  INSERT INTO public.product_stock_locations(
    property_id, product_id, location_id, qty
  )
  VALUES (p_property_id, p_product_id, v_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT qty
  INTO v_location_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = v_location_id
  FOR UPDATE;

  IF p_change < 0 AND v_location_qty + p_change < 0 THEN
    RAISE EXCEPTION 'Insufficient stock at the issuing location (available %, required %)',
      v_location_qty, ABS(p_change);
  END IF;

  UPDATE public.product_stock_locations
  SET qty = qty + p_change
  WHERE product_id = p_product_id
    AND location_id = v_location_id;

  -- Marks this transaction so the default-location trigger skips its delta.
  INSERT INTO stock_internal.stores_posting_context(
    transaction_id, product_id, location_id
  )
  VALUES (txid_current(), p_product_id, v_location_id)
  ON CONFLICT (transaction_id, product_id)
  DO UPDATE SET location_id = EXCLUDED.location_id;

  UPDATE public.products
  SET current_stock = current_stock + p_change,
      updated_at = now()
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF EXISTS (
    SELECT 1
    FROM stock_internal.stores_posting_context
    WHERE transaction_id = txid_current()
      AND product_id = p_product_id
  ) THEN
    RAISE EXCEPTION
      'Location sync trigger did not consume its private posting context; stock update rolled back';
  END IF;

  v_type := CASE WHEN p_change > 0 THEN 'in' ELSE 'out' END;
  v_idempotency_key := FORMAT(
    '%s:%s:%s:%s',
    BTRIM(p_source_type), p_source_id, BTRIM(p_source_line_key), v_type
  );

  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE property_id = p_property_id
      AND idempotency_key = v_idempotency_key
  ) THEN
    RAISE EXCEPTION 'Duplicate stock posting for source line %',
      BTRIM(p_source_line_key);
  END IF;

  INSERT INTO public.stock_movements(
    property_id, product_id, type, qty, reason, user_id,
    source_type, source_id, location_id, location_name_snapshot,
    source_line_key, idempotency_key, unit_code, base_qty, unit_cost
  )
  VALUES (
    p_property_id, p_product_id, v_type, ABS(p_change),
    NULLIF(BTRIM(p_reason), ''), auth.uid(),
    BTRIM(p_source_type), p_source_id, v_location_id, v_location_name,
    BTRIM(p_source_line_key), v_idempotency_key,
    v_product.base_unit, ABS(p_change),
    COALESCE(p_unit_cost, v_product.cost_price)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Two-location move (no aggregate change) for non-consuming departments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_post_move(
  p_property_id uuid,
  p_product_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_qty numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_source_line_key text,
  p_unit_cost numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_from_name text;
  v_to_name text;
  v_from_qty numeric;
  v_idempotency_out text;
  v_idempotency_in text;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_qty <> ROUND(p_qty, 2) THEN
    RAISE EXCEPTION 'Move quantity must be positive and use the supported 2-decimal precision';
  END IF;

  IF p_from_location_id IS NULL OR p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'Source and destination locations are required';
  END IF;

  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Source and destination locations must differ';
  END IF;

  IF NULLIF(BTRIM(p_source_type), '') IS NULL
     OR p_source_id IS NULL
     OR NULLIF(BTRIM(p_source_line_key), '') IS NULL THEN
    RAISE EXCEPTION 'Stable source identifiers are required for stock posting';
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

  PERFORM stock_internal.fn_stores_ensure_projection(p_property_id, p_product_id);

  SELECT name
  INTO v_from_name
  FROM public.inventory_locations
  WHERE id = p_from_location_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source location does not belong to the selected property';
  END IF;

  SELECT name
  INTO v_to_name
  FROM public.inventory_locations
  WHERE id = p_to_location_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination location does not belong to the selected property';
  END IF;

  INSERT INTO public.product_stock_locations(
    property_id, product_id, location_id, qty
  )
  VALUES
    (p_property_id, p_product_id, p_from_location_id, 0),
    (p_property_id, p_product_id, p_to_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT qty
  INTO v_from_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_from_location_id
  FOR UPDATE;

  IF v_from_qty < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock at source location (available %, required %)',
      v_from_qty, p_qty;
  END IF;

  UPDATE public.product_stock_locations
  SET qty = qty - p_qty
  WHERE product_id = p_product_id
    AND location_id = p_from_location_id;

  UPDATE public.product_stock_locations
  SET qty = qty + p_qty
  WHERE product_id = p_product_id
    AND location_id = p_to_location_id;

  v_idempotency_out := FORMAT(
    '%s:%s:%s:out', BTRIM(p_source_type), p_source_id, BTRIM(p_source_line_key)
  );
  v_idempotency_in := FORMAT(
    '%s:%s:%s:in', BTRIM(p_source_type), p_source_id, BTRIM(p_source_line_key)
  );

  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE property_id = p_property_id
      AND idempotency_key IN (v_idempotency_out, v_idempotency_in)
  ) THEN
    RAISE EXCEPTION 'Duplicate stock move for source line %',
      BTRIM(p_source_line_key);
  END IF;

  INSERT INTO public.stock_movements(
    property_id, product_id, type, qty, reason, user_id,
    source_type, source_id, location_id, location_name_snapshot,
    source_line_key, idempotency_key, unit_code, base_qty, unit_cost
  )
  VALUES
    (
      p_property_id, p_product_id, 'out', p_qty,
      NULLIF(BTRIM(p_reason), ''), auth.uid(),
      BTRIM(p_source_type), p_source_id, p_from_location_id, v_from_name,
      BTRIM(p_source_line_key), v_idempotency_out,
      v_product.base_unit, p_qty,
      COALESCE(p_unit_cost, v_product.cost_price)
    ),
    (
      p_property_id, p_product_id, 'in', p_qty,
      NULLIF(BTRIM(p_reason), ''), auth.uid(),
      BTRIM(p_source_type), p_source_id, p_to_location_id, v_to_name,
      BTRIM(p_source_line_key), v_idempotency_in,
      v_product.base_unit, p_qty,
      COALESCE(p_unit_cost, v_product.cost_price)
    );
END
$function$;

REVOKE ALL ON FUNCTION stock_internal.fn_stores_resolve_location(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_ensure_projection(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_weighted_average_cost(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_convert_qty(uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_post_movement(
  uuid, uuid, uuid, numeric, text, text, uuid, text, numeric
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_post_move(
  uuid, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
