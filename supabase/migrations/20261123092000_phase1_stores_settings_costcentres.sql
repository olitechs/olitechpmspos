-- Phase 1 Stores lifecycle, part 1: guard helpers, settings, cost centres,
-- saved par templates and notification fan-out.
--
-- Every public function is SECURITY DEFINER and performs its own property,
-- subscription and permission checks. No browser-supplied permission list is
-- ever trusted.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guard and utility helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_assert(
  p_property_id uuid,
  p_permission text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'A property is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized for this property' USING ERRCODE = '42501';
  END IF;

  IF public.is_platform_owner() THEN
    RETURN;
  END IF;

  IF NOT public.fn_subscription_module_allowed(p_property_id, 'store') THEN
    RAISE EXCEPTION 'The Stores module is not enabled for this subscription'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(p_permission), '') IS NOT NULL
     AND NOT public.fn_employee_has_permission(p_property_id, p_permission) THEN
    RAISE EXCEPTION 'Permission % is required', p_permission
      USING ERRCODE = '42501';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_assert_any(
  p_property_id uuid,
  p_permissions text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_permission text;
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'A property is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized for this property' USING ERRCODE = '42501';
  END IF;

  IF public.is_platform_owner() THEN
    RETURN;
  END IF;

  IF NOT public.fn_subscription_module_allowed(p_property_id, 'store') THEN
    RAISE EXCEPTION 'The Stores module is not enabled for this subscription'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_permission IN ARRAY COALESCE(p_permissions, '{}'::text[])
  LOOP
    IF public.fn_employee_has_permission(p_property_id, v_permission) THEN
      RETURN;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'You do not have permission to perform this Stores action'
    USING ERRCODE = '42501';
END
$function$;

-- Gap-free per-property document numbers. Reuses the receipt sequence table
-- but pads to six digits. Receipt numbering is untouched.
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_allocate_number(
  p_property_id uuid,
  p_book text,
  p_prefix text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_number bigint;
BEGIN
  IF p_property_id IS NULL
     OR NULLIF(BTRIM(p_book), '') IS NULL
     OR NULLIF(BTRIM(p_prefix), '') IS NULL THEN
    RAISE EXCEPTION 'A property, document book and prefix are required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.property_document_sequences(property_id, book, prefix, next_number)
  VALUES (p_property_id, BTRIM(p_book), UPPER(BTRIM(p_prefix)), 1)
  ON CONFLICT (property_id, book) DO NOTHING;

  UPDATE public.property_document_sequences
  SET next_number = next_number + 1,
      prefix = UPPER(BTRIM(p_prefix)),
      updated_at = now()
  WHERE property_id = p_property_id
    AND book = BTRIM(p_book)
  RETURNING next_number - 1 INTO v_number;

  RETURN UPPER(BTRIM(p_prefix)) || '-' || LPAD(v_number::text, 6, '0');
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_settings_row(p_property_id uuid)
RETURNS public.stores_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settings public.stores_settings%ROWTYPE;
BEGIN
  PERFORM stock_internal.fn_stores_ensure_settings(p_property_id);
  SELECT * INTO v_settings
  FROM public.stores_settings
  WHERE property_id = p_property_id;
  RETURN v_settings;
END
$function$;

-- Default ISSUING store for a cost centre (decision D1).
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_source_location(
  p_property_id uuid,
  p_cost_centre_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  SELECT default_location_id
  INTO v_location_id
  FROM public.cost_centres
  WHERE id = p_cost_centre_id
    AND property_id = p_property_id;

  IF v_location_id IS NOT NULL THEN
    RETURN v_location_id;
  END IF;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = 'Main Store'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    INSERT INTO public.inventory_locations(property_id, name)
    VALUES (p_property_id, 'Main Store')
    ON CONFLICT (property_id, name) DO NOTHING;

    SELECT id
    INTO v_location_id
    FROM public.inventory_locations
    WHERE property_id = p_property_id
      AND name = 'Main Store'
    LIMIT 1;
  END IF;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'No issuing store is configured for this property';
  END IF;

  RETURN v_location_id;
END
$function$;

-- Department destination for non-consuming issues. The location name matches
-- the cost-centre name and is created on first issue (decision D3).
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_department_location(
  p_property_id uuid,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_name text;
  v_location_id uuid;
BEGIN
  v_name := NULLIF(BTRIM(p_name), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A department location name is required';
  END IF;

  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, v_name)
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = v_name
  LIMIT 1;

  RETURN v_location_id;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_product_eligible(
  p_property_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.property_id = p_property_id
      AND COALESCE(p.track_stock, true)
      AND COALESCE(p.stock_item_type, '') <> 'finished_good'
      AND NOT EXISTS (
        SELECT 1
        FROM public.recipes r
        WHERE r.property_id = p_property_id
          AND r.active
          AND LOWER(BTRIM(r.menu_item_name)) = LOWER(BTRIM(p.name))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_notify_staff(
  p_property_id uuid,
  p_staff_id uuid,
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
  v_user_id uuid;
BEGIN
  IF p_staff_id IS NULL THEN
    RETURN;
  END IF;

  SELECT user_id
  INTO v_user_id
  FROM public.staff
  WHERE id = p_staff_id
    AND property_id = p_property_id
    AND is_active;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.stores_notifications(
    property_id, recipient_staff_id, recipient_user_id,
    kind, document_type, document_id, title, body
  )
  VALUES (
    p_property_id, p_staff_id, v_user_id,
    p_kind, p_document_type, p_document_id, p_title, p_body
  );
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_notify_permission(
  p_property_id uuid,
  p_permission text,
  p_kind text,
  p_document_type text,
  p_document_id uuid,
  p_title text,
  p_body text DEFAULT NULL,
  p_exclude_staff_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff record;
BEGIN
  FOR v_staff IN
    SELECT s.id
    FROM public.staff s
    WHERE s.property_id = p_property_id
      AND s.is_active
      AND (p_exclude_staff_id IS NULL OR s.id <> p_exclude_staff_id)
      AND public.fn_employee_has_permission(p_property_id, p_permission, s.id)
  LOOP
    PERFORM stock_internal.fn_stores_notify_staff(
      p_property_id, v_staff.id, p_kind, p_document_type,
      p_document_id, p_title, p_body
    );
  END LOOP;
END
$function$;

-- ---------------------------------------------------------------------------
-- 2. Settings RPCs
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
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.access');
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

CREATE OR REPLACE FUNCTION public.fn_stores_update_settings(
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
  v_before jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.costcentre.manage');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A settings payload object is required' USING ERRCODE = '22023';
  END IF;

  v_settings := stock_internal.fn_stores_settings_row(p_property_id);
  v_before := to_jsonb(v_settings);

  UPDATE public.stores_settings
  SET segregation_of_duties = COALESCE((p_payload->>'segregation_of_duties')::boolean, segregation_of_duties),
      requisition_approval_required = COALESCE((p_payload->>'requisition_approval_required')::boolean, requisition_approval_required),
      direct_issue_enabled = COALESCE((p_payload->>'direct_issue_enabled')::boolean, direct_issue_enabled),
      issue_discrepancy_window_hours = COALESCE((p_payload->>'issue_discrepancy_window_hours')::integer, issue_discrepancy_window_hours),
      transfer_overdue_hours = COALESCE((p_payload->>'transfer_overdue_hours')::integer, transfer_overdue_hours),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE property_id = p_property_id
  RETURNING * INTO v_settings;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'stores_settings', p_property_id, 'update', v_before, to_jsonb(v_settings)
  );

  RETURN public.fn_stores_get_settings(p_property_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 3. Cost centre RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_cost_centre_json(
  p_property_id uuid,
  p_cost_centre_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', cc.id,
    'code', cc.code,
    'name', cc.name,
    'type', cc.type,
    'default_location_id', cc.default_location_id,
    'default_location_name', dl.name,
    'destination_location_id', (
      SELECT il.id FROM public.inventory_locations il
      WHERE il.property_id = cc.property_id AND il.name = cc.name
      LIMIT 1
    ),
    'consumes_on_issue', cc.consumes_on_issue,
    'approval_required', cc.approval_required,
    'approval_limit', cc.approval_limit,
    'active', cc.active,
    'created_at', cc.created_at,
    'updated_at', cc.updated_at
  )
  FROM public.cost_centres cc
  LEFT JOIN public.inventory_locations dl ON dl.id = cc.default_location_id
  WHERE cc.property_id = p_property_id
    AND cc.id = p_cost_centre_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_list_cost_centres(p_property_id uuid)
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
    ARRAY['stores.access', 'stores.requisition.create', 'stores.costcentre.manage']
  );

  PERFORM stock_internal.fn_stores_ensure_settings(p_property_id);

  SELECT COALESCE(jsonb_agg(
    stock_internal.fn_stores_cost_centre_json(p_property_id, cc.id)
    ORDER BY cc.active DESC, cc.name
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.cost_centres cc
  WHERE cc.property_id = p_property_id;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'can_manage', public.is_platform_owner()
      OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_upsert_cost_centre(
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
  v_code text;
  v_name text;
  v_type text;
  v_default_location_id uuid;
  v_before jsonb;
  v_existing public.cost_centres%ROWTYPE;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.costcentre.manage');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A cost centre payload object is required' USING ERRCODE = '22023';
  END IF;

  v_id := NULLIF(p_payload->>'id', '')::uuid;
  v_name := NULLIF(BTRIM(p_payload->>'name'), '');
  v_type := LOWER(NULLIF(BTRIM(p_payload->>'type'), ''));
  v_code := LOWER(NULLIF(BTRIM(p_payload->>'code'), ''));
  v_default_location_id := NULLIF(p_payload->>'default_location_id', '')::uuid;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A cost centre name is required' USING ERRCODE = '22023';
  END IF;

  IF v_type IS NULL OR v_type NOT IN (
    'kitchen','bar','restaurant','housekeeping','laundry',
    'maintenance','front_office','spa','admin','other'
  ) THEN
    RAISE EXCEPTION 'Invalid cost centre type' USING ERRCODE = '22023';
  END IF;

  IF v_default_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = v_default_location_id AND il.property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'The default issuing store does not belong to this property'
      USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    v_code := COALESCE(
      v_code,
      NULLIF(TRIM(BOTH '_' FROM LOWER(REGEXP_REPLACE(v_name, '[^a-zA-Z0-9]+', '_', 'g'))), '')
    );

    IF v_code IS NULL OR v_code !~ '^[a-z0-9_]{2,32}$' THEN
      RAISE EXCEPTION 'Provide a code using 2-32 lowercase letters, digits or underscores'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cost_centres(
      property_id, code, name, type, default_location_id,
      consumes_on_issue, approval_required, approval_limit, active,
      created_by, updated_by
    )
    VALUES (
      p_property_id, v_code, v_name, v_type,
      COALESCE(v_default_location_id, stock_internal.fn_stores_source_location(p_property_id, NULL)),
      COALESCE((p_payload->>'consumes_on_issue')::boolean, false),
      COALESCE((p_payload->>'approval_required')::boolean, true),
      COALESCE((p_payload->>'approval_limit')::numeric, 0),
      COALESCE((p_payload->>'active')::boolean, true),
      auth.uid(), auth.uid()
    )
    RETURNING id INTO v_id;

    v_before := NULL;
  ELSE
    SELECT * INTO v_existing
    FROM public.cost_centres
    WHERE id = v_id AND property_id = p_property_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cost centre not found' USING ERRCODE = 'P0002';
    END IF;

    v_before := stock_internal.fn_stores_cost_centre_json(p_property_id, v_id);
    v_code := COALESCE(v_code, v_existing.code);

    IF v_code !~ '^[a-z0-9_]{2,32}$' THEN
      RAISE EXCEPTION 'Invalid cost centre code' USING ERRCODE = '22023';
    END IF;

    UPDATE public.cost_centres
    SET code = v_code,
        name = v_name,
        type = v_type,
        default_location_id = COALESCE(v_default_location_id, default_location_id),
        consumes_on_issue = COALESCE((p_payload->>'consumes_on_issue')::boolean, consumes_on_issue),
        approval_required = COALESCE((p_payload->>'approval_required')::boolean, approval_required),
        approval_limit = COALESCE((p_payload->>'approval_limit')::numeric, approval_limit),
        active = COALESCE((p_payload->>'active')::boolean, active),
        updated_at = now(),
        updated_by = auth.uid()
    WHERE id = v_id AND property_id = p_property_id;
  END IF;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'cost_centre', v_id,
    CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END,
    v_before, stock_internal.fn_stores_cost_centre_json(p_property_id, v_id)
  );

  RETURN stock_internal.fn_stores_cost_centre_json(p_property_id, v_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 4. Saved par templates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_par_template_json(
  p_property_id uuid,
  p_template_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', t.id,
    'cost_centre_id', t.cost_centre_id,
    'cost_centre_name', cc.name,
    'name', t.name,
    'active', t.active,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'product_id', l.product_id,
        'product_name', p.name,
        'sku', p.sku,
        'qty', l.qty,
        'unit_code', l.unit_code,
        'base_unit', p.base_unit
      ) ORDER BY p.name)
      FROM public.cost_centre_par_lines l
      JOIN public.products p ON p.id = l.product_id
      WHERE l.template_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.cost_centre_par_templates t
  JOIN public.cost_centres cc ON cc.id = t.cost_centre_id
  WHERE t.property_id = p_property_id
    AND t.id = p_template_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_list_par_templates(
  p_property_id uuid,
  p_cost_centre_id uuid DEFAULT NULL
)
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
    ARRAY['stores.requisition.create', 'stores.requisition.view', 'stores.requisition.issue', 'stores.costcentre.manage']
  );

  SELECT COALESCE(jsonb_agg(
    stock_internal.fn_stores_par_template_json(p_property_id, t.id)
    ORDER BY cc.name, t.name
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.cost_centre_par_templates t
  JOIN public.cost_centres cc ON cc.id = t.cost_centre_id
  WHERE t.property_id = p_property_id
    AND (p_cost_centre_id IS NULL OR t.cost_centre_id = p_cost_centre_id);

  RETURN jsonb_build_object('rows', v_rows);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_save_par_template(
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
  v_cost_centre_id uuid;
  v_name text;
  v_active boolean;
  v_before jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_unit_code text;
  v_seen uuid[] := '{}'::uuid[];
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.costcentre.manage');

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'A par template payload object is required' USING ERRCODE = '22023';
  END IF;

  v_id := NULLIF(p_payload->>'id', '')::uuid;
  v_cost_centre_id := NULLIF(p_payload->>'cost_centre_id', '')::uuid;
  v_name := NULLIF(BTRIM(p_payload->>'name'), '');
  v_active := COALESCE((p_payload->>'active')::boolean, true);
  v_lines := p_payload->'lines';

  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'A par template name is required' USING ERRCODE = '22023';
  END IF;

  IF v_cost_centre_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cost_centres cc
    WHERE cc.id = v_cost_centre_id AND cc.property_id = p_property_id
  ) THEN
    RAISE EXCEPTION 'A valid cost centre is required' USING ERRCODE = '22023';
  END IF;

  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'At least one par line is required' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.cost_centre_par_templates(
      property_id, cost_centre_id, name, active, created_by, updated_by
    )
    VALUES (p_property_id, v_cost_centre_id, v_name, v_active, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
    v_before := NULL;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.cost_centre_par_templates t
      WHERE t.id = v_id AND t.property_id = p_property_id
    ) THEN
      RAISE EXCEPTION 'Par template not found' USING ERRCODE = 'P0002';
    END IF;

    v_before := stock_internal.fn_stores_par_template_json(p_property_id, v_id);

    UPDATE public.cost_centre_par_templates
    SET cost_centre_id = v_cost_centre_id,
        name = v_name,
        active = v_active,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE id = v_id AND property_id = p_property_id;

    DELETE FROM public.cost_centre_par_lines WHERE template_id = v_id;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty := (v_line->>'qty')::numeric;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty <> ROUND(v_qty, 2) THEN
      RAISE EXCEPTION 'Each par line needs a product and a positive 2-decimal quantity'
        USING ERRCODE = '22023';
    END IF;

    IF v_product_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'A product may only appear once in a par template'
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

    INSERT INTO public.cost_centre_par_lines(template_id, product_id, qty, unit_code)
    VALUES (v_id, v_product_id, v_qty, v_unit_code);
  END LOOP;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'par_template', v_id,
    CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END,
    v_before, stock_internal.fn_stores_par_template_json(p_property_id, v_id)
  );

  RETURN stock_internal.fn_stores_par_template_json(p_property_id, v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_archive_par_template(
  p_property_id uuid,
  p_template_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.costcentre.manage');

  SELECT stock_internal.fn_stores_par_template_json(p_property_id, p_template_id)
  INTO v_before;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Par template not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.cost_centre_par_templates
  SET active = false,
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = p_template_id AND property_id = p_property_id;

  PERFORM stock_internal.fn_stores_audit(
    p_property_id, 'par_template', p_template_id, 'archive',
    v_before, stock_internal.fn_stores_par_template_json(p_property_id, p_template_id)
  );

  RETURN stock_internal.fn_stores_par_template_json(p_property_id, p_template_id);
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Issuing-store picker
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
    ARRAY['stores.access', 'stores.requisition.create', 'stores.costcentre.manage']
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
-- 6. Internal privileges and public grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION stock_internal.fn_stores_assert(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_assert_any(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_allocate_number(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_settings_row(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_source_location(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_department_location(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_product_eligible(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_notify_staff(uuid, uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_notify_permission(uuid, text, text, text, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_cost_centre_json(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_par_template_json(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_stores_get_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_update_settings(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_cost_centres(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_upsert_cost_centre(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_par_templates(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_save_par_template(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_archive_par_template(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_locations(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_stores_get_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_update_settings(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_cost_centres(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_upsert_cost_centre(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_par_templates(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_save_par_template(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_archive_par_template(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_locations(uuid) TO authenticated;

COMMIT;
