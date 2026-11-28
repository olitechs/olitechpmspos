-- Forward fix for installations where the original Stores posting migration
-- was already recorded before the private schema bootstrap and missing-source
-- stock guard were included.
BEGIN;

CREATE SCHEMA IF NOT EXISTS stock_internal;
REVOKE ALL ON SCHEMA stock_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA stock_internal TO service_role;

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

  IF NOT FOUND OR v_from_qty IS NULL OR v_from_qty < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock at source location (available %, required %)',
      COALESCE(v_from_qty, 0), p_qty;
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

REVOKE ALL ON FUNCTION stock_internal.fn_stores_post_move(
  uuid, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
