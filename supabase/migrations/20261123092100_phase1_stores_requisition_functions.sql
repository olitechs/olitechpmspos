-- Phase 1 Stores lifecycle, part 2: requisitions.
--
-- Save/submit/approve/reject/cancel never change stock. Issue posting lives in
-- part 3. Every transition is audited with before/after JSON and fans out an
-- in-app notification to the affected staff.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. User-targeted notification helper (recipients are staff rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_notify_user(
  p_property_id uuid,
  p_user_id uuid,
  p_kind text,
  p_document_type text,
  p_document_id uuid,
  p_title text,
  p_body text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_staff IN
    SELECT s.id
    FROM public.staff s
    WHERE s.property_id = p_property_id
      AND s.user_id = p_user_id
      AND s.is_active
  LOOP
    PERFORM stock_internal.fn_stores_notify_staff(
      p_property_id, v_staff.id, p_kind, p_document_type,
      p_document_id, p_title, p_body
    );
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_requisition_payload(
  p_property_id uuid,
  p_requisition_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', r.id,
    'req_no', r.req_no,
    'status', r.status,
    'cost_centre_id', r.cost_centre_id,
    'cost_centre_name', cc.name,
    'consumes_on_issue', cc.consumes_on_issue,
    'from_location_id', r.from_location_id,
    'from_location_name', fl.name,
    'needed_by', r.needed_by,
    'priority', r.priority,
    'requested_by', r.requested_by,
    'requested_by_name', rp.full_name,
    'submitted_at', r.submitted_at,
    'submitted_by', r.submitted_by,
    'approved_at', r.approved_at,
    'approved_by', r.approved_by,
    'approved_by_name', ap.full_name,
    'rejected_at', r.rejected_at,
    'rejected_by', r.rejected_by,
    'rejection_reason', r.rejection_reason,
    'closed_at', r.closed_at,
    'notes', r.notes,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'line_count', (
      SELECT COUNT(*) FROM public.requisition_lines rl
      WHERE rl.requisition_id = r.id
    ),
    'total_requested', COALESCE((
      SELECT SUM(rl.requested_qty) FROM public.requisition_lines rl
      WHERE rl.requisition_id = r.id
    ), 0),
    'total_approved', COALESCE((
      SELECT SUM(rl.approved_qty) FROM public.requisition_lines rl
      WHERE rl.requisition_id = r.id
    ), 0),
    'total_issued', COALESCE((
      SELECT SUM(rl.issued_qty) FROM public.requisition_lines rl
      WHERE rl.requisition_id = r.id
    ), 0),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rl.id,
        'product_id', rl.product_id,
        'product_name', p.name,
        'sku', p.sku,
        'unit_code', rl.unit_code,
        'base_unit', p.base_unit,
        'requested_qty', rl.requested_qty,
        'approved_qty', rl.approved_qty,
        'issued_qty', rl.issued_qty,
        'received_qty', rl.received_qty,
        'remaining_qty', GREATEST(rl.approved_qty - rl.issued_qty, 0),
        'note', rl.note,
        'on_hand', COALESCE((
          SELECT psl.qty FROM public.product_stock_locations psl
          WHERE psl.product_id = rl.product_id
            AND psl.location_id = r.from_location_id
        ), 0)
      ) ORDER BY p.name)
      FROM public.requisition_lines rl
      JOIN public.products p ON p.id = rl.product_id
      WHERE rl.requisition_id = r.id
    ), '[]'::jsonb)
  )
  FROM public.requisitions r
  JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
  LEFT JOIN public.inventory_locations fl ON fl.id = r.from_location_id
  LEFT JOIN public.profiles rp ON rp.id = r.requested_by
  LEFT JOIN public.profiles ap ON ap.id = r.approved_by
  WHERE r.property_id = p_property_id
    AND r.id = p_requisition_id;
$function$;

-- ---------------------------------------------------------------------------
-- 1. Save a draft requisition
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_save_requisition(
  p_property_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_existing_id uuid;
  v_req public.requisitions%ROWTYPE;
  v_cc public.cost_centres%ROWTYPE;
  v_idem text;
  v_from uuid;
  v_needed date;
  v_priority text;
  v_notes text;
  v_lines jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit_code text;
  v_base_qty numeric;
  v_seen uuid[] := '{}'::uuid[];
  v_before jsonb;
  v_req_no text;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.requisition.create');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A requisition payload object is required' USING ERRCODE = '22023';
  END IF;

  v_idem := NULLIF(BTRIM(p_payload->>'idempotency_key'), '');
  IF v_idem IS NOT NULL AND length(v_idem) > 128 THEN
    RAISE EXCEPTION 'Idempotency key must be at most 128 characters'
      USING ERRCODE = '22023';
  END IF;

  IF v_idem IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.requisitions
    WHERE property_id = p_property_id
      AND idempotency_key = v_idem;

    IF FOUND THEN
      RETURN stock_internal.fn_stores_requisition_payload(p_property_id, v_existing_id);
    END IF;
  END IF;

  v_id := NULLIF(p_payload->>'id', '')::uuid;
  SELECT * INTO v_cc
  FROM public.cost_centres
  WHERE id = NULLIF(p_payload->>'cost_centre_id', '')::uuid
    AND property_id = p_property_id;

  IF NOT FOUND OR NOT v_cc.active THEN
    RAISE EXCEPTION 'Select an active cost centre' USING ERRCODE = '22023';
  END IF;

  v_from := NULLIF(p_payload->>'from_location_id', '')::uuid;
  IF v_from IS NULL THEN
    v_from := stock_internal.fn_stores_source_location(p_property_id, v_cc.id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_from AND property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'The issuing store does not belong to this property'
      USING ERRCODE = '22023';
  END IF;

  v_needed := NULLIF(BTRIM(p_payload->>'needed_by'), '')::date;
  v_priority := COALESCE(NULLIF(LOWER(BTRIM(p_payload->>'priority')), ''), 'normal');
  IF v_priority NOT IN ('low', 'normal', 'urgent') THEN
    RAISE EXCEPTION 'Invalid requisition priority' USING ERRCODE = '22023';
  END IF;

  v_notes := NULLIF(BTRIM(p_payload->>'notes'), '');
  v_lines := p_payload->'lines';

  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'At least one requisition line is required' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    v_req_no := stock_internal.fn_stores_allocate_number(
      p_property_id, 'stores_requisition', 'REQ'
    );

    INSERT INTO public.requisitions(
      property_id, req_no, cost_centre_id, from_location_id,
      needed_by, priority, status, requested_by, notes, idempotency_key
    )
    VALUES (
      p_property_id, v_req_no, v_cc.id, v_from,
      v_needed, v_priority, 'draft', auth.uid(), v_notes, v_idem
    )
    RETURNING * INTO v_req;

    v_before := NULL;
    v_id := v_req.id;
  ELSE
    SELECT * INTO v_req
    FROM public.requisitions
    WHERE id = v_id AND property_id = p_property_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft requisitions can be edited' USING ERRCODE = '22023';
    END IF;

    IF v_req.requested_by IS DISTINCT FROM auth.uid()
       AND NOT (
         public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
         OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
       ) THEN
      RAISE EXCEPTION 'Only the requester or a Stores manager can edit this draft'
        USING ERRCODE = '42501';
    END IF;

    v_before := stock_internal.fn_stores_requisition_payload(p_property_id, v_id);

    UPDATE public.requisitions
    SET cost_centre_id = v_cc.id,
        from_location_id = v_from,
        needed_by = v_needed,
        priority = v_priority,
        notes = v_notes,
        idempotency_key = COALESCE(idempotency_key, v_idem),
        updated_at = now()
    WHERE id = v_id AND property_id = p_property_id;

    DELETE FROM public.requisition_lines WHERE requisition_id = v_id;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty := (v_line->>'requested_qty')::numeric;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty <> ROUND(v_qty, 2) THEN
      RAISE EXCEPTION 'Each line needs a product and a positive 2-decimal quantity'
        USING ERRCODE = '22023';
    END IF;

    IF v_product_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A product may only appear once in a requisition'
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_product_id);

    IF NOT stock_internal.fn_stores_product_eligible(p_property_id, v_product_id) THEN
      RAISE EXCEPTION 'Product % is not eligible for stock requisitions', v_product_id
        USING ERRCODE = '22023';
    END IF;

    v_unit_code := COALESCE(
      NULLIF(BTRIM(v_line->>'unit_code'), ''),
      (SELECT base_unit FROM public.products WHERE id = v_product_id)
    );

    v_base_qty := stock_internal.fn_stores_convert_qty(
      p_property_id, v_product_id, v_qty, v_unit_code
    );

    INSERT INTO public.requisition_lines(
      requisition_id, product_id, requested_qty, unit_code, base_qty, note
    )
    VALUES (
      v_id, v_product_id, v_qty, v_unit_code, v_base_qty,
      NULLIF(BTRIM(v_line->>'note'), '')
    );
  END LOOP;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'requisition', v_id,
    CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END,
    v_before, stock_internal.fn_stores_requisition_payload(p_property_id, v_id)
  );

  RETURN stock_internal.fn_stores_requisition_payload(p_property_id, v_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Submit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_submit_requisition(
  p_property_id uuid,
  p_requisition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.requisitions%ROWTYPE;
  v_cc public.cost_centres%ROWTYPE;
  v_settings public.stores_settings%ROWTYPE;
  v_before jsonb;
  v_requires_approval boolean;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.requisition.create', 'stores.requisition.approve', 'stores.costcentre.manage']
  );

  SELECT * INTO v_req
  FROM public.requisitions
  WHERE id = p_requisition_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft requisitions can be submitted' USING ERRCODE = '22023';
  END IF;

  IF v_req.requested_by IS DISTINCT FROM auth.uid()
     AND NOT (
       public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
       OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
     ) THEN
    RAISE EXCEPTION 'Only the requester or a Stores manager can submit this draft'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.requisition_lines
    WHERE requisition_id = v_req.id AND requested_qty > 0
  ) THEN
    RAISE EXCEPTION 'A requisition needs at least one line before submission'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cc FROM public.cost_centres WHERE id = v_req.cost_centre_id;
  v_settings := stock_internal.fn_stores_settings_row(p_property_id);
  v_requires_approval := v_settings.requisition_approval_required AND v_cc.approval_required;
  v_before := stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);

  IF v_requires_approval THEN
    UPDATE public.requisitions
    SET status = 'submitted',
        submitted_at = now(),
        submitted_by = auth.uid(),
        updated_at = now()
    WHERE id = v_req.id;
  ELSE
    UPDATE public.requisition_lines
    SET approved_qty = requested_qty, updated_at = now()
    WHERE requisition_id = v_req.id;

    UPDATE public.requisitions
    SET status = 'approved',
        submitted_at = now(),
        submitted_by = auth.uid(),
        approved_at = now(),
        approved_by = auth.uid(),
        updated_at = now()
    WHERE id = v_req.id;
  END IF;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'requisition', v_req.id,
    CASE WHEN v_requires_approval THEN 'submit' ELSE 'submit_auto_approved' END,
    v_before, stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id)
  );

  IF v_requires_approval THEN
    PERFORM stock_internal.fn_stores_notify_permission(
      p_property_id, 'stores.requisition.approve',
      'requisition_submitted', 'requisition', v_req.id,
      'Requisition ' || v_req.req_no || ' awaiting approval',
      v_cc.name || ' submitted a requisition.',
      public.current_staff_id(p_property_id)
    );
  ELSE
    PERFORM stock_internal.fn_stores_notify_user(
      p_property_id, v_req.requested_by,
      'requisition_approved', 'requisition', v_req.id,
      'Requisition ' || v_req.req_no || ' approved',
      'Approval was not required for ' || v_cc.name || '.'
    );
  END IF;

  RETURN stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Approve or reject
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_decide_requisition(
  p_property_id uuid,
  p_requisition_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.requisitions%ROWTYPE;
  v_settings public.stores_settings%ROWTYPE;
  v_decision text;
  v_reason text;
  v_before jsonb;
  v_line jsonb;
  v_line_id uuid;
  v_approved numeric;
  v_requested numeric;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.requisition.approve');

  SELECT * INTO v_req
  FROM public.requisitions
  WHERE id = p_requisition_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted requisitions can be decided' USING ERRCODE = '22023';
  END IF;

  v_settings := stock_internal.fn_stores_settings_row(p_property_id);

  IF v_settings.segregation_of_duties
     AND (v_req.requested_by = auth.uid() OR v_req.submitted_by = auth.uid()) THEN
    RAISE EXCEPTION 'Segregation of duties: the requester cannot approve their own requisition'
      USING ERRCODE = '42501';
  END IF;

  v_decision := LOWER(BTRIM(COALESCE(p_decision, '')));
  v_reason := NULLIF(BTRIM(p_reason), '');
  v_before := stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);

  IF v_decision = 'approve' THEN
    UPDATE public.requisition_lines
    SET approved_qty = requested_qty, updated_at = now()
    WHERE requisition_id = v_req.id;

    IF p_lines IS NOT NULL THEN
      IF jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'Approval lines must be an array' USING ERRCODE = '22023';
      END IF;

      FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
      LOOP
        v_line_id := NULLIF(v_line->>'requisition_line_id', '')::uuid;
        v_approved := (v_line->>'approved_qty')::numeric;

        IF v_line_id IS NULL OR v_approved IS NULL THEN
          RAISE EXCEPTION 'Each approval line needs a line id and approved quantity'
            USING ERRCODE = '22023';
        END IF;

        SELECT requested_qty INTO v_requested
        FROM public.requisition_lines
        WHERE id = v_line_id AND requisition_id = v_req.id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Requisition line % is not part of this requisition', v_line_id
            USING ERRCODE = '22023';
        END IF;

        IF v_approved < 0 OR v_approved > v_requested OR v_approved <> ROUND(v_approved, 2) THEN
          RAISE EXCEPTION 'Approved quantity must be between zero and the requested quantity'
            USING ERRCODE = '22023';
        END IF;

        UPDATE public.requisition_lines
        SET approved_qty = v_approved, updated_at = now()
        WHERE id = v_line_id;
      END LOOP;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.requisition_lines
      WHERE requisition_id = v_req.id AND approved_qty > 0
    ) THEN
      RAISE EXCEPTION 'Approve at least one line with a positive quantity'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.requisitions
    SET status = 'approved',
        approved_at = now(),
        approved_by = auth.uid(),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = v_req.id;

  ELSIF v_decision = 'reject' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
    END IF;

    UPDATE public.requisition_lines
    SET approved_qty = 0, updated_at = now()
    WHERE requisition_id = v_req.id;

    UPDATE public.requisitions
    SET status = 'rejected',
        rejected_at = now(),
        rejected_by = auth.uid(),
        rejection_reason = v_reason,
        closed_at = now(),
        updated_at = now()
    WHERE id = v_req.id;
  ELSE
    RAISE EXCEPTION 'Decision must be approve or reject' USING ERRCODE = '22023';
  END IF;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'requisition', v_req.id,
    CASE WHEN v_decision = 'approve' THEN 'approve' ELSE 'reject' END,
    v_before, stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id),
    v_reason
  );

  PERFORM stock_internal.fn_stores_notify_user(
    p_property_id, v_req.requested_by,
    CASE WHEN v_decision = 'approve' THEN 'requisition_approved' ELSE 'requisition_rejected' END,
    'requisition', v_req.id,
    'Requisition ' || v_req.req_no ||
      CASE WHEN v_decision = 'approve' THEN ' approved' ELSE ' rejected' END,
    v_reason
  );

  RETURN stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Cancel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_cancel_requisition(
  p_property_id uuid,
  p_requisition_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.requisitions%ROWTYPE;
  v_reason text;
  v_before jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.requisition.create', 'stores.requisition.approve', 'stores.costcentre.manage']
  );

  SELECT * INTO v_req
  FROM public.requisitions
  WHERE id = p_requisition_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status NOT IN ('draft', 'submitted', 'approved', 'partially_issued') THEN
    RAISE EXCEPTION 'This requisition can no longer be cancelled' USING ERRCODE = '22023';
  END IF;

  IF v_req.requested_by IS DISTINCT FROM auth.uid()
     AND NOT (
       public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
       OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
     ) THEN
    RAISE EXCEPTION 'Only the requester or a Stores manager can cancel this requisition'
      USING ERRCODE = '42501';
  END IF;

  v_reason := NULLIF(BTRIM(p_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required' USING ERRCODE = '22023';
  END IF;

  v_before := stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);

  UPDATE public.requisitions
  SET status = 'cancelled',
      closed_at = now(),
      notes = CONCAT_WS(E'\n', notes, 'Cancelled: ' || v_reason),
      updated_at = now()
  WHERE id = v_req.id;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'requisition', v_req.id, 'cancel',
    v_before, stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id),
    v_reason
  );

  PERFORM stock_internal.fn_stores_notify_user(
    p_property_id, v_req.requested_by,
    'requisition_cancelled', 'requisition', v_req.id,
    'Requisition ' || v_req.req_no || ' cancelled',
    v_reason
  );

  RETURN stock_internal.fn_stores_requisition_payload(p_property_id, v_req.id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Lists, detail and product picker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_list_requisitions(
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
  v_only_own boolean;
  v_search text;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.requisition.create', 'stores.requisition.view',
      'stores.requisition.approve', 'stores.requisition.issue',
      'stores.requisition.receive', 'stores.costcentre.manage'
    ]
  );

  v_only_own := NOT public.fn_stores_can_view_all_requisitions(p_property_id);
  v_search := NULLIF(BTRIM(p_search), '');

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT r.created_at, jsonb_build_object(
      'id', r.id,
      'req_no', r.req_no,
      'status', r.status,
      'priority', r.priority,
      'needed_by', r.needed_by,
      'cost_centre_id', r.cost_centre_id,
      'cost_centre_name', cc.name,
      'from_location_name', fl.name,
      'requested_by', r.requested_by,
      'requested_by_name', rp.full_name,
      'submitted_at', r.submitted_at,
      'approved_at', r.approved_at,
      'created_at', r.created_at,
      'line_count', (SELECT COUNT(*) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id),
      'total_requested', COALESCE((SELECT SUM(rl.requested_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0),
      'total_approved', COALESCE((SELECT SUM(rl.approved_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0),
      'total_issued', COALESCE((SELECT SUM(rl.issued_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0)
    ) AS row_obj
    FROM public.requisitions r
    JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
    LEFT JOIN public.inventory_locations fl ON fl.id = r.from_location_id
    LEFT JOIN public.profiles rp ON rp.id = r.requested_by
    WHERE r.property_id = p_property_id
      AND (NULLIF(BTRIM(p_status), '') IS NULL OR r.status = BTRIM(p_status))
      AND (p_cost_centre_id IS NULL OR r.cost_centre_id = p_cost_centre_id)
      AND (
        v_search IS NULL
        OR r.req_no ILIKE '%' || v_search || '%'
        OR cc.name ILIKE '%' || v_search || '%'
        OR COALESCE(rp.full_name, '') ILIKE '%' || v_search || '%'
      )
      AND (NOT v_only_own OR r.requested_by = auth.uid())
    ORDER BY r.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;

  SELECT COUNT(*)
  INTO v_total
  FROM public.requisitions r
  JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
  LEFT JOIN public.profiles rp ON rp.id = r.requested_by
  WHERE r.property_id = p_property_id
    AND (NULLIF(BTRIM(p_status), '') IS NULL OR r.status = BTRIM(p_status))
    AND (p_cost_centre_id IS NULL OR r.cost_centre_id = p_cost_centre_id)
    AND (
      v_search IS NULL
      OR r.req_no ILIKE '%' || v_search || '%'
      OR cc.name ILIKE '%' || v_search || '%'
      OR COALESCE(rp.full_name, '') ILIKE '%' || v_search || '%'
    )
    AND (NOT v_only_own OR r.requested_by = auth.uid());

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'can_approve', public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve'),
    'can_issue', public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue'),
    'can_create', public.fn_employee_has_permission(p_property_id, 'stores.requisition.create'),
    'can_manage_cost_centres', public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_requisition_detail(
  p_property_id uuid,
  p_requisition_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payload jsonb;
  v_status text;
  v_requested_by uuid;
  v_settings public.stores_settings%ROWTYPE;
  v_can_approve boolean;
  v_can_issue boolean;
  v_can_edit boolean;
  v_can_cancel boolean;
  v_audit jsonb;
BEGIN
  IF NOT public.fn_stores_can_view_requisition(p_requisition_id) THEN
    RAISE EXCEPTION 'Not authorized to view this requisition' USING ERRCODE = '42501';
  END IF;

  v_payload := stock_internal.fn_stores_requisition_payload(p_property_id, p_requisition_id);

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Requisition not found' USING ERRCODE = 'P0002';
  END IF;

  v_status := v_payload->>'status';
  v_requested_by := NULLIF(v_payload->>'requested_by', '')::uuid;
  v_settings := stock_internal.fn_stores_settings_row(p_property_id);

  v_can_approve := public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
    AND v_status = 'submitted'
    AND (
      NOT v_settings.segregation_of_duties
      OR v_requested_by IS DISTINCT FROM auth.uid()
    );

  v_can_issue := public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue')
    AND v_status IN ('approved', 'partially_issued');

  v_can_edit := public.fn_employee_has_permission(p_property_id, 'stores.requisition.create')
    AND v_status = 'draft'
    AND (
      v_requested_by = auth.uid()
      OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
    );

  v_can_cancel := v_status IN ('draft', 'submitted', 'approved', 'partially_issued')
    AND (
      v_requested_by = auth.uid()
      OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
      OR public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
    );

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
      AND document_type = 'requisition'
      AND document_id = p_requisition_id
    ORDER BY created_at DESC
    LIMIT 50
  ) a
  LEFT JOIN public.profiles pr ON pr.id = a.actor_user_id;

  RETURN v_payload || jsonb_build_object(
    'can_approve', v_can_approve,
    'can_issue', v_can_issue,
    'can_edit', v_can_edit,
    'can_cancel', v_can_cancel,
    'audit', v_audit
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_requisition_products(
  p_property_id uuid,
  p_cost_centre_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_default_location_id uuid;
  v_default_location_name text;
  v_rows jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.requisition.create', 'stores.requisition.view', 'stores.requisition.issue']
  );

  IF p_cost_centre_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cost_centres
      WHERE id = p_cost_centre_id AND property_id = p_property_id
    ) THEN
      RAISE EXCEPTION 'Cost centre not found' USING ERRCODE = 'P0002';
    END IF;

    v_default_location_id := stock_internal.fn_stores_source_location(
      p_property_id, p_cost_centre_id
    );

    SELECT name INTO v_default_location_name
    FROM public.inventory_locations
    WHERE id = v_default_location_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', p.id,
    'name', p.name,
    'sku', p.sku,
    'category', p.category,
    'base_unit', p.base_unit,
    'stock_item_type', p.stock_item_type,
    'min_stock', p.min_stock,
    'cost_price', p.cost_price,
    'on_hand', COALESCE((
      SELECT psl.qty FROM public.product_stock_locations psl
      WHERE psl.product_id = p.id
        AND psl.location_id = v_default_location_id
    ), 0),
    'par_qty', COALESCE((
      SELECT MAX(l.qty)
      FROM public.cost_centre_par_lines l
      JOIN public.cost_centre_par_templates t ON t.id = l.template_id
      WHERE t.property_id = p_property_id
        AND t.cost_centre_id = p_cost_centre_id
        AND t.active
        AND l.product_id = p.id
    ), 0),
    'pending_qty', COALESCE((
      SELECT SUM(rl.approved_qty - rl.issued_qty)
      FROM public.requisition_lines rl
      JOIN public.requisitions r ON r.id = rl.requisition_id
      WHERE r.property_id = p_property_id
        AND r.cost_centre_id = p_cost_centre_id
        AND r.status IN ('approved', 'partially_issued')
        AND rl.product_id = p.id
        AND rl.approved_qty > rl.issued_qty
    ), 0)
  ) ORDER BY p.name), '[]'::jsonb)
  INTO v_rows
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND COALESCE(p.track_stock, true)
    AND COALESCE(p.stock_item_type, '') <> 'finished_good'
    AND NOT EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.property_id = p_property_id
        AND r.active
        AND LOWER(BTRIM(r.menu_item_name)) = LOWER(BTRIM(p.name))
    );

  RETURN jsonb_build_object(
    'rows', v_rows,
    'cost_centre_id', p_cost_centre_id,
    'default_location_id', v_default_location_id,
    'default_location_name', v_default_location_name
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION stock_internal.fn_stores_notify_user(uuid, uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_requisition_payload(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_stores_save_requisition(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_submit_requisition(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_decide_requisition(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_cancel_requisition(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_requisitions(uuid, text, uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_requisition_detail(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_requisition_products(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_stores_save_requisition(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_submit_requisition(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_decide_requisition(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_cancel_requisition(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_requisitions(uuid, text, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_requisition_detail(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_requisition_products(uuid, uuid) TO authenticated;

COMMIT;
