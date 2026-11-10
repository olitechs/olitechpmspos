-- Make minibar consumption safe for authenticated property members while keeping
-- the underlying stock movement RPC private to trusted database routines.
CREATE OR REPLACE FUNCTION public.fn_post_minibar_consumption(
  p_property_id uuid,
  p_reservation_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_res public.reservations;
  v_product public.products;
  v_charge public.folio_charges;
  v_total numeric(12,2);
  v_description text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING errcode = '42501';
  END IF;
  IF p_property_id IS NULL
    OR NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Access denied to this property.' USING errcode = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.' USING errcode = '22023';
  END IF;

  SELECT * INTO v_res
  FROM public.reservations
  WHERE id = p_reservation_id AND property_id = p_property_id
  FOR UPDATE;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Guest reservation not found for this property.';
  END IF;
  IF v_res.status::text <> 'checked-in' THEN
    RAISE EXCEPTION 'Minibar charges can only be posted to an in-house guest.';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND property_id = p_property_id
  FOR UPDATE;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Minibar product not found for this property.';
  END IF;
  IF v_product.selling_price IS NULL OR v_product.selling_price <= 0 THEN
    RAISE EXCEPTION 'Set a valid selling price for this product before posting consumption.';
  END IF;
  IF v_product.current_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %.',
      v_product.name, v_product.current_stock, p_quantity;
  END IF;

  v_total := round(v_product.selling_price * p_quantity, 2);
  v_description := 'Minibar · ' || v_product.name || ' × ' ||
    trim(to_char(p_quantity, 'FM999999990.##'));
  IF nullif(trim(p_notes), '') IS NOT NULL THEN
    v_description := v_description || ' — ' || left(trim(p_notes), 240);
  END IF;

  -- This nested function intentionally remains unavailable to direct client calls.
  -- SECURITY DEFINER lets this guarded RPC call it within the same transaction.
  PERFORM public.fn_apply_stock_movement(
    p_product_id,
    -p_quantity,
    'Minibar consumption · ' || v_res.guest_name,
    'minibar_consumption',
    p_reservation_id
  );

  INSERT INTO public.folio_charges(property_id, reservation_id, source, description, amount)
  VALUES (p_property_id, p_reservation_id, 'other', v_description, v_total)
  RETURNING * INTO v_charge;

  RETURN jsonb_build_object(
    'charge_id', v_charge.id,
    'reservation_id', v_res.id,
    'product_id', v_product.id,
    'product_name', v_product.name,
    'quantity', p_quantity,
    'unit_price', v_product.selling_price,
    'amount', v_total,
    'created_at', v_charge.created_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_post_minibar_consumption(uuid, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_post_minibar_consumption(uuid, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_post_minibar_consumption(uuid, uuid, uuid, numeric, text) TO authenticated;
