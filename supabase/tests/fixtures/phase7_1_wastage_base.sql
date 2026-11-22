-- Minimal disposable PostgreSQL fixture for the Phase 7.1 migration runtime test.
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

CREATE TABLE public.employee_permission_codes (
  code text PRIMARY KEY,
  workspace text NOT NULL,
  label text NOT NULL,
  sensitive boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.staff (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  user_id uuid,
  email text,
  role_id uuid,
  role text NOT NULL DEFAULT 'staff',
  assigned_modules text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE public.employee_roles (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL,
  permission_codes text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE public.module_access_grants (
  property_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  permission_code text NOT NULL,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE TABLE public.test_permission_grants (
  user_id uuid NOT NULL,
  permission_code text NOT NULL,
  PRIMARY KEY (user_id, permission_code)
);

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE AS $function$ SELECT false $function$;

CREATE OR REPLACE FUNCTION public.is_member_of_property(p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $function$ SELECT auth.uid() IS NOT NULL $function$;

CREATE OR REPLACE FUNCTION public.property_role(p_property_id uuid)
RETURNS text LANGUAGE sql STABLE AS $function$ SELECT 'staff'::text $function$;

CREATE OR REPLACE FUNCTION public.current_staff_id(p_property_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $function$ SELECT NULL::uuid $function$;

CREATE OR REPLACE FUNCTION public.fn_subscription_module_allowed(p_property_id uuid, p_module text)
RETURNS boolean LANGUAGE sql STABLE AS $function$ SELECT true $function$;

CREATE OR REPLACE FUNCTION public.fn_employee_has_permission(p_property_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.test_permission_grants g
    WHERE g.user_id = auth.uid()
      AND g.permission_code = p_permission
  )
$function$;

CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  name text NOT NULL,
  UNIQUE (property_id, name)
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  name text NOT NULL,
  current_stock numeric NOT NULL DEFAULT 0,
  location text NOT NULL DEFAULT 'Main Store',
  track_stock boolean NOT NULL DEFAULT true,
  base_unit text NOT NULL DEFAULT 'pcs',
  cost_price numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_stock_locations (
  property_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id),
  qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  UNIQUE (product_id, location_id)
);

CREATE TABLE public.property_settings (
  property_id uuid PRIMARY KEY,
  negative_stock_policy text NOT NULL DEFAULT 'block'
);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  product_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('in', 'out')),
  qty numeric NOT NULL,
  reason text,
  user_id uuid,
  source_type text,
  source_id uuid,
  location_id uuid,
  location_name_snapshot text,
  source_line_key text,
  idempotency_key text,
  unit_code text,
  base_qty numeric,
  unit_cost numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_wastage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid,
  quantity numeric NOT NULL,
  reason text NOT NULL,
  expiry_date date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Model the pre-migration trigger and legacy endpoint that the migration must replace.
CREATE OR REPLACE FUNCTION public.fn_sync_product_default_location()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN NEW;
END
$function$;

CREATE TRIGGER products_sync_default_location
AFTER UPDATE OF current_stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_default_location();

CREATE OR REPLACE FUNCTION public.fn_post_wastage(
  p_property_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_location_id uuid DEFAULT NULL::uuid,
  p_expiry_date date DEFAULT NULL::date
)
RETURNS public.inventory_wastage
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN NULL;
END
$function$;

-- Start with broad legacy table grants so the migration's revocation is actually tested.
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, anon;
