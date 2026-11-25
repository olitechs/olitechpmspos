-- Phase 1 Stores: cost centres, requisitions, issue notes, par templates and audit.
-- Additive only. No existing table, column, policy or function is dropped.
--
-- Stock never changes in this migration. Lifecycle RPCs live in
-- 20261123092000_phase1_stores_lifecycle_functions.sql and post through the
-- location-aware service in 20261123091000_phase1_stores_posting_service.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Stores settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores_settings (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  segregation_of_duties boolean NOT NULL DEFAULT true,
  requisition_approval_required boolean NOT NULL DEFAULT true,
  direct_issue_enabled boolean NOT NULL DEFAULT true,
  issue_discrepancy_window_hours integer NOT NULL DEFAULT 48
    CHECK (issue_discrepancy_window_hours >= 0),
  transfer_overdue_hours integer NOT NULL DEFAULT 24
    CHECK (transfer_overdue_hours >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 2. Cost centres
--
-- default_location_id is the DEFAULT ISSUING STORE for the department (D1).
-- A non-consuming department's destination is the inventory location whose
-- name equals the cost-centre name; it is created on first issue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  type text NOT NULL CHECK (type IN (
    'kitchen','bar','restaurant','housekeeping','laundry',
    'maintenance','front_office','spa','admin','other'
  )),
  default_location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  consumes_on_issue boolean NOT NULL DEFAULT false,
  approval_required boolean NOT NULL DEFAULT true,
  approval_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (approval_limit >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT cost_centres_property_code_key UNIQUE (property_id, code),
  CONSTRAINT cost_centres_property_name_key UNIQUE (property_id, name)
);
CREATE INDEX IF NOT EXISTS cost_centres_property_active_idx
  ON public.cost_centres(property_id, active, name);

-- ---------------------------------------------------------------------------
-- 3. Requisitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  req_no text NOT NULL,
  cost_centre_id uuid NOT NULL REFERENCES public.cost_centres(id) ON DELETE RESTRICT,
  from_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  needed_by date,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','urgent')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','partially_issued','issued','closed','cancelled')),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason text,
  closed_at timestamptz,
  notes text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requisitions_property_no_key UNIQUE (property_id, req_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS requisitions_property_idempotency_key
  ON public.requisitions(property_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS requisitions_property_status_idx
  ON public.requisitions(property_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS requisitions_property_cost_centre_idx
  ON public.requisitions(property_id, cost_centre_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requisitions_property_needed_by_idx
  ON public.requisitions(property_id, needed_by)
  WHERE needed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.requisition_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES public.requisitions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  requested_qty numeric(14,2) NOT NULL CHECK (requested_qty > 0),
  approved_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved_qty >= 0),
  issued_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  received_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_code text NOT NULL DEFAULT 'pcs' REFERENCES public.inventory_units(code),
  base_qty numeric(20,6) NOT NULL CHECK (base_qty >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requisition_lines_requisition_product_key UNIQUE (requisition_id, product_id)
);
CREATE INDEX IF NOT EXISTS requisition_lines_requisition_idx
  ON public.requisition_lines(requisition_id);
CREATE INDEX IF NOT EXISTS requisition_lines_product_idx
  ON public.requisition_lines(product_id);

-- ---------------------------------------------------------------------------
-- 4. Issue notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issue_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  issue_no text NOT NULL,
  requisition_id uuid REFERENCES public.requisitions(id) ON DELETE SET NULL,
  cost_centre_id uuid NOT NULL REFERENCES public.cost_centres(id) ON DELETE RESTRICT,
  from_location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id uuid REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','in_transit','received','discrepancy','voided')),
  notes text,
  issued_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at timestamptz,
  received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_at timestamptz,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_notes_property_no_key UNIQUE (property_id, issue_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_notes_property_idempotency_key
  ON public.issue_notes(property_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS issue_notes_property_status_idx
  ON public.issue_notes(property_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_notes_property_cost_centre_idx
  ON public.issue_notes(property_id, cost_centre_id, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_notes_property_requisition_idx
  ON public.issue_notes(requisition_id)
  WHERE requisition_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.issue_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_note_id uuid NOT NULL REFERENCES public.issue_notes(id) ON DELETE CASCADE,
  requisition_line_id uuid REFERENCES public.requisition_lines(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL CHECK (qty > 0),
  unit_code text NOT NULL DEFAULT 'pcs' REFERENCES public.inventory_units(code),
  base_qty numeric(20,6) NOT NULL CHECK (base_qty >= 0),
  unit_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(20,6) GENERATED ALWAYS AS (round(qty * unit_cost, 2)) STORED,
  received_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  discrepancy_qty numeric(14,2) NOT NULL DEFAULT 0 CHECK (discrepancy_qty >= 0),
  discrepancy_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_note_lines_note_product_key UNIQUE (issue_note_id, product_id),
  CONSTRAINT issue_note_lines_received_within_qty CHECK (received_qty <= qty),
  CONSTRAINT issue_note_lines_discrepancy_within_qty CHECK (discrepancy_qty <= qty)
);
CREATE INDEX IF NOT EXISTS issue_note_lines_note_idx
  ON public.issue_note_lines(issue_note_id);
CREATE INDEX IF NOT EXISTS issue_note_lines_product_idx
  ON public.issue_note_lines(product_id);

-- ---------------------------------------------------------------------------
-- 5. Saved par templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cost_centre_par_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  cost_centre_id uuid NOT NULL REFERENCES public.cost_centres(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_centre_par_templates_property_cc_name_key
    UNIQUE (property_id, cost_centre_id, name)
);
CREATE INDEX IF NOT EXISTS cost_centre_par_templates_cc_idx
  ON public.cost_centre_par_templates(cost_centre_id, active);

CREATE TABLE IF NOT EXISTS public.cost_centre_par_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.cost_centre_par_templates(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  qty numeric(14,2) NOT NULL CHECK (qty > 0),
  unit_code text NOT NULL DEFAULT 'pcs' REFERENCES public.inventory_units(code),
  CONSTRAINT cost_centre_par_lines_template_product_key UNIQUE (template_id, product_id)
);
CREATE INDEX IF NOT EXISTS cost_centre_par_lines_template_idx
  ON public.cost_centre_par_lines(template_id);

-- ---------------------------------------------------------------------------
-- 6. Document audit (D10)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores_document_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN (
    'requisition','issue_note','cost_centre','stores_settings','par_template'
  )),
  document_id uuid NOT NULL,
  action text NOT NULL,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stores_document_audit_document_idx
  ON public.stores_document_audit(property_id, document_type, document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stores_document_audit_property_idx
  ON public.stores_document_audit(property_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. In-app Stores notifications
--
-- There is no push/email notification subsystem in this repository, so the
-- Stores queue is the notification surface. Rows are fanned out to individual
-- staff at write time, which keeps per-user read state accurate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  recipient_staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN (
    'requisition_submitted','requisition_approved','requisition_rejected',
    'requisition_cancelled','issue_posted','issue_received','issue_voided'
  )),
  document_type text NOT NULL CHECK (document_type IN ('requisition','issue_note')),
  document_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stores_notifications_recipient_idx
  ON public.stores_notifications(property_id, recipient_staff_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS stores_notifications_document_idx
  ON public.stores_notifications(property_id, document_type, document_id);

-- ---------------------------------------------------------------------------
-- 8. Seed and audit helpers
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS stock_internal;
REVOKE ALL ON SCHEMA stock_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_seed_cost_centres(p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'A property is required to seed cost centres.';
  END IF;

  INSERT INTO public.inventory_locations(property_id, name)
  SELECT p_property_id, x.name
  FROM (VALUES
    ('Main Store'), ('Kitchen'), ('Bar'), ('Restaurant'),
    ('Housekeeping'), ('Laundry'), ('Maintenance'), ('Front Office'), ('Spa')
  ) AS x(name)
  ON CONFLICT (property_id, name) DO NOTHING;

  INSERT INTO public.cost_centres(
    property_id, code, name, type, consumes_on_issue, approval_required
  )
  VALUES
    (p_property_id, 'kitchen',      'Kitchen',       'kitchen',      false, true),
    (p_property_id, 'bar',          'Bar',           'bar',          false, true),
    (p_property_id, 'restaurant',   'Restaurant',    'restaurant',   false, true),
    (p_property_id, 'housekeeping', 'Housekeeping',  'housekeeping', true,  true),
    (p_property_id, 'laundry',      'Laundry',       'laundry',      true,  true),
    (p_property_id, 'maintenance',  'Maintenance',   'maintenance',  true,  true),
    (p_property_id, 'front_office', 'Front Office',  'front_office', true,  true),
    (p_property_id, 'spa',          'Spa',           'spa',          true,  true),
    (p_property_id, 'admin',        'Administration','admin',        true,  true)
  ON CONFLICT (property_id, code) DO NOTHING;

  -- D1: the default source for every seeded department is the main issuing
  -- store. Back Office may change it to a dedicated store later.
  UPDATE public.cost_centres cc
  SET default_location_id = il.id,
      updated_at = now()
  FROM public.inventory_locations il
  WHERE cc.property_id = p_property_id
    AND cc.default_location_id IS NULL
    AND il.property_id = p_property_id
    AND il.name = 'Main Store';
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_ensure_settings(p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'A property is required to initialise Stores settings.';
  END IF;

  INSERT INTO public.stores_settings(property_id)
  VALUES (p_property_id)
  ON CONFLICT (property_id) DO NOTHING;

  PERFORM stock_internal.fn_stores_seed_cost_centres(p_property_id);
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_stores_audit(
  p_property_id uuid,
  p_document_type text,
  p_document_id uuid,
  p_action text,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.stores_document_audit(
    property_id, document_type, document_id, action,
    actor_user_id, actor_staff_id, before, after, reason
  )
  VALUES (
    p_property_id, p_document_type, p_document_id, p_action,
    auth.uid(), public.current_staff_id(p_property_id),
    p_before, p_after, NULLIF(btrim(p_reason), '')
  );
END
$function$;

REVOKE ALL ON FUNCTION stock_internal.fn_stores_seed_cost_centres(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_ensure_settings(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_stores_audit(uuid, text, uuid, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Visibility helpers used by RLS and list RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stores_can_view_all_requisitions(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.is_platform_owner()
    OR public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve')
    OR public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue')
    OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage');
$function$;

CREATE OR REPLACE FUNCTION public.fn_stores_can_view_requisition(p_requisition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.requisitions r
    WHERE r.id = p_requisition_id
      AND (
        public.is_platform_owner()
        OR (
          public.fn_subscription_module_allowed(r.property_id, 'store')
          AND (
            public.fn_stores_can_view_all_requisitions(r.property_id)
            OR r.requested_by = auth.uid()
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_stores_can_view_all_requisitions(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_stores_can_view_requisition(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_stores_can_view_all_requisitions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_stores_can_view_requisition(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.stores_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centre_par_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centre_par_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores_document_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_settings_select ON public.stores_settings;
CREATE POLICY stores_settings_select ON public.stores_settings
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND public.fn_employee_has_permission(property_id, 'stores.access')
    )
  );

DROP POLICY IF EXISTS cost_centres_select ON public.cost_centres;
CREATE POLICY cost_centres_select ON public.cost_centres
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND public.fn_employee_has_permission(property_id, 'stores.access')
    )
  );

DROP POLICY IF EXISTS requisitions_select ON public.requisitions;
CREATE POLICY requisitions_select ON public.requisitions
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        public.fn_stores_can_view_all_requisitions(property_id)
        OR (
          requested_by = auth.uid()
          AND (
            public.fn_employee_has_permission(property_id, 'stores.requisition.view')
            OR public.fn_employee_has_permission(property_id, 'stores.requisition.create')
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS requisition_lines_select ON public.requisition_lines;
CREATE POLICY requisition_lines_select ON public.requisition_lines
  FOR SELECT TO authenticated
  USING (public.fn_stores_can_view_requisition(requisition_id));

DROP POLICY IF EXISTS issue_notes_select ON public.issue_notes;
CREATE POLICY issue_notes_select ON public.issue_notes
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        public.fn_employee_has_permission(property_id, 'stores.requisition.view')
        OR public.fn_employee_has_permission(property_id, 'stores.requisition.issue')
        OR public.fn_employee_has_permission(property_id, 'stores.requisition.receive')
        OR public.fn_employee_has_permission(property_id, 'stores.requisition.approve')
        OR public.fn_employee_has_permission(property_id, 'stores.issue.void')
      )
    )
  );

-- Issue line costs are deliberately not readable through PostgREST. Detail
-- screens use fn_stores_issue_note_detail(), which omits cost fields for
-- users without stores.costs.view.
DROP POLICY IF EXISTS issue_note_lines_select ON public.issue_note_lines;

DROP POLICY IF EXISTS cost_centre_par_templates_select ON public.cost_centre_par_templates;
CREATE POLICY cost_centre_par_templates_select ON public.cost_centre_par_templates
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        public.fn_employee_has_permission(property_id, 'stores.requisition.create')
        OR public.fn_employee_has_permission(property_id, 'stores.requisition.view')
        OR public.fn_employee_has_permission(property_id, 'stores.requisition.issue')
      )
    )
  );

DROP POLICY IF EXISTS cost_centre_par_lines_select ON public.cost_centre_par_lines;
CREATE POLICY cost_centre_par_lines_select ON public.cost_centre_par_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cost_centre_par_templates t
      WHERE t.id = template_id
    )
  );

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
      )
    )
  );

DROP POLICY IF EXISTS stores_notifications_select ON public.stores_notifications;
CREATE POLICY stores_notifications_select ON public.stores_notifications
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR (
      public.fn_subscription_module_allowed(property_id, 'store')
      AND (
        recipient_user_id = auth.uid()
        OR recipient_staff_id = public.current_staff_id(property_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 11. Privileges: reads only; every write is an RPC.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.stores_settings FROM anon, authenticated;
REVOKE ALL ON public.cost_centres FROM anon, authenticated;
REVOKE ALL ON public.requisitions FROM anon, authenticated;
REVOKE ALL ON public.requisition_lines FROM anon, authenticated;
REVOKE ALL ON public.issue_notes FROM anon, authenticated;
REVOKE ALL ON public.issue_note_lines FROM anon, authenticated;
REVOKE ALL ON public.cost_centre_par_templates FROM anon, authenticated;
REVOKE ALL ON public.cost_centre_par_lines FROM anon, authenticated;
REVOKE ALL ON public.stores_document_audit FROM anon, authenticated;
REVOKE ALL ON public.stores_notifications FROM anon, authenticated;

GRANT SELECT ON public.stores_settings TO authenticated;
GRANT SELECT ON public.cost_centres TO authenticated;
GRANT SELECT ON public.requisitions TO authenticated;
GRANT SELECT ON public.requisition_lines TO authenticated;
GRANT SELECT ON public.issue_notes TO authenticated;
GRANT SELECT ON public.cost_centre_par_templates TO authenticated;
GRANT SELECT ON public.cost_centre_par_lines TO authenticated;
GRANT SELECT ON public.stores_document_audit TO authenticated;
GRANT SELECT ON public.stores_notifications TO authenticated;
-- issue_note_lines: intentionally no table read grant.

-- ---------------------------------------------------------------------------
-- 12. Subscription operational guard for the new property-scoped tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores_settings', 'cost_centres', 'requisitions',
    'issue_notes', 'cost_centre_par_templates', 'stores_document_audit',
    'stores_notifications'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_assert_operational ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_assert_operational BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.fn_assert_property_row_operational()',
      t
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
