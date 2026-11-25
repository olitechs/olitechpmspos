-- Phase 2 Stores: in-transit transfer documents.
--
-- Additive only. Existing stock_transfers rows are preserved and backfilled with
-- gap-free TRF document numbers from the Phase 1 allocator. No stock is moved
-- here. All posting happens through the public lifecycle functions in
-- 20261124101000_phase2_stores_transfer_functions.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Transfer document columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS document_no text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS expected_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_by_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS discrepancies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_overdue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Widen the status check without dropping data. `completed` stays valid for
-- legacy and fully received documents.
DO $phase2$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stock_transfers'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.stock_transfers DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.stock_transfers
    ADD CONSTRAINT stock_transfers_status_check_v2
    CHECK (status IN (
      'pending', 'draft', 'dispatched', 'in_transit', 'received',
      'completed', 'discrepancy', 'cancelled'
    ));
END
$phase2$;

-- ---------------------------------------------------------------------------
-- 2. Stable line identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL CHECK (qty > 0 AND qty = ROUND(qty, 2)),
  dispatched_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  received_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_cost numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, line_no)
);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_transfer_idx
  ON public.stock_transfer_lines(transfer_id, line_no);
CREATE INDEX IF NOT EXISTS stock_transfer_lines_product_idx
  ON public.stock_transfer_lines(property_id, product_id);

ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.stock_transfer_lines FROM anon, authenticated;
GRANT SELECT ON public.stock_transfer_lines TO authenticated;

DROP POLICY IF EXISTS stock_transfer_lines_select ON public.stock_transfer_lines;
CREATE POLICY stock_transfer_lines_select ON public.stock_transfer_lines
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        public.fn_employee_has_permission(property_id, 'stores.stock.transfer')
        OR public.fn_employee_has_permission(property_id, 'stores.stock.receive')
        OR public.fn_employee_has_permission(property_id, 'stores.inventory.view')
      )
    )
  );

-- Tighten the legacy transfer table policy. Direct table reads now require an
-- enabled Stores subscription; all writes remain server-authoritative.
DROP POLICY IF EXISTS stock_transfers_select ON public.stock_transfers;
CREATE POLICY stock_transfers_select ON public.stock_transfers
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND public.is_member_of_property(property_id)
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.stock_transfers FROM anon, authenticated;
GRANT SELECT ON public.stock_transfers TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit and notification vocabulary
-- ---------------------------------------------------------------------------
DO $phase2$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stores_document_audit'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%document_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.stores_document_audit DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.stores_document_audit
    ADD CONSTRAINT stores_document_audit_document_type_check_v2
    CHECK (document_type IN (
      'requisition','issue_note','cost_centre','stores_settings','par_template',
      'stock_transfer'
    ));
END
$phase2$;

DO $phase2$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stores_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.stores_notifications DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.stores_notifications
    ADD CONSTRAINT stores_notifications_kind_check_v2
    CHECK (kind IN (
      'requisition_submitted','requisition_approved','requisition_rejected',
      'requisition_cancelled','issue_posted','issue_received','issue_voided',
      'transfer_created','transfer_dispatched','transfer_received',
      'transfer_discrepancy','transfer_overdue','transfer_cancelled'
    ));
END
$phase2$;

DO $phase2$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.stores_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%document_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.stores_notifications DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.stores_notifications
    ADD CONSTRAINT stores_notifications_document_type_check_v2
    CHECK (document_type IN ('requisition','issue_note','stock_transfer'));
END
$phase2$;

-- Transfer actors must be able to read the audit trail they created.
DROP POLICY IF EXISTS stores_document_audit_select ON public.stores_document_audit;
CREATE POLICY stores_document_audit_select ON public.stores_document_audit
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        public.fn_employee_has_permission(property_id, 'stores.requisition.view')
        OR public.fn_employee_has_permission(property_id, 'stores.costcentre.manage')
        OR public.fn_employee_has_permission(property_id, 'stores.stock.transfer')
        OR public.fn_employee_has_permission(property_id, 'stores.stock.receive')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Transit location and line-JSON helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_internal.fn_stores_transit_location(p_property_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, 'In Transit')
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id INTO v_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = 'In Transit'
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'The transit location could not be resolved';
  END IF;

  RETURN v_location_id;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_transfer_lines_json(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lines jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'line_id', l.id,
      'product_id', l.product_id,
      'line_no', l.line_no,
      'qty', l.qty,
      'dispatched_qty', l.dispatched_qty,
      'received_qty', l.received_qty
    ) ORDER BY l.line_no), '[]'::jsonb)
  INTO v_lines
  FROM public.stock_transfer_lines l
  WHERE l.transfer_id = p_transfer_id;

  RETURN v_lines;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_transfer_audit(
  p_property_id uuid,
  p_transfer_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.stores_document_audit(
    property_id, document_type, document_id, action,
    actor_user_id, actor_staff_id, before, after, reason
  )
  VALUES (
    p_property_id, 'stock_transfer', p_transfer_id, p_action,
    auth.uid(), public.current_staff_id(p_property_id), p_before, p_after, p_reason
  );
END
$function$;

REVOKE ALL ON FUNCTION stock_internal.fn_stores_transit_location(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_transfer_lines_json(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_transfer_audit(uuid, uuid, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill existing documents and line identities
-- ---------------------------------------------------------------------------
DO $phase2$
DECLARE
  v_transfer record;
  v_document_no text;
BEGIN
  FOR v_transfer IN
    SELECT id, property_id
    FROM public.stock_transfers
    WHERE document_no IS NULL
    ORDER BY property_id, created_at, id
  LOOP
    v_document_no := stock_internal.fn_stores_allocate_number(
      v_transfer.property_id, 'stores_transfer', 'TRF'
    );

    UPDATE public.stock_transfers
    SET document_no = v_document_no,
        updated_at = now()
    WHERE id = v_transfer.id;
  END LOOP;
END
$phase2$;

INSERT INTO public.stock_transfer_lines(
  property_id, transfer_id, line_no, product_id, qty,
  dispatched_qty, received_qty
)
SELECT
  t.property_id,
  t.id,
  x.ordinality::integer,
  NULLIF(x.line ->> 'product_id', '')::uuid,
  COALESCE((x.line ->> 'qty')::numeric, 0),
  CASE WHEN t.status IN ('completed', 'received', 'discrepancy')
    THEN COALESCE((x.line ->> 'qty')::numeric, 0) ELSE 0 END,
  CASE WHEN t.status IN ('completed', 'received')
    THEN COALESCE((x.line ->> 'qty')::numeric, 0) ELSE 0 END
FROM public.stock_transfers t
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.lines, '[]'::jsonb)) WITH ORDINALITY AS x(line, ordinality)
WHERE NULLIF(x.line ->> 'product_id', '')::uuid IS NOT NULL
  AND COALESCE((x.line ->> 'qty')::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_transfer_lines l
    WHERE l.transfer_id = t.id AND l.line_no = x.ordinality::integer
  );

-- Keep the legacy JSONB shape useful while making line_id authoritative.
UPDATE public.stock_transfers t
SET lines = stock_internal.fn_stores_transfer_lines_json(t.id)
WHERE EXISTS (
  SELECT 1 FROM public.stock_transfer_lines l WHERE l.transfer_id = t.id
);

ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_property_document_no_key
  UNIQUE (property_id, document_no);

CREATE INDEX IF NOT EXISTS stock_transfers_property_status_idx
  ON public.stock_transfers(property_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_property_expected_idx
  ON public.stock_transfers(property_id, expected_at)
  WHERE status = 'in_transit';

COMMIT;
