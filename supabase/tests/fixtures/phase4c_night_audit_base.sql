-- Minimal disposable PostgreSQL fixture for the Phase 4C-1 runtime test.
-- This file is only for the GitHub Actions postgres service; never use it on production.

DO $roles$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

CREATE TABLE public.properties (
  id uuid PRIMARY KEY
);

CREATE TABLE public.staff (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL,
  user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  role text NOT NULL DEFAULT 'staff',
  role_id uuid,
  assigned_modules text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE public.staff_sessions (
  user_id uuid PRIMARY KEY,
  staff_id uuid NOT NULL,
  property_id uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.employee_permission_codes (
  code text PRIMARY KEY,
  workspace text NOT NULL,
  label text NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.employee_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  name text NOT NULL,
  workspace text NOT NULL DEFAULT 'backoffice',
  permission_codes text[] NOT NULL DEFAULT '{}'::text[],
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

CREATE TABLE public.module_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  permission_code text NOT NULL,
  granted_by_staff_id uuid,
  granted_by_user_id uuid,
  reason text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid
);

CREATE TABLE public.test_permission_grants (
  user_id uuid NOT NULL,
  permission_code text NOT NULL,
  PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE public.property_business_dates (
  property_id uuid PRIMARY KEY,
  business_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.night_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  business_date date NOT NULL,
  next_business_date date NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid NOT NULL REFERENCES auth.users(id),
  total_revenue numeric(12,2) NOT NULL DEFAULT 0,
  cash_revenue numeric(12,2) NOT NULL DEFAULT 0,
  card_revenue numeric(12,2) NOT NULL DEFAULT 0,
  mpesa_revenue numeric(12,2) NOT NULL DEFAULT 0,
  room_revenue numeric(12,2) NOT NULL DEFAULT 0,
  refunds numeric(12,2) NOT NULL DEFAULT 0,
  voids numeric(12,2) NOT NULL DEFAULT 0,
  discounts numeric(12,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  cashier_variance numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  UNIQUE (property_id, business_date)
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  property_id uuid,
  old_value jsonb,
  new_value jsonb,
  entity_type text,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.folio_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'room',
  category text NOT NULL DEFAULT 'other_services',
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit_price numeric(12,2),
  amount numeric(12,2) NOT NULL,
  reference text,
  reversal_of_id uuid,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  reservation_id uuid,
  folio_charge_id uuid,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pos_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  vat numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'posted',
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pos_receipt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL,
  property_id uuid NOT NULL,
  payment_method text NOT NULL,
  amount numeric(12,2) NOT NULL
);

CREATE TABLE public.cashier_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  variance numeric(12,2) NOT NULL DEFAULT 0,
  closed_at timestamptz
);

CREATE TABLE public.cashier_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL,
  number text,
  room_type_id uuid
);

CREATE TABLE public.reservations (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL,
  room_id uuid,
  status text NOT NULL,
  arrival date NOT NULL,
  departure date NOT NULL,
  rate numeric(12,2),
  total_amount numeric(12,2),
  meal_plan text
);

CREATE TABLE public.board_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  meal_plan text NOT NULL,
  nightly_amount numeric(12,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  room_type_id uuid
);

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE AS $function$ SELECT false $function$;

CREATE OR REPLACE FUNCTION public.is_member_of_property(p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE property_id = p_property_id AND user_id = auth.uid() AND is_active
  )
$function$;

CREATE OR REPLACE FUNCTION public.property_role(p_property_id uuid)
RETURNS text LANGUAGE sql STABLE AS $function$ SELECT 'staff'::text $function$;

CREATE OR REPLACE FUNCTION public.current_staff_id(p_property_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT s.id
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND s.is_active
    AND ss.verified_at > now() - interval '30 minutes'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_role(p_property_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT s.role
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND s.is_active
    AND ss.verified_at > now() - interval '30 minutes'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.fn_current_business_date(p_property_id uuid)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
declare
  v_date date;
begin
  select business_date into v_date from public.property_business_dates where property_id = p_property_id;
  if v_date is null then
    v_date := (now() at time zone 'Africa/Nairobi')::date;
    insert into public.property_business_dates(property_id, business_date)
    values (p_property_id, v_date)
    on conflict (property_id) do nothing;
  end if;
  return v_date;
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_employee_has_permission(
  p_property_id uuid,
  p_code text,
  p_staff_id uuid default null
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
declare
  v_staff_id uuid;
  v_user_id uuid;
begin
  v_staff_id := coalesce(p_staff_id, public.current_staff_id(p_property_id));
  if v_staff_id is not null then
    select user_id into v_user_id
    from public.staff
    where id = v_staff_id and property_id = p_property_id and is_active;
    if v_user_id is not null and exists (
      select 1 from public.test_permission_grants
      where user_id = v_user_id and permission_code = p_code
    ) then
      return true;
    end if;
    if exists (
      select 1 from public.module_access_grants
      where property_id = p_property_id
        and staff_id = v_staff_id
        and permission_code = p_code
        and revoked_at is null
        and expires_at > now()
    ) then
      return true;
    end if;
  end if;
  return exists (
    select 1 from public.test_permission_grants
    where user_id = auth.uid() and permission_code = p_code
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_has_permission(p_property_id uuid, p_permission text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
declare
  v_staff_id uuid;
begin
  if p_property_id is null then return false; end if;
  if exists (
    select 1 from public.test_permission_grants
    where user_id = auth.uid() and permission_code = p_permission
  ) then
    return true;
  end if;
  v_staff_id := public.current_staff_id(p_property_id);
  return exists (
    select 1 from public.module_access_grants
    where property_id = p_property_id
      and staff_id = v_staff_id
      and permission_code = p_permission
      and revoked_at is null
      and expires_at > now()
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_post_folio_charge(
  p_property_id uuid,
  p_reservation_id uuid,
  p_category text,
  p_description text,
  p_quantity numeric,
  p_unit_price numeric,
  p_reference text default null,
  p_idempotency_key text default null
)
RETURNS public.folio_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
declare
  v_charge public.folio_charges;
begin
  insert into public.folio_charges(
    property_id, reservation_id, source, category, description, quantity,
    unit_price, amount, reference, idempotency_key, created_by
  ) values (
    p_property_id, p_reservation_id, 'room', p_category, p_description,
    p_quantity, p_unit_price, p_quantity * p_unit_price, p_reference,
    p_idempotency_key, auth.uid()
  ) returning * into v_charge;
  return v_charge;
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_phase3_stores_role_codes(p_role text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE lower(coalesce(p_role, ''))
    WHEN 'storekeeper' THEN ARRAY[
      'stores.access','stores.inventory.view','stores.stock.receive',
      'stores.stock.issue','stores.stock.transfer'
    ]::text[]
    WHEN 'store_manager' THEN ARRAY[
      'stores.access','stores.inventory.view','stores.stock.receive',
      'stores.stock.issue','stores.stock.transfer','stores.stock.adjust',
      'stores.costs.view','stores.inventory.valuation.view'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
$function$;

-- A pre-existing property with a stale built-in role template lets the
-- migration's reconciliation block be exercised at apply time.
INSERT INTO public.properties(id) VALUES
  ('21000000-0000-0000-0000-000000000001');

INSERT INTO public.employee_roles(
  id, property_id, name, workspace, permission_codes, description, is_system
) VALUES (
  '71000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'Property Manager',
  'backoffice',
  ARRAY['back_office.access','back_office.reports.view']::text[],
  'Stale template reconciled by the Phase 4C-1 migration.',
  true
);

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
