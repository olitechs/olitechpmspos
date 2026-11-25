-- Phase 2 Stores: guarded transfer lifecycle.
--
-- Stock changes only in dispatch and receive, and every change goes through
-- stock_internal.fn_stores_post_move. Creation, approval-like state changes and
-- cancellation never touch stock.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared permission and read helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_transfer_permissions(p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner boolean := public.is_platform_owner();
BEGIN
  RETURN jsonb_build_object(
    'can_view', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.transfer')
      OR public.fn_employee_has_permission(p_property_id, 'stores.stock.receive')
      OR public.fn_employee_has_permission(p_property_id, 'stores.inventory.view'),
    'can_create', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.transfer'),
    'can_dispatch', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.transfer'),
    'can_receive', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.receive'),
    'can_cancel', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.transfer'),
    'can_mark_overdue', v_owner OR public.fn_employee_has_permission(p_property_id, 'stores.stock.transfer')
      OR public.fn_employee_has_permission(p_property_id, 'stores.stock.receive')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_list_transfers(
  p_property_id uuid,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_overdue_only boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(BTRIM(p_search), '');
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.stock.transfer','stores.stock.receive','stores.inventory.view']
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'document_no', t.document_no,
      'status', t.status,
      'reference', t.reference,
      'notes', t.notes,
      'from_location_id', t.from_location_id,
      'to_location_id', t.to_location_id,
      'from_location_name', f.name,
      'to_location_name', to_loc.name,
      'lines', t.lines,
      'line_count', COALESCE(jsonb_array_length(t.lines), 0),
      'created_at', t.created_at,
      'created_by', t.created_by,
      'expected_at', t.expected_at,
      'dispatched_at', t.dispatched_at,
      'dispatched_by', t.dispatched_by,
      'received_at', t.received_at,
      'received_by', t.received_by,
      'cancelled_at', t.cancelled_at,
      'discrepancies', t.discrepancies,
      'is_overdue', (t.status = 'in_transit' AND t.expected_at < now()) OR t.is_overdue
    ) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM public.stock_transfers
    WHERE property_id = p_property_id
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR status = BTRIM(p_status))
      AND (
        v_search IS NULL
        OR document_no ILIKE '%' || v_search || '%'
        OR COALESCE(reference, '') ILIKE '%' || v_search || '%'
        OR COALESCE(notes, '') ILIKE '%' || v_search || '%'
      )
      AND (
        NOT COALESCE(p_overdue_only, false)
        OR ((status = 'in_transit' AND expected_at < now()) OR is_overdue)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT v_limit OFFSET v_offset
  ) t
  LEFT JOIN public.inventory_locations f ON f.id = t.from_location_id
  LEFT JOIN public.inventory_locations to_loc ON to_loc.id = t.to_location_id;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'limit', v_limit,
    'offset', v_offset,
    'permissions', stock_internal.fn_stores_transfer_permissions(p_property_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_transfer_detail(
  p_property_id uuid,
  p_transfer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v public.stock_transfers%ROWTYPE;
  v_audit jsonb;
  v_from_name text;
  v_to_name text;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.stock.transfer','stores.stock.receive','stores.inventory.view']
  );

  SELECT * INTO v
  FROM public.stock_transfers
  WHERE id = p_transfer_id
    AND property_id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT name INTO v_from_name FROM public.inventory_locations WHERE id = v.from_location_id;
  SELECT name INTO v_to_name FROM public.inventory_locations WHERE id = v.to_location_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM public.stores_document_audit a
  WHERE a.property_id = p_property_id
    AND a.document_type = 'stock_transfer'
    AND a.document_id = p_transfer_id;

  RETURN jsonb_build_object(
    'transfer', to_jsonb(v) || jsonb_build_object(
      'from_location_name', v_from_name,
      'to_location_name', v_to_name,
      'is_overdue', (v.status = 'in_transit' AND v.expected_at < now()) OR v.is_overdue
    ),
    'lines', stock_internal.fn_stores_transfer_lines_json(p_transfer_id),
    'audit', v_audit,
    'permissions', stock_internal.fn_stores_transfer_permissions(p_property_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_transfer_products(
  p_property_id uuid,
  p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows jsonb;
  v_location_name text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.stock.transfer');

  IF p_location_id IS NOT NULL THEN
    SELECT name INTO v_location_name
    FROM public.inventory_locations
    WHERE id = p_location_id
      AND property_id = p_property_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source location not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', p.id,
      'name', p.name,
      'sku', p.sku,
      'category', p.category,
      'base_unit', p.base_unit,
      'on_hand', COALESCE((
        SELECT psl.qty
        FROM public.product_stock_locations psl
        WHERE psl.product_id = p.id
          AND psl.location_id = p_location_id
      ), 0)
    ) ORDER BY p.name), '[]'::jsonb)
  INTO v_rows
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND stock_internal.fn_stores_product_eligible(p_property_id, p.id);

  RETURN jsonb_build_object(
    'rows', v_rows,
    'location_id', p_location_id,
    'location_name', v_location_name
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Document creation. No stock movement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_create_transfer(
  p_property_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_from uuid := NULLIF(p_payload ->> 'from_location_id', '')::uuid;
  v_to uuid := NULLIF(p_payload ->> 'to_location_id', '')::uuid;
  v_reference text := NULLIF(BTRIM(p_payload ->> 'reference'), '');
  v_notes text := NULLIF(BTRIM(p_payload ->> 'notes'), '');
  v_document_no text;
  v_transfer public.stock_transfers%ROWTYPE;
  v_line jsonb;
  v_line_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_lines jsonb := '[]'::jsonb;
  v_line_no integer := 0;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.stock.transfer');

  IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
    RAISE EXCEPTION 'Choose different source and destination locations';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inventory_locations WHERE id = v_from AND property_id = p_property_id)
     OR NOT EXISTS (SELECT 1 FROM public.inventory_locations WHERE id = v_to AND property_id = p_property_id) THEN
    RAISE EXCEPTION 'Transfer locations must belong to this property';
  END IF;

  IF v_from = stock_internal.fn_stores_transit_location(p_property_id)
     OR v_to = stock_internal.fn_stores_transit_location(p_property_id) THEN
    RAISE EXCEPTION 'The in-transit location is reserved for posting';
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_payload -> 'lines', '[]'::jsonb)), 0) = 0 THEN
    RAISE EXCEPTION 'At least one transfer line is required';
  END IF;

  v_document_no := stock_internal.fn_stores_allocate_number(
    p_property_id, 'stores_transfer', 'TRF'
  );

  INSERT INTO public.stock_transfers(
    property_id, document_no, from_location_id, to_location_id,
    status, reference, notes, lines, created_by
  )
  VALUES (
    p_property_id, v_document_no, v_from, v_to,
    'pending', v_reference, v_notes, '[]'::jsonb, auth.uid()
  )
  RETURNING * INTO v_transfer;

  FOR v_line IN
    SELECT x.value
    FROM jsonb_array_elements(COALESCE(p_payload -> 'lines', '[]'::jsonb)) AS x(value)
  LOOP
    v_product_id := NULLIF(v_line ->> 'product_id', '')::uuid;
    v_qty := COALESCE((v_line ->> 'qty')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_qty <> ROUND(v_qty, 2) THEN
      RAISE EXCEPTION 'Each transfer line requires a product and a positive quantity';
    END IF;

    IF NOT stock_internal.fn_stores_product_eligible(p_property_id, v_product_id) THEN
      RAISE EXCEPTION 'Transfer product is not stock tracked in this property';
    END IF;

    v_line_no := v_line_no + 1;
    v_line_id := gen_random_uuid();

    INSERT INTO public.stock_transfer_lines(
      id, property_id, transfer_id, line_no, product_id, qty, unit_cost
    )
    VALUES (
      v_line_id, p_property_id, v_transfer.id, v_line_no, v_product_id, v_qty,
      NULLIF((v_line ->> 'unit_cost')::numeric, 0)
    );

    v_lines := v_lines || jsonb_build_object(
      'line_id', v_line_id,
      'product_id', v_product_id,
      'line_no', v_line_no,
      'qty', v_qty
    );
  END LOOP;

  UPDATE public.stock_transfers
  SET lines = v_lines,
      updated_at = now()
  WHERE id = v_transfer.id
  RETURNING * INTO v_transfer;

  PERFORM stock_internal.fn_stores_transfer_audit(
    p_property_id, v_transfer.id, 'created', NULL, to_jsonb(v_transfer), v_notes
  );

  PERFORM stock_internal.fn_stores_notify_permission(
    p_property_id, 'stores.stock.receive', 'transfer_created', 'stock_transfer',
    v_transfer.id, 'Transfer ' || v_document_no || ' is ready to dispatch',
    'Review the transfer note and dispatch when the goods leave the source location.'
  );

  RETURN public.fn_stores_transfer_detail(p_property_id, v_transfer.id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Dispatch: source -> in-transit. First and only source stock reduction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_dispatch_transfer(
  p_property_id uuid,
  p_transfer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_transfer public.stock_transfers%ROWTYPE;
  v_settings public.stores_settings%ROWTYPE;
  v_transit_id uuid;
  v_line record;
  v_reason text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.stock.transfer');

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending transfers can be dispatched';
  END IF;

  v_before := to_jsonb(v_transfer);
  v_settings := stock_internal.fn_stores_settings_row(p_property_id);
  v_transit_id := stock_internal.fn_stores_transit_location(p_property_id);
  v_reason := 'Dispatch ' || v_transfer.document_no;

  IF v_transfer.from_location_id = v_transit_id OR v_transfer.to_location_id = v_transit_id THEN
    RAISE EXCEPTION 'The in-transit location cannot be a transfer source or destination';
  END IF;

  FOR v_line IN
    SELECT *
    FROM public.stock_transfer_lines
    WHERE transfer_id = p_transfer_id
    ORDER BY line_no
    FOR UPDATE
  LOOP
    PERFORM stock_internal.fn_stores_post_move(
      p_property_id,
      v_line.product_id,
      v_transfer.from_location_id,
      v_transit_id,
      v_line.qty,
      v_reason,
      'stock_transfer',
      p_transfer_id,
      'dispatch:' || v_line.id::text,
      v_line.unit_cost
    );

    UPDATE public.stock_transfer_lines
    SET dispatched_qty = qty,
        updated_at = now()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.stock_transfers
  SET status = 'in_transit',
      dispatched_at = now(),
      dispatched_by = auth.uid(),
      dispatched_by_staff_id = public.current_staff_id(p_property_id),
      expected_at = now() + make_interval(hours => COALESCE(v_settings.transfer_overdue_hours, 24)),
      lines = stock_internal.fn_stores_transfer_lines_json(p_transfer_id),
      updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  v_after := to_jsonb(v_transfer);

  PERFORM stock_internal.fn_stores_transfer_audit(
    p_property_id, p_transfer_id, 'dispatched', v_before, v_after, v_transfer.notes
  );

  PERFORM stock_internal.fn_stores_notify_permission(
    p_property_id, 'stores.stock.receive', 'transfer_dispatched', 'stock_transfer',
    p_transfer_id, 'Transfer ' || v_transfer.document_no || ' is in transit',
    'Confirm receipt when the goods arrive at the destination location.'
  );

  RETURN public.fn_stores_transfer_detail(p_property_id, p_transfer_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Receive: in-transit -> destination. Second physical stock movement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_receive_transfer(
  p_property_id uuid,
  p_transfer_id uuid,
  p_payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_before jsonb;
  v_after jsonb;
  v_transfer public.stock_transfers%ROWTYPE;
  v_settings public.stores_settings%ROWTYPE;
  v_transit_id uuid;
  v_receiver_staff_id uuid;
  v_line_payload jsonb;
  v_line record;
  v_line_id uuid;
  v_received_qty numeric;
  v_discrepancies jsonb := '[]'::jsonb;
  v_reason text;
  v_has_discrepancy boolean := false;
  v_action text;
  v_kind text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.stock.receive');

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_transfer.status NOT IN ('in_transit', 'dispatched') THEN
    RAISE EXCEPTION 'Only in-transit transfers can be received';
  END IF;

  v_settings := stock_internal.fn_stores_settings_row(p_property_id);
  v_receiver_staff_id := public.current_staff_id(p_property_id);

  IF v_settings.segregation_of_duties
     AND NOT public.is_platform_owner()
     AND v_transfer.dispatched_by_staff_id IS NOT NULL
     AND v_receiver_staff_id IS NOT NULL
     AND v_transfer.dispatched_by_staff_id = v_receiver_staff_id THEN
    RAISE EXCEPTION 'The dispatcher cannot confirm receipt when segregation of duties is enabled'
      USING ERRCODE = '42501';
  END IF;

  v_before := to_jsonb(v_transfer);
  v_transit_id := stock_internal.fn_stores_transit_location(p_property_id);
  v_reason := 'Receive ' || v_transfer.document_no;

  IF v_transfer.to_location_id = v_transit_id THEN
    RAISE EXCEPTION 'The in-transit location cannot receive stock';
  END IF;

  UPDATE public.stock_transfer_lines
  SET received_qty = 0,
      updated_at = now()
  WHERE transfer_id = p_transfer_id;

  IF COALESCE(jsonb_array_length(COALESCE(v_payload -> 'lines', '[]'::jsonb)), 0) = 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'line_id', l.id,
      'received_qty', l.qty
    ) ORDER BY l.line_no), '[]'::jsonb)
    INTO v_payload
    FROM public.stock_transfer_lines l
    WHERE l.transfer_id = p_transfer_id;
  ELSE
    IF (
      SELECT COUNT(DISTINCT NULLIF(x.value ->> 'line_id', '')::uuid)
      FROM jsonb_array_elements(v_payload -> 'lines') AS x(value)
    ) <> jsonb_array_length(v_payload -> 'lines') THEN
      RAISE EXCEPTION 'Each transfer line may be received only once';
    END IF;
  END IF;

  FOR v_line_payload IN
    SELECT x.value
    FROM jsonb_array_elements(COALESCE(v_payload -> 'lines', '[]'::jsonb)) AS x(value)
  LOOP
    v_line_id := NULLIF(v_line_payload ->> 'line_id', '')::uuid;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'Each received line requires a stable line_id';
    END IF;

    SELECT * INTO v_line
    FROM public.stock_transfer_lines
    WHERE id = v_line_id
      AND transfer_id = p_transfer_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Received line does not belong to this transfer';
    END IF;

    v_received_qty := COALESCE(
      (v_line_payload ->> 'received_qty')::numeric,
      v_line.qty
    );

    IF v_received_qty < 0 OR v_received_qty <> ROUND(v_received_qty, 2) THEN
      RAISE EXCEPTION 'Received quantity must be zero or positive with 2-decimal precision';
    END IF;

    IF v_received_qty > v_line.qty THEN
      RAISE EXCEPTION 'Received quantity cannot exceed the dispatched quantity';
    END IF;

    UPDATE public.stock_transfer_lines
    SET received_qty = v_received_qty,
        updated_at = now()
    WHERE id = v_line_id;

    IF v_received_qty > 0 THEN
      PERFORM stock_internal.fn_stores_post_move(
        p_property_id,
        v_line.product_id,
        v_transit_id,
        v_transfer.to_location_id,
        v_received_qty,
        v_reason,
        'stock_transfer',
        p_transfer_id,
        'receive:' || v_line.id::text,
        v_line.unit_cost
      );
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'line_id', l.id,
      'product_id', l.product_id,
      'expected_qty', l.qty,
      'received_qty', l.received_qty,
      'difference_qty', l.received_qty - l.qty
    ) ORDER BY l.line_no), '[]'::jsonb),
    COUNT(*) FILTER (WHERE l.received_qty <> l.qty) > 0
  INTO v_discrepancies, v_has_discrepancy
  FROM public.stock_transfer_lines l
  WHERE l.transfer_id = p_transfer_id;

  UPDATE public.stock_transfers
  SET status = CASE WHEN v_has_discrepancy THEN 'discrepancy' ELSE 'completed' END,
      received_at = now(),
      received_by = auth.uid(),
      received_by_staff_id = v_receiver_staff_id,
      discrepancies = v_discrepancies,
      notes = CASE
        WHEN NULLIF(BTRIM(v_payload ->> 'notes'), '') IS NULL THEN v_transfer.notes
        ELSE BTRIM(v_payload ->> 'notes')
      END,
      lines = stock_internal.fn_stores_transfer_lines_json(p_transfer_id),
      updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  v_after := to_jsonb(v_transfer);
  v_action := CASE WHEN v_has_discrepancy THEN 'received_with_discrepancy' ELSE 'received' END;
  v_kind := CASE WHEN v_has_discrepancy THEN 'transfer_discrepancy' ELSE 'transfer_received' END;

  PERFORM stock_internal.fn_stores_transfer_audit(
    p_property_id, p_transfer_id, v_action, v_before, v_after,
    NULLIF(BTRIM(v_payload ->> 'notes'), '')
  );

  IF v_transfer.dispatched_by_staff_id IS NOT NULL THEN
    PERFORM stock_internal.fn_stores_notify_staff(
      p_property_id, v_transfer.dispatched_by_staff_id, v_kind, 'stock_transfer',
      p_transfer_id, 'Transfer ' || v_transfer.document_no ||
        CASE WHEN v_has_discrepancy THEN ' was received with a discrepancy'
             ELSE ' was received' END,
      'Review the confirmed quantities in the transfer note.'
    );
  ELSE
    PERFORM stock_internal.fn_stores_notify_permission(
      p_property_id, 'stores.stock.transfer', v_kind, 'stock_transfer',
      p_transfer_id, 'Transfer ' || v_transfer.document_no ||
        CASE WHEN v_has_discrepancy THEN ' was received with a discrepancy'
             ELSE ' was received' END,
      'Review the confirmed quantities in the transfer note.'
    );
  END IF;

  RETURN public.fn_stores_transfer_detail(p_property_id, p_transfer_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Cancellation and overdue tracking. No stock movement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_cancel_transfer(
  p_property_id uuid,
  p_transfer_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before jsonb;
  v_transfer public.stock_transfers%ROWTYPE;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.stock.transfer');

  SELECT * INTO v_transfer
  FROM public.stock_transfers
  WHERE id = p_transfer_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending transfers can be cancelled';
  END IF;

  v_before := to_jsonb(v_transfer);

  UPDATE public.stock_transfers
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = NULLIF(BTRIM(p_reason), ''),
      updated_at = now()
  WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  PERFORM stock_internal.fn_stores_transfer_audit(
    p_property_id, p_transfer_id, 'cancelled', v_before, to_jsonb(v_transfer), p_reason
  );

  PERFORM stock_internal.fn_stores_notify_permission(
    p_property_id, 'stores.stock.receive', 'transfer_cancelled', 'stock_transfer',
    p_transfer_id, 'Transfer ' || v_transfer.document_no || ' was cancelled', p_reason
  );

  RETURN public.fn_stores_transfer_detail(p_property_id, p_transfer_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_mark_transfers_overdue(p_property_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_transfer record;
  v_before jsonb;
  v_after jsonb;
  v_count integer := 0;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.stock.transfer','stores.stock.receive','stores.inventory.view']
  );

  FOR v_transfer IN
    SELECT *
    FROM public.stock_transfers
    WHERE property_id = p_property_id
      AND status = 'in_transit'
      AND expected_at < now()
      AND NOT is_overdue
    FOR UPDATE
  LOOP
    v_before := to_jsonb(v_transfer);

    UPDATE public.stock_transfers
    SET is_overdue = true,
        overdue_notified_at = now(),
        updated_at = now()
    WHERE id = v_transfer.id
    RETURNING * INTO v_after;

    PERFORM stock_internal.fn_stores_transfer_audit(
      p_property_id, v_transfer.id, 'marked_overdue', v_before, v_after,
      'Expected receipt time passed'
    );

    PERFORM stock_internal.fn_stores_notify_permission(
      p_property_id, 'stores.stock.receive', 'transfer_overdue', 'stock_transfer',
      v_transfer.id, 'Transfer ' || v_transfer.document_no || ' is overdue',
      'Expected receipt time passed. Confirm receipt or investigate the delay.'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Widen read-only configuration lookups for transfer actors. Mutation of
--    settings remains guarded by stores.costcentre.manage in Phase 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_get_settings(p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settings public.stores_settings%ROWTYPE;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.access', 'stores.costcentre.manage', 'stores.stock.transfer',
      'stores.stock.receive', 'stores.inventory.view'
    ]
  );
  v_settings := stock_internal.fn_stores_settings_row(p_property_id);

  RETURN jsonb_build_object(
    'property_id', v_settings.property_id,
    'segregation_of_duties', v_settings.segregation_of_duties,
    'requisition_approval_required', v_settings.requisition_approval_required,
    'direct_issue_enabled', v_settings.direct_issue_enabled,
    'issue_discrepancy_window_hours', v_settings.issue_discrepancy_window_hours,
    'transfer_overdue_hours', v_settings.transfer_overdue_hours,
    'updated_at', v_settings.updated_at,
    'can_manage', public.is_platform_owner()
      OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. Widen the Phase 1 location picker for transfer actors without weakening
--    its property or subscription guard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_list_locations(p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.access', 'stores.requisition.create', 'stores.costcentre.manage',
      'stores.stock.transfer', 'stores.stock.receive', 'stores.inventory.view'
    ]
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', il.id,
    'name', il.name
  ) ORDER BY il.name), '[]'::jsonb)
  INTO v_rows
  FROM public.inventory_locations il
  WHERE il.property_id = p_property_id;

  RETURN jsonb_build_object('rows', v_rows);
END
$function$;

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION stock_internal.fn_stores_transfer_permissions(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_stores_list_transfers(uuid, text, text, boolean, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_transfer_detail(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_transfer_products(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_create_transfer(uuid, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_dispatch_transfer(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_receive_transfer(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_cancel_transfer(uuid, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_mark_transfers_overdue(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_stores_list_transfers(uuid, text, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_transfer_detail(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_transfer_products(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_create_transfer(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_dispatch_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_receive_transfer(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_cancel_transfer(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_mark_transfers_overdue(uuid) TO authenticated;

COMMIT;
