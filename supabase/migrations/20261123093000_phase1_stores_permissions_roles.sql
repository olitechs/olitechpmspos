-- Phase 1 Stores: permission catalog, seeded role templates and role backfill.
--
-- Adds the eight Stores codes introduced by the Phase 1 design and widens only
-- the roles that legitimately need them. The Storekeeper template never gains
-- approval, cost or cost-centre management. Existing custom roles are untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog
-- ---------------------------------------------------------------------------
INSERT INTO public.employee_permission_codes (code, workspace, label, sensitive, sort_order) VALUES
  ('stores.requisition.create',  'store', 'Create stock requisitions', false, 37),
  ('stores.requisition.view',    'store', 'View stock requisitions and issue notes', false, 38),
  ('stores.requisition.approve', 'store', 'Approve stock requisitions', true, 39),
  ('stores.requisition.issue',   'store', 'Issue stock against requisitions', true, 40),
  ('stores.requisition.receive', 'store', 'Confirm receipt of issued stock', false, 41),
  ('stores.issue.void',          'store', 'Void posted issue notes', true, 42),
  ('stores.costs.view',          'store', 'View issue-note costs', true, 43),
  ('stores.costcentre.manage',   'store', 'Manage cost centres and Stores settings', true, 44)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Permission resolver with the new default role codes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RETURN '{}'::text[];
  END IF;

  IF public.property_role(p_property_id) IN ('owner','admin') THEN
    RETURN ARRAY(SELECT code FROM public.employee_permission_codes ORDER BY sort_order);
  END IF;

  -- A non-admin may only resolve their own active staff identity.
  SELECT s.* INTO v_staff
  FROM public.staff s
  WHERE s.id = COALESCE(p_staff_id, public.current_staff_id(p_property_id))
    AND s.property_id = p_property_id
    AND s.is_active = true
    AND (
      s.user_id = auth.uid()
      OR LOWER(COALESCE(s.email,'')) = LOWER(COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()),''))
      OR s.id = public.current_staff_id(p_property_id)
    )
  LIMIT 1;

  IF v_staff.id IS NULL THEN
    RETURN '{}'::text[];
  END IF;

  v_assigned := COALESCE(v_staff.assigned_modules, '{}'::text[]);

  -- A selected custom role is authoritative, including an intentionally empty
  -- permission set. Otherwise use the built-in staff role permission map.
  IF v_staff.role_id IS NOT NULL THEN
    SELECT COALESCE(r.permission_codes, '{}'::text[]) INTO v_role_codes
    FROM public.employee_roles r
    WHERE r.id = v_staff.role_id AND r.property_id = p_property_id;
    IF NOT FOUND THEN v_role_codes := '{}'::text[]; END IF;
  ELSE
    v_role_codes := CASE v_staff.role
      WHEN 'super_admin' THEN ARRAY(SELECT code FROM public.employee_permission_codes)
      WHEN 'hotel_admin' THEN ARRAY(SELECT code FROM public.employee_permission_codes)
      WHEN 'front_office_manager' THEN ARRAY[
        'front_office.access','front_office.reservations.view','front_office.reservations.create',
        'front_office.checkin','front_office.checkout','front_office.folio.view',
        'front_office.folio.post_charge','front_office.folio.payment',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'receptionist' THEN ARRAY[
        'front_office.access','front_office.reservations.view','front_office.reservations.create',
        'front_office.checkin','front_office.folio.view','front_office.folio.payment',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'front_desk' THEN ARRAY[
        'front_office.access','front_office.reservations.view','front_office.reservations.create',
        'front_office.checkin','front_office.folio.view',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'pos_staff' THEN ARRAY[
        'pos.access','pos.open_shift','pos.process_sale',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'waiter' THEN ARRAY[
        'pos.access','pos.open_shift','pos.process_sale',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'cashier' THEN ARRAY[
        'pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'store_manager' THEN ARRAY[
        'stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue',
        'stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage',
        'stores.requisition.create','stores.requisition.view','stores.requisition.approve',
        'stores.requisition.issue','stores.requisition.receive','stores.issue.void',
        'stores.costs.view','stores.costcentre.manage'
      ]
      WHEN 'fb_manager' THEN ARRAY[
        'pos.access','pos.open_shift','pos.process_sale','pos.apply_discount',
        'stores.access','stores.inventory.view',
        'stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      WHEN 'housekeeping_supervisor' THEN ARRAY[
        'front_office.access',
        'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
      ]
      ELSE '{}'::text[]
    END;
  END IF;

  -- Explicit module assignment is a hard upper bound, never a role fallback.
  SELECT COALESCE(array_agg(DISTINCT c.code), '{}'::text[])
    INTO v_codes
  FROM public.employee_permission_codes c
  WHERE c.code = ANY(COALESCE(v_role_codes, '{}'::text[]))
    AND c.workspace = ANY(v_assigned);

  -- Temporary grants add only specific permissions inside already assigned modules.
  SELECT COALESCE(array_agg(DISTINCT g.permission_code), '{}'::text[])
    INTO v_grant_codes
  FROM public.module_access_grants g
  JOIN public.employee_permission_codes c ON c.code = g.permission_code
  WHERE g.property_id = p_property_id
    AND g.staff_id = v_staff.id
    AND g.revoked_at IS NULL
    AND g.expires_at > now()
    AND c.workspace = ANY(v_assigned);

  RETURN (
    SELECT COALESCE(array_agg(DISTINCT x.code), '{}'::text[])
    FROM unnest(COALESCE(v_codes,'{}'::text[]) || COALESCE(v_grant_codes,'{}'::text[])) AS x(code)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Seeded role templates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seed_employee_roles(p_property_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  VALUES
    (p_property_id, 'Cashier', 'pos',
      ARRAY['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount'],
      'POS cashier workspace', true),
    (p_property_id, 'Waiter', 'pos',
      ARRAY['pos.access','pos.open_shift','pos.process_sale'],
      'Restaurant waiter workspace', true),
    (p_property_id, 'Storekeeper', 'store',
      ARRAY[
        'stores.access','stores.inventory.view','stores.stock.receive',
        'stores.stock.issue','stores.stock.transfer',
        'stores.requisition.view','stores.requisition.issue','stores.requisition.receive'
      ],
      'Issues and receives stock. Cannot approve requisitions, see costs or manage cost centres.', true),
    (p_property_id, 'Store Manager', 'store',
      ARRAY[
        'stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue',
        'stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage',
        'stores.requisition.create','stores.requisition.view','stores.requisition.approve',
        'stores.requisition.issue','stores.requisition.receive','stores.issue.void',
        'stores.costs.view','stores.costcentre.manage'
      ],
      'Full Stores supervision, including approvals, costs and cost centres.', true),
    (p_property_id, 'Department Requester', 'store',
      ARRAY[
        'stores.access','stores.requisition.create',
        'stores.requisition.view','stores.requisition.receive'
      ],
      'Requests stock for a department and confirms receipt.', true),
    (p_property_id, 'Receptionist', 'frontoffice',
      ARRAY['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment'],
      'Front Office workspace', true),
    (p_property_id, 'Accountant', 'backoffice',
      ARRAY['back_office.access','back_office.reports.view','back_office.billing.manage'],
      'Financial reports and accounting', true),
    (p_property_id, 'Property Manager', 'backoffice',
      ARRAY['back_office.access','back_office.reports.view','back_office.employees.manage','back_office.settings.manage','pos.access','front_office.access','stores.access'],
      'Assigned management modules', true)
  ON CONFLICT (property_id, name) DO NOTHING;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Backfill every existing property
-- ---------------------------------------------------------------------------
INSERT INTO public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
SELECT
  p.id,
  v.name,
  v.workspace,
  v.permission_codes,
  v.description,
  true
FROM public.properties p
CROSS JOIN (VALUES
  ('Store Manager', 'store',
    ARRAY[
      'stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue',
      'stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage',
      'stores.requisition.create','stores.requisition.view','stores.requisition.approve',
      'stores.requisition.issue','stores.requisition.receive','stores.issue.void',
      'stores.costs.view','stores.costcentre.manage'
    ]::text[],
    'Full Stores supervision, including approvals, costs and cost centres.'),
  ('Department Requester', 'store',
    ARRAY[
      'stores.access','stores.requisition.create',
      'stores.requisition.view','stores.requisition.receive'
    ]::text[],
    'Requests stock for a department and confirms receipt.')
) AS v(name, workspace, permission_codes, description)
ON CONFLICT (property_id, name) DO NOTHING;

-- Existing Storekeeper system roles gain requisition view/issue/receive only.
UPDATE public.employee_roles r
SET permission_codes = (
      SELECT array_agg(DISTINCT code ORDER BY code)
      FROM unnest(
        r.permission_codes || ARRAY[
          'stores.requisition.view',
          'stores.requisition.issue',
          'stores.requisition.receive'
        ]::text[]
      ) AS u(code)
    ),
    updated_at = now()
WHERE r.name = 'Storekeeper'
  AND r.workspace = 'store'
  AND r.is_system
  AND NOT (
    r.permission_codes @> ARRAY[
      'stores.requisition.view',
      'stores.requisition.issue',
      'stores.requisition.receive'
    ]::text[]
  );

-- Existing Store Manager system roles are normalised to the full template.
UPDATE public.employee_roles r
SET permission_codes = (
      SELECT array_agg(DISTINCT code ORDER BY code)
      FROM unnest(
        r.permission_codes || ARRAY[
          'stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue',
          'stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage',
          'stores.requisition.create','stores.requisition.view','stores.requisition.approve',
          'stores.requisition.issue','stores.requisition.receive','stores.issue.void',
          'stores.costs.view','stores.costcentre.manage'
        ]::text[]
      ) AS u(code)
    ),
    updated_at = now()
WHERE r.name = 'Store Manager'
  AND r.workspace = 'store'
  AND r.is_system;

-- Property Manager system roles also get request/receive so the shortcut works.
UPDATE public.employee_roles r
SET permission_codes = (
      SELECT array_agg(DISTINCT code ORDER BY code)
      FROM unnest(
        r.permission_codes || ARRAY[
          'stores.requisition.create','stores.requisition.view','stores.requisition.receive'
        ]::text[]
      ) AS u(code)
    ),
    updated_at = now()
WHERE r.name = 'Property Manager'
  AND r.workspace = 'backoffice'
  AND r.is_system;

NOTIFY pgrst, 'reload schema';

COMMIT;
