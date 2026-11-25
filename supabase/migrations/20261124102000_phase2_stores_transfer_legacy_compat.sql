-- Phase 2 Stores: legacy transfer RPC compatibility.
--
-- Signatures are preserved for any existing caller, but the stock path is no
-- longer a direct product_stock_locations update. Both functions delegate to
-- the guarded, ledger-backed Phase 2 lifecycle.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_stock_transfer(
  p_property_id uuid,
  p_from uuid,
  p_to uuid,
  p_lines jsonb,
  p_reference text DEFAULT NULL::text
)
RETURNS stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_lines jsonb;
  v_result jsonb;
  v_transfer stock_transfers;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', x.value ->> 'product_id',
      'qty', COALESCE((x.value ->> 'qty')::numeric, 0)
    )), '[]'::jsonb)
  INTO v_lines
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS x(value);

  v_result := public.fn_stores_create_transfer(
    p_property_id,
    jsonb_build_object(
      'from_location_id', p_from,
      'to_location_id', p_to,
      'lines', v_lines,
      'reference', p_reference
    )
  );

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = (v_result -> 'transfer' ->> 'id')::uuid;

  RETURN v_transfer;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_complete_stock_transfer(p_transfer_id uuid)
RETURNS stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_property_id uuid;
  v_result jsonb;
  v_transfer stock_transfers;
BEGIN
  SELECT property_id INTO v_property_id
  FROM public.stock_transfers
  WHERE id = p_transfer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  v_result := public.fn_stores_dispatch_transfer(v_property_id, p_transfer_id);
  v_result := public.fn_stores_receive_transfer(v_property_id, p_transfer_id, '{}'::jsonb);

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id;

  RETURN v_transfer;
END
$function$;

COMMIT;
