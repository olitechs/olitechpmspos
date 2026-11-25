-- Phase 1 Stores lifecycle, part 3: issue notes.
--
-- This is the only Phase 1 lifecycle file that changes stock. Issue posting
-- and void reversal go through the location-aware service in
-- 20261123091000_phase1_stores_posting_service.sql. Confirming a receipt
-- records acknowledgement and discrepancies but posts no stock.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Issue-note payload
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_issue_payload(
  p_property_id uuid,
  p_issue_note_id uuid,
  p_include_costs boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', n.id,
    'issue_no', n.issue_no,
    'status', n.status,
    'requisition_id', n.requisition_id,
    'requisition_no', r.req_no,
    'cost_centre_id', n.cost_centre_id,
    'cost_centre_name', cc.name,
    'consumes_on_issue', cc.consumes_on_issue,
    'from_location_id', n.from_location_id,
    'from_location_name', fl.name,
    'to_location_id', n.to_location_id,
    'to_location_name', tl.name,
    'issued_by', n.issued_by,
    'issued_by_name', ip.full_name,
    'issued_at', n.issued_at,
    'received_by', n.received_by,
    'received_by_name', rp.full_name,
    'received_at', n.received_at,
    'voided_by', n.voided_by,
    'voided_at', n.voided_at,
    'void_reason', n.void_reason,
    'notes', n.notes,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'line_count', (
      SELECT COUNT(*) FROM public.issue_note_lines l WHERE l.issue_note_id = n.id
    ),
    'total_cost', CASE WHEN p_include_costs THEN COALESCE((
      SELECT SUM(l.total_cost) FROM public.issue_note_lines l WHERE l.issue_note_id = n.id
    ), 0) END,
    'lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'requisition_line_id', l.requisition_line_id,
          'product_id', l.product_id,
          'product_name', p.name,
          'sku', p.sku,
          'qty', l.qty,
          'received_qty', l.received_qty,
          'discrepancy_qty', l.discrepancy_qty,
          'discrepancy_reason', l.discrepancy_reason,
          'unit_code', l.unit_code,
          'base_unit', p.base_unit
        )
        || CASE WHEN p_include_costs THEN jsonb_build_object(
          'unit_cost', l.unit_cost,
          'total_cost', l.total_cost
        ) ELSE '{}'::jsonb END
        ORDER BY p.name
      )
      FROM public.issue_note_lines l
      JOIN public.products p ON p.id = l.product_id
      WHERE l.issue_note_id = n.id
    ), '[]'::jsonb)
  )
  FROM public.issue_notes n
  JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
  LEFT JOIN public.requisitions r ON r.id = n.requisition_id
  LEFT JOIN public.inventory_locations fl ON fl.id = n.from_location_id
  LEFT JOIN public.inventory_locations tl ON tl.id = n.to_location_id
  LEFT JOIN public.profiles ip ON ip.id = n.issued_by
  LEFT JOIN public.profiles rp ON rp.id = n.received_by
  WHERE n.property_id = p_property_id
    AND n.id = p_issue_note_id;
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_can_view_costs(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.is_platform_owner()
    OR public.fn_employee_has_permission(p_property_id, 'stores.costs.view');
$function$;

-- ---------------------------------------------------------------------------
-- 2. Issue an approved requisition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_issue_requisition(
  p_property_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_idem text;
  v_existing_id uuid;
  v_req public.requisitions%ROWTYPE;
  v_cc public.cost_centres%ROWTYPE;
  v_issue public.issue_notes%ROWTYPE;
  v_issue_no text;
  v_from uuid;
  v_to uuid;
  v_lines jsonb;
  v_line jsonb;
  v_req_line public.requisition_lines%ROWTYPE;
  v_line_id uuid;
  v_qty numeric;
  v_remaining numeric;
  v_unit_code text;
  v_base_qty numeric;
  v_unit_cost numeric;
  v_reason text;
  v_seen uuid[] := '{}'::uuid[];
  v_before jsonb;
  v_status text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.requisition.issue');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'An issue payload object is required' USING ERRCODE = '22023';
  END IF;

  v_idem := NULLIF(BTRIM(p_payload->>'idempotency_key'), '');
  IF v_idem IS NOT NULL AND length(v_idem) > 128 THEN
    RAISE EXCEPTION 'Idempotency key must be at most 128 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_idem IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.issue_notes
    WHERE property_id = p_property_id AND idempotency_key = v_idem;

    IF FOUND THEN
      RETURN stock_internal.fn_stores_issue_payload(
        p_property_id, v_existing_id,
        stock_internal.fn_stores_can_view_costs(p_property_id)
      );
    END IF;
  END IF;

  SELECT * INTO v_req
  FROM public.requisitions
  WHERE id = NULLIF(p_payload->>'requisition_id', '')::uuid
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status NOT IN ('approved', 'partially_issued') THEN
    RAISE EXCEPTION 'Only approved requisitions can be issued' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cc FROM public.cost_centres WHERE id = v_req.cost_centre_id;

  v_from := COALESCE(
    NULLIF(p_payload->>'from_location_id', '')::uuid,
    v_req.from_location_id
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_from AND property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'The issuing store does not belong to this property'
      USING ERRCODE = '22023';
  END IF;

  v_to := NULL;
  IF NOT v_cc.consumes_on_issue THEN
    v_to := COALESCE(
      NULLIF(p_payload->>'to_location_id', '')::uuid,
      stock_internal.fn_stores_department_location(p_property_id, v_cc.name)
    );

    IF v_to = v_from THEN
      RAISE EXCEPTION 'Source and destination locations must differ'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_locations
      WHERE id = v_to AND property_id = p_property_id
    ) THEN
      RAISE EXCEPTION 'The receiving location does not belong to this property'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_lines := p_payload->'lines';
  IF v_lines IS NULL
     OR jsonb_typeof(v_lines) <> 'array'
     OR jsonb_array_length(v_lines) = 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'requisition_line_id', rl.id,
      'qty', rl.approved_qty - rl.issued_qty,
      'unit_code', rl.unit_code
    ) ORDER BY rl.id), '[]'::jsonb)
    INTO v_lines
    FROM public.requisition_lines rl
    WHERE rl.requisition_id = v_req.id
      AND rl.approved_qty > rl.issued_qty;
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'There is nothing left to issue on this requisition'
      USING ERRCODE = '22023';
  END IF;

  v_before := stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);

  v_issue_no := stock_internal.fn_stores_allocate_number(
    p_property_id, 'stores_issue', 'ISS'
  );

  INSERT INTO public.issue_notes(
    property_id, issue_no, requisition_id, cost_centre_id,
    from_location_id, to_location_id, status, notes,
    issued_by, issued_at, idempotency_key
  )
  VALUES (
    p_property_id, v_issue_no, v_req.id, v_cc.id,
    v_from, v_to, 'issued', NULLIF(BTRIM(p_payload->>'notes'), ''),
    auth.uid(), now(), v_idem
  )
  RETURNING * INTO v_issue;

  v_reason := 'Issue ' || v_issue_no || ' to ' || v_cc.name;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_line_id := NULLIF(v_line->>'requisition_line_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;

    IF v_line_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty <> ROUND(v_qty, 2) THEN
      RAISE EXCEPTION 'Each issue line needs a requisition line and a positive 2-decimal quantity'
        USING ERRCODE = '22023';
    END IF;

    IF v_line_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A requisition line may only be issued once per issue note'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_line_id);

    SELECT * INTO v_req_line
    FROM public.requisition_lines
    WHERE id = v_line_id AND requisition_id = v_req.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Requisition line % is not part of this requisition', v_line_id
        USING ERRCODE = '22023';
    END IF;

    v_remaining := v_req_line.approved_qty - v_req_line.issued_qty;
    IF v_qty > v_remaining + 0.000001 THEN
      RAISE EXCEPTION 'Issue quantity exceeds the approved remaining quantity'
        USING ERRCODE = '22023';
    END IF;

    IF NOT stock_internal.fn_stores_product_eligible(p_property_id, v_req_line.product_id) THEN
      RAISE EXCEPTION 'Product % is no longer eligible for stock requisitions',
        v_req_line.product_id USING ERRCODE = '22023';
    END IF;

    v_unit_code := COALESCE(
      NULLIF(BTRIM(v_line->>'unit_code'), ''),
      v_req_line.unit_code
    );

    v_base_qty := stock_internal.fn_stores_convert_qty(
      p_property_id, v_req_line.product_id, v_qty, v_unit_code
    );

    v_unit_cost := stock_internal.fn_stores_weighted_average_cost(
      p_property_id, v_req_line.product_id, v_from
    );

    INSERT INTO public.issue_note_lines(
      issue_note_id, requisition_line_id, product_id,
      qty, unit_code, base_qty, unit_cost
    )
    VALUES (
      v_issue.id, v_req_line.id, v_req_line.product_id,
      v_qty, v_unit_code, v_base_qty, v_unit_cost
    );

    IF v_cc.consumes_on_issue THEN
      PERFORM stock_internal.fn_stores_post_movement(
        p_property_id, v_req_line.product_id, v_from, -v_base_qty,
        v_reason, 'stores_issue', v_issue.id, v_req_line.id::text, v_unit_cost
      );
    ELSE
      PERFORM stock_internal.fn_stores_post_move(
        p_property_id, v_req_line.product_id, v_from, v_to, v_base_qty,
        v_reason, 'stores_issue', v_issue.id, v_req_line.id::text, v_unit_cost
      );
    END IF;

    UPDATE public.requisition_lines
    SET issued_qty = issued_qty + v_qty,
        updated_at = now()
    WHERE id = v_req_line.id;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.requisition_lines
    WHERE requisition_id = v_req.id AND approved_qty > issued_qty
  ) THEN
    v_status := 'issued';
  ELSE
    v_status := 'partially_issued';
  END IF;

  UPDATE public.requisitions
  SET status = v_status,
      closed_at = CASE WHEN v_status = 'issued' THEN now() ELSE closed_at END,
      updated_at = now()
  WHERE id = v_req.id;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'issue_note', v_issue.id, 'issue',
    NULL, stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false)
  );

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'requisition', v_req.id, 'issue',
    v_before, stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id)
  );

  PERFORM stock_internal.fn_stores_notify_user(
    p_property_id, v_req.requested_by,
    'issue_posted', 'issue_note', v_issue.id,
    'Issue ' || v_issue_no || ' posted',
    'Stock issued from ' || v_cc.name || '.'
  );

  IF v_to IS NOT NULL THEN
    PERFORM stock_internal.fn_stores_notify_permission(
      p_property_id, 'stores.requisition.receive',
      'issue_posted', 'issue_note', v_issue.id,
      'Issue ' || v_issue_no || ' awaiting receipt',
      v_cc.name || ' must confirm receipt.',
      public.current_staff_id(p_property_id)
    );
  END IF;

  RETURN stock_internal.fn_stores_issue_payload(
    p_property_id, v_issue.id,
    stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Permissioned direct issue (decision D9)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_direct_issue(
  p_property_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settings public.stores_settings%ROWTYPE;
  v_idem text;
  v_existing_id uuid;
  v_cc public.cost_centres%ROWTYPE;
  v_issue public.issue_notes%ROWTYPE;
  v_issue_no text;
  v_from uuid;
  v_to uuid;
  v_lines jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit_code text;
  v_base_qty numeric;
  v_unit_cost numeric;
  v_reason text;
  v_seen uuid[] := '{}'::uuid[];
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.requisition.issue');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A direct issue payload object is required' USING ERRCODE = '22023';
  END IF;

  v_settings := stock_internal.fn_stores_settings_row(p_property_id);
  IF NOT v_settings.direct_issue_enabled THEN
    RAISE EXCEPTION 'Direct issues are disabled for this property' USING ERRCODE = '42501';
  END IF;

  v_idem := NULLIF(BTRIM(p_payload->>'idempotency_key'), '');
  IF v_idem IS NOT NULL AND length(v_idem) > 128 THEN
    RAISE EXCEPTION 'Idempotency key must be at most 128 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_idem IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.issue_notes
    WHERE property_id = p_property_id AND idempotency_key = v_idem;

    IF FOUND THEN
      RETURN stock_internal.fn_stores_issue_payload(
        p_property_id, v_existing_id,
        stock_internal.fn_stores_can_view_costs(p_property_id)
      );
    END IF;
  END IF;

  SELECT * INTO v_cc
  FROM public.cost_centres
  WHERE id = NULLIF(p_payload->>'cost_centre_id', '')::uuid
    AND property_id = p_property_id;

  IF NOT FOUND OR NOT v_cc.active THEN
    RAISE EXCEPTION 'A direct issue needs an active cost centre'
      USING ERRCODE = '22023';
  END IF;

  v_from := COALESCE(
    NULLIF(p_payload->>'from_location_id', '')::uuid,
    stock_internal.fn_stores_source_location(p_property_id, v_cc.id)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_from AND property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'The issuing store does not belong to this property'
      USING ERRCODE = '22023';
  END IF;

  v_to := NULL;
  IF NOT v_cc.consumes_on_issue THEN
    v_to := COALESCE(
      NULLIF(p_payload->>'to_location_id', '')::uuid,
      stock_internal.fn_stores_department_location(p_property_id, v_cc.name)
    );

    IF v_to = v_from THEN
      RAISE EXCEPTION 'Source and destination locations must differ'
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_locations
      WHERE id = v_to AND property_id = p_property_id
    ) THEN
      RAISE EXCEPTION 'The receiving location does not belong to this property'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_lines := p_payload->'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'At least one direct issue line is required' USING ERRCODE = '22023';
  END IF;

  v_issue_no := stock_internal.fn_stores_allocate_number(
    p_property_id, 'stores_issue', 'ISS'
  );

  INSERT INTO public.issue_notes(
    property_id, issue_no, requisition_id, cost_centre_id,
    from_location_id, to_location_id, status, notes,
    issued_by, issued_at, idempotency_key
  )
  VALUES (
    p_property_id, v_issue_no, NULL, v_cc.id,
    v_from, v_to, 'issued', NULLIF(BTRIM(p_payload->>'notes'), ''),
    auth.uid(), now(), v_idem
  )
  RETURNING * INTO v_issue;

  v_reason := 'Direct issue ' || v_issue_no || ' to ' || v_cc.name;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty <> ROUND(v_qty, 2) THEN
      RAISE EXCEPTION 'Each direct issue line needs a product and a positive 2-decimal quantity'
        USING ERRCODE = '22023';
    END IF;

    IF v_product_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A product may only appear once in a direct issue'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_product_id);

    IF NOT stock_internal.fn_stores_product_eligible(p_property_id, v_product_id) THEN
      RAISE EXCEPTION 'Product % is not eligible for stock issues', v_product_id
        USING ERRCODE = '22023';
    END IF;

    v_unit_code := COALESCE(
      NULLIF(BTRIM(v_line->>'unit_code'), ''),
      (SELECT base_unit FROM public.products WHERE id = v_product_id)
    );

    v_base_qty := stock_internal.fn_stores_convert_qty(
      p_property_id, v_product_id, v_qty, v_unit_code
    );

    v_unit_cost := stock_internal.fn_stores_weighted_average_cost(
      p_property_id, v_product_id, v_from
    );

    INSERT INTO public.issue_note_lines(
      issue_note_id, requisition_line_id, product_id,
      qty, unit_code, base_qty, unit_cost
    )
    VALUES (
      v_issue.id, NULL, v_product_id,
      v_qty, v_unit_code, v_base_qty, v_unit_cost
    );

    IF v_cc.consumes_on_issue THEN
      PERFORM stock_internal.fn_stores_post_movement(
        p_property_id, v_product_id, v_from, -v_base_qty,
        v_reason, 'stores_issue', v_issue.id, v_product_id::text, v_unit_cost
      );
    ELSE
      PERFORM stock_internal.fn_stores_post_move(
        p_property_id, v_product_id, v_from, v_to, v_base_qty,
        v_reason, 'stores_issue', v_issue.id, v_product_id::text, v_unit_cost
      );
    END IF;
  END LOOP;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'issue_note', v_issue.id, 'direct_issue',
    NULL, stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false)
  );

  IF v_to IS NOT NULL THEN
    PERFORM stock_internal.fn_stores_notify_permission(
      p_property_id, 'stores.requisition.receive',
      'issue_posted', 'issue_note', v_issue.id,
      'Issue ' || v_issue_no || ' awaiting receipt',
      v_cc.name || ' must confirm receipt.',
      public.current_staff_id(p_property_id)
    );
  END IF;

  RETURN stock_internal.fn_stores_issue_payload(
    p_property_id, v_issue.id,
    stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Confirm receipt (no stock change; discrepancies are recorded only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_confirm_issue_receipt(
  p_property_id uuid,
  p_issue_note_id uuid,
  p_lines jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_issue public.issue_notes%ROWTYPE;
  v_settings public.stores_settings%ROWTYPE;
  v_before jsonb;
  v_line jsonb;
  v_line_id uuid;
  v_received numeric;
  v_reason text;
  v_has_discrepancy boolean;
  v_status text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.requisition.receive');

  SELECT * INTO v_issue
  FROM public.issue_notes
  WHERE id = p_issue_note_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Issue note not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_issue.status NOT IN ('issued', 'in_transit') THEN
    RAISE EXCEPTION 'This issue note cannot be confirmed in its current state'
      USING ERRCODE = '22023';
  END IF;

  v_settings := stock_internal.fn_stores_settings_row(p_property_id);

  IF v_settings.segregation_of_duties AND v_issue.issued_by = auth.uid() THEN
    RAISE EXCEPTION 'Segregation of duties: the issuer cannot confirm receipt'
      USING ERRCODE = '42501';
  END IF;

  v_before := stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false);

  UPDATE public.issue_note_lines
  SET received_qty = qty,
      discrepancy_qty = 0,
      discrepancy_reason = NULL
  WHERE issue_note_id = v_issue.id;

  IF p_lines IS NOT NULL THEN
    IF jsonb_typeof(p_lines) <> 'array' THEN
      RAISE EXCEPTION 'Receipt lines must be an array' USING ERRCODE = '22023';
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
    LOOP
      v_line_id := NULLIF(v_line->>'issue_note_line_id', '')::uuid;
      v_received := (v_line->>'received_qty')::numeric;

      IF v_line_id IS NULL OR v_received IS NULL
         OR v_received < 0 OR v_received <> ROUND(v_received, 2) THEN
        RAISE EXCEPTION 'Each receipt line needs a line id and a non-negative 2-decimal quantity'
          USING ERRCODE = '22023';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.issue_note_lines
        WHERE id = v_line_id AND issue_note_id = v_issue.id
      ) THEN
        RAISE EXCEPTION 'Issue line % is not part of this issue note', v_line_id
          USING ERRCODE = '22023';
      END IF;

      IF v_received > (
        SELECT qty FROM public.issue_note_lines WHERE id = v_line_id
      ) THEN
        RAISE EXCEPTION 'Received quantity cannot exceed the issued quantity'
          USING ERRCODE = '22023';
      END IF;

      v_reason := NULLIF(BTRIM(v_line->>'discrepancy_reason'), '');

      UPDATE public.issue_note_lines
      SET received_qty = v_received,
          discrepancy_qty = qty - v_received,
          discrepancy_reason = CASE WHEN qty - v_received > 0 THEN v_reason ELSE NULL END
      WHERE id = v_line_id;

      IF v_reason IS NULL AND v_received < (
        SELECT qty FROM public.issue_note_lines WHERE id = v_line_id
      ) THEN
        RAISE EXCEPTION 'A discrepancy reason is required when less stock is received'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.issue_note_lines
    WHERE issue_note_id = v_issue.id AND discrepancy_qty > 0
  ) INTO v_has_discrepancy;

  v_status := CASE WHEN v_has_discrepancy THEN 'discrepancy' ELSE 'received' END;

  UPDATE public.issue_notes
  SET status = v_status,
      received_by = auth.uid(),
      received_at = now(),
      notes = CASE
        WHEN NULLIF(BTRIM(p_notes), '') IS NULL THEN notes
        ELSE CONCAT_WS(E'\n', notes, BTRIM(p_notes))
      END,
      updated_at = now()
  WHERE id = v_issue.id;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'issue_note', v_issue.id,
    CASE WHEN v_has_discrepancy THEN 'receive_discrepancy' ELSE 'receive' END,
    v_before, stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false),
    NULLIF(BTRIM(p_notes), '')
  );

  PERFORM stock_internal.fn_stores_notify_user(
    p_property_id, v_issue.issued_by,
    'issue_received', 'issue_note', v_issue.id,
    'Issue ' || v_issue.issue_no ||
      CASE WHEN v_has_discrepancy THEN ' received with discrepancy' ELSE ' received' END,
    NULLIF(BTRIM(p_notes), '')
  );

  RETURN stock_internal.fn_stores_issue_payload(
    p_property_id, v_issue.id,
    stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Void an issue note (compensating ledger posting)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_void_issue(
  p_property_id uuid,
  p_issue_note_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_issue public.issue_notes%ROWTYPE;
  v_cc public.cost_centres%ROWTYPE;
  v_reason text;
  v_line record;
  v_before jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.issue.void');

  SELECT * INTO v_issue
  FROM public.issue_notes
  WHERE id = p_issue_note_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Issue note not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_issue.status = 'voided' THEN
    RAISE EXCEPTION 'This issue note is already voided' USING ERRCODE = '22023';
  END IF;

  v_reason := NULLIF(BTRIM(p_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A void reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cc FROM public.cost_centres WHERE id = v_issue.cost_centre_id;
  v_before := stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false);

  FOR v_line IN
    SELECT * FROM public.issue_note_lines
    WHERE issue_note_id = v_issue.id
    ORDER BY id
  LOOP
    IF v_cc.consumes_on_issue THEN
      PERFORM stock_internal.fn_stores_post_movement(
        p_property_id, v_line.product_id, v_issue.from_location_id,
        v_line.base_qty,
        'Void ' || v_issue.issue_no || ': ' || v_reason,
        'stores_issue_void', v_issue.id, v_line.id::text, v_line.unit_cost
      );
    ELSE
      IF v_issue.to_location_id IS NULL THEN
        RAISE EXCEPTION 'The department destination is missing from this issue note'
          USING ERRCODE = '22023';
      END IF;

      PERFORM stock_internal.fn_stores_post_move(
        p_property_id, v_line.product_id,
        v_issue.to_location_id, v_issue.from_location_id,
        v_line.base_qty,
        'Void ' || v_issue.issue_no || ': ' || v_reason,
        'stores_issue_void', v_issue.id, v_line.id::text, v_line.unit_cost
      );
    END IF;
  END LOOP;

  UPDATE public.issue_notes
  SET status = 'voided',
      voided_by = auth.uid(),
      voided_at = now(),
      void_reason = v_reason,
      updated_at = now()
  WHERE id = v_issue.id;

  -- Return the issued quantities to the requisition so a corrected issue can be
  -- posted, and reopen the requisition status.
  IF v_issue.requisition_id IS NOT NULL THEN
    UPDATE public.requisition_lines rl
    SET issued_qty = GREATEST(rl.issued_qty - l.qty, 0),
        updated_at = now()
    FROM public.issue_note_lines l
    WHERE l.issue_note_id = v_issue.id
      AND rl.id = l.requisition_line_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.requisition_lines
      WHERE requisition_id = v_issue.requisition_id AND issued_qty > 0
    ) THEN
      UPDATE public.requisitions
      SET status = 'approved', closed_at = NULL, updated_at = now()
      WHERE id = v_issue.requisition_id;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.requisition_lines
      WHERE requisition_id = v_issue.requisition_id AND approved_qty > issued_qty
    ) THEN
      UPDATE public.requisitions
      SET status = 'issued', closed_at = now(), updated_at = now()
      WHERE id = v_issue.requisition_id;
    ELSE
      UPDATE public.requisitions
      SET status = 'partially_issued', closed_at = NULL, updated_at = now()
      WHERE id = v_issue.requisition_id;
    END IF;

    PERFORM stock_internal.fn_stores_audit(
      p_property_id, 'requisition', v_issue.requisition_id, 'issue_void',
      NULL, stock_internal.fn_stores_requisition_payload(p_property_id, v_issue.requisition_id),
      v_reason
    );
  END IF;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'issue_note', v_issue.id, 'void',
    v_before, stock_internal.fn_stores_issue_payload(p_property_id, v_issue.id, false),
    v_reason
  );

  PERFORM stock_internal.fn_stores_notify_user(
    p_property_id, v_issue.issued_by,
    'issue_voided', 'issue_note', v_issue.id,
    'Issue ' || v_issue.issue_no || ' voided',
    v_reason
  );

  RETURN stock_internal.fn_stores_issue_payload(
    p_property_id, v_issue.id,
    stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Issue-note lists and detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_list_issue_notes(
  p_property_id uuid,
  p_status text DEFAULT NULL,
  p_cost_centre_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_search text;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.requisition.view', 'stores.requisition.issue',
      'stores.requisition.receive', 'stores.requisition.approve',
      'stores.issue.void', 'stores.costcentre.manage'
    ]
  );

  v_search := NULLIF(BTRIM(p_search), '');

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT n.created_at, jsonb_build_object(
      'id', n.id,
      'issue_no', n.issue_no,
      'status', n.status,
      'requisition_id', n.requisition_id,
      'requisition_no', r.req_no,
      'cost_centre_id', n.cost_centre_id,
      'cost_centre_name', cc.name,
      'from_location_name', fl.name,
      'to_location_name', tl.name,
      'issued_by', n.issued_by,
      'issued_by_name', ip.full_name,
      'issued_at', n.issued_at,
      'received_at', n.received_at,
      'created_at', n.created_at,
      'line_count', (SELECT COUNT(*) FROM public.issue_note_lines l WHERE l.issue_note_id = n.id),
      'has_discrepancy', EXISTS (
        SELECT 1 FROM public.issue_note_lines l
        WHERE l.issue_note_id = n.id AND l.discrepancy_qty > 0
      )
    ) AS row_obj
    FROM public.issue_notes n
    JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
    LEFT JOIN public.requisitions r ON r.id = n.requisition_id
    LEFT JOIN public.inventory_locations fl ON fl.id = n.from_location_id
    LEFT JOIN public.inventory_locations tl ON tl.id = n.to_location_id
    LEFT JOIN public.profiles ip ON ip.id = n.issued_by
    WHERE n.property_id = p_property_id
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR n.status = BTRIM(p_status))
      AND (p_cost_centre_id IS NULL OR n.cost_centre_id = p_cost_centre_id)
      AND (
        v_search IS NULL
        OR n.issue_no ILIKE '%' || v_search || '%'
        OR cc.name ILIKE '%' || v_search || '%'
        OR COALESCE(r.req_no, '') ILIKE '%' || v_search || '%'
      )
    ORDER BY n.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  SELECT COUNT(*)
  INTO v_total
  FROM public.issue_notes n
  JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
  LEFT JOIN public.requisitions r ON r.id = n.requisition_id
  WHERE n.property_id = p_property_id
    AND (NULLIF(BTRIM(p_status), '') IS NULL OR n.status = BTRIM(p_status))
    AND (p_cost_centre_id IS NULL OR n.cost_centre_id = p_cost_centre_id)
    AND (
      v_search IS NULL
      OR n.issue_no ILIKE '%' || v_search || '%'
      OR cc.name ILIKE '%' || v_search || '%'
      OR COALESCE(r.req_no, '') ILIKE '%' || v_search || '%'
    );

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'can_issue', public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue'),
    'can_receive', public.fn_employee_has_permission(p_property_id, 'stores.requisition.receive'),
    'can_void', public.fn_employee_has_permission(p_property_id, 'stores.issue.void'),
    'can_view_costs', stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_issue_note_detail(
  p_property_id uuid,
  p_issue_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_include_costs boolean;
  v_payload jsonb;
  v_status text;
  v_issued_by uuid;
  v_settings public.stores_settings%ROWTYPE;
  v_can_confirm boolean;
  v_can_void boolean;
  v_audit jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.requisition.view', 'stores.requisition.issue',
      'stores.requisition.receive', 'stores.requisition.approve',
      'stores.issue.void', 'stores.costcentre.manage'
    ]
  );

  v_include_costs := stock_internal.fn_stores_can_view_costs(p_property_id);
  v_payload := stock_internal.fn_stores_issue_payload(
    p_property_id, p_issue_note_id, v_include_costs
  );

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Issue note not found' USING ERRCODE = 'P0002';
  END IF;

  v_status := v_payload->>'status';
  v_issued_by := NULLIF(v_payload->>'issued_by', '')::uuid;
  v_settings := stock_internal.fn_stores_settings_row(p_property_id);

  v_can_confirm := public.fn_employee_has_permission(p_property_id, 'stores.requisition.receive')
    AND v_status IN ('issued', 'in_transit')
    AND (
      NOT v_settings.segregation_of_duties
      OR v_issued_by IS DISTINCT FROM auth.uid()
    );

  v_can_void := public.fn_employee_has_permission(p_property_id, 'stores.issue.void')
    AND v_status <> 'voided';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'action', a.action,
    'actor_user_id', a.actor_user_id,
    'actor_name', pr.full_name,
    'reason', a.reason,
    'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT * FROM public.stores_document_audit
    WHERE property_id = p_property_id
      AND document_type = 'issue_note'
      AND document_id = p_issue_note_id
    ORDER BY created_at DESC
    LIMIT 50
  ) a
  LEFT JOIN public.profiles pr ON pr.id = a.actor_user_id;

  RETURN v_payload || jsonb_build_object(
    'can_confirm', v_can_confirm,
    'can_void', v_can_void,
    'can_view_costs', v_include_costs,
    'audit', v_audit
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION stock_internal.fn_stores_issue_payload(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_can_view_costs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_stores_issue_requisition(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_direct_issue(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_confirm_issue_receipt(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_void_issue(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_issue_notes(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_issue_note_detail(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_stores_issue_requisition(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_direct_issue(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_confirm_issue_receipt(uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_void_issue(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_issue_notes(uuid, text, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_issue_note_detail(uuid, uuid) TO authenticated;

COMMIT;
