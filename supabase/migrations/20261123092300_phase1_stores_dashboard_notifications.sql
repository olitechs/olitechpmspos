-- Phase 1 Stores lifecycle, part 4: dashboard counts and notification inbox.
-- Read-only. No stock or document state changes here.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_stores_dashboard(p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_view_all boolean;
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_pending bigint;
  v_approved bigint;
  v_partial bigint;
  v_drafts bigint;
  v_unconfirmed bigint;
  v_issues_today bigint;
  v_low_stock bigint;
  v_out_of_stock bigint;
  v_unread bigint;
  v_recent_requisitions jsonb;
  v_recent_issues jsonb;
  v_staff_id uuid;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.access');

  v_view_all := public.fn_stores_can_view_all_requisitions(p_property_id);
  v_staff_id := public.current_staff_id(p_property_id);

  SELECT COUNT(*) INTO v_pending
  FROM public.requisitions r
  WHERE r.property_id = p_property_id
    AND r.status = 'submitted'
    AND (v_view_all OR r.requested_by = auth.uid());

  SELECT COUNT(*) INTO v_approved
  FROM public.requisitions r
  WHERE r.property_id = p_property_id
    AND r.status = 'approved'
    AND (v_view_all OR r.requested_by = auth.uid());

  SELECT COUNT(*) INTO v_partial
  FROM public.requisitions r
  WHERE r.property_id = p_property_id
    AND r.status = 'partially_issued'
    AND (v_view_all OR r.requested_by = auth.uid());

  SELECT COUNT(*) INTO v_drafts
  FROM public.requisitions r
  WHERE r.property_id = p_property_id
    AND r.status = 'draft'
    AND r.requested_by = auth.uid();

  SELECT COUNT(*) INTO v_unconfirmed
  FROM public.issue_notes n
  WHERE n.property_id = p_property_id
    AND n.status = 'issued'
    AND n.to_location_id IS NOT NULL;

  SELECT COUNT(*) INTO v_issues_today
  FROM public.issue_notes n
  WHERE n.property_id = p_property_id
    AND n.status <> 'voided'
    AND n.issued_at IS NOT NULL
    AND (n.issued_at AT TIME ZONE 'Africa/Nairobi')::date = v_today;

  SELECT COUNT(*) INTO v_low_stock
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND COALESCE(p.track_stock, true)
    AND p.min_stock > 0
    AND p.current_stock <= p.min_stock
    AND p.current_stock > 0;

  SELECT COUNT(*) INTO v_out_of_stock
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND COALESCE(p.track_stock, true)
    AND p.current_stock <= 0;

  SELECT COUNT(*) INTO v_unread
  FROM public.stores_notifications n
  WHERE n.property_id = p_property_id
    AND n.read_at IS NULL
    AND (
      n.recipient_user_id = auth.uid()
      OR (v_staff_id IS NOT NULL AND n.recipient_staff_id = v_staff_id)
    );

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_recent_requisitions
  FROM (
    SELECT r.created_at, jsonb_build_object(
      'id', r.id,
      'req_no', r.req_no,
      'status', r.status,
      'priority', r.priority,
      'cost_centre_name', cc.name,
      'requested_by_name', rp.full_name,
      'created_at', r.created_at
    ) AS row_obj
    FROM public.requisitions r
    JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
    LEFT JOIN public.profiles rp ON rp.id = r.requested_by
    WHERE r.property_id = p_property_id
      AND (v_view_all OR r.requested_by = auth.uid())
    ORDER BY r.created_at DESC
    LIMIT 5
  ) x;

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_recent_issues
  FROM (
    SELECT n.created_at, jsonb_build_object(
      'id', n.id,
      'issue_no', n.issue_no,
      'status', n.status,
      'cost_centre_name', cc.name,
      'issued_by_name', ip.full_name,
      'created_at', n.created_at
    ) AS row_obj
    FROM public.issue_notes n
    JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
    LEFT JOIN public.profiles ip ON ip.id = n.issued_by
    WHERE n.property_id = p_property_id
    ORDER BY n.created_at DESC
    LIMIT 5
  ) x;

  RETURN jsonb_build_object(
    'pending_requisitions', v_pending,
    'approved_requisitions', v_approved,
    'partially_issued_requisitions', v_partial,
    'my_draft_requisitions', v_drafts,
    'unconfirmed_receipts', v_unconfirmed,
    'issues_today', v_issues_today,
    'low_stock_count', v_low_stock,
    'out_of_stock_count', v_out_of_stock,
    'unread_notifications', v_unread,
    'recent_requisitions', v_recent_requisitions,
    'recent_issues', v_recent_issues,
    'can_create', public.fn_employee_has_permission(p_property_id, 'stores.requisition.create'),
    'can_approve', public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve'),
    'can_issue', public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue'),
    'can_receive', public.fn_employee_has_permission(p_property_id, 'stores.requisition.receive'),
    'can_void', public.fn_employee_has_permission(p_property_id, 'stores.issue.void'),
    'can_view_costs', stock_internal.fn_stores_can_view_costs(p_property_id),
    'can_manage_cost_centres', public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_list_notifications(
  p_property_id uuid,
  p_unread_only boolean DEFAULT false,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_id uuid;
  v_rows jsonb;
  v_unread bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.access');

  v_staff_id := public.current_staff_id(p_property_id);

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT n.created_at, jsonb_build_object(
      'id', n.id,
      'kind', n.kind,
      'document_type', n.document_type,
      'document_id', n.document_id,
      'title', n.title,
      'body', n.body,
      'read_at', n.read_at,
      'created_at', n.created_at
    ) AS row_obj
    FROM public.stores_notifications n
    WHERE n.property_id = p_property_id
      AND (
        n.recipient_user_id = auth.uid()
        OR (v_staff_id IS NOT NULL AND n.recipient_staff_id = v_staff_id)
      )
      AND (NOT COALESCE(p_unread_only, false) OR n.read_at IS NULL)
    ORDER BY n.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
  ) x;

  SELECT COUNT(*) INTO v_unread
  FROM public.stores_notifications n
  WHERE n.property_id = p_property_id
    AND n.read_at IS NULL
    AND (
      n.recipient_user_id = auth.uid()
      OR (v_staff_id IS NOT NULL AND n.recipient_staff_id = v_staff_id)
    );

  RETURN jsonb_build_object('rows', v_rows, 'unread', v_unread);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_mark_notifications_read(
  p_property_id uuid,
  p_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_staff_id uuid;
  v_count integer;
BEGIN
  PERFORM stock_internal.fn_stores_assert(p_property_id, 'stores.access');

  v_staff_id := public.current_staff_id(p_property_id);

  UPDATE public.stores_notifications n
  SET read_at = now()
  WHERE n.property_id = p_property_id
    AND n.read_at IS NULL
    AND (
      n.recipient_user_id = auth.uid()
      OR (v_staff_id IS NOT NULL AND n.recipient_staff_id = v_staff_id)
    )
    AND (p_ids IS NULL OR n.id = ANY(p_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_stores_dashboard(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_list_notifications(uuid, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_mark_notifications_read(uuid, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_stores_dashboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_notifications(uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_mark_notifications_read(uuid, uuid[]) TO authenticated;

COMMIT;
