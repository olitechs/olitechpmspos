-- Minimal disposable schema fixture for the staff-session migration contract.
-- This fixture is not a production schema dump and does not validate unrelated RPCs.
-- PostgreSQL roles are cluster-wide, so the combined CI workflow may have
-- created these roles already while preparing its other isolated database.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $auth_role$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$auth_role$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.properties (
  id uuid PRIMARY KEY,
  name text,
  currency text,
  status text NOT NULL,
  package text NOT NULL
);
CREATE TABLE public.property_users (
  property_id uuid NOT NULL REFERENCES public.properties(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, user_id)
);
CREATE TABLE public.property_subscriptions (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id),
  plan_code text NOT NULL,
  status text NOT NULL,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  enabled_modules text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_by uuid
);
CREATE OR REPLACE FUNCTION public.platform_package_modules(p_package text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $package_modules$
  SELECT ARRAY['frontoffice','pos','backoffice','store']::text[]
$package_modules$;

CREATE TABLE public.booking_engine_settings (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL UNIQUE REFERENCES public.properties(id),
  enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'USD',
  terms text,
  cancellation_policy text,
  payment_instructions text
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id),
  sku text,
  name text NOT NULL,
  pos_category text,
  category text,
  unit text,
  current_stock numeric NOT NULL DEFAULT 0,
  min_stock numeric NOT NULL DEFAULT 0,
  selling_price numeric NOT NULL DEFAULT 0,
  production_center text,
  pos_sort integer NOT NULL DEFAULT 0,
  pos_enabled boolean NOT NULL DEFAULT true,
  pos_active boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION public.fn_public_booking_engine_config(p_property_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $booking_stub$
  SELECT NULL::jsonb
$booking_stub$;
CREATE OR REPLACE FUNCTION public.fn_list_pos_menu(p_property_id uuid)
RETURNS TABLE(
  id uuid, sku text, name text, category text, unit text,
  current_stock numeric, min_stock numeric, selling_price numeric,
  production_center text, pos_sort integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $menu_stub$
  SELECT p.id, p.sku, p.name, p.category, p.unit, p.current_stock, p.min_stock,
         p.selling_price, p.production_center, p.pos_sort
  FROM public.products p WHERE false
$menu_stub$;
CREATE OR REPLACE FUNCTION public.create_pending_property_for_user(
  p_user_id uuid, p_email text, p_full_name text, p_business_name text DEFAULT NULL
)
RETURNS public.properties LANGUAGE sql SECURITY DEFINER SET search_path=public AS $pending_property_stub$
  SELECT NULL::public.properties
$pending_property_stub$;
GRANT EXECUTE ON FUNCTION public.fn_public_booking_engine_config(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_pos_menu(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_subscription_access(p_property_id uuid, p_module text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $subscription_stub$
  SELECT jsonb_build_object('allowed', true)
$subscription_stub$;
CREATE OR REPLACE FUNCTION public.fn_subscription_module_allowed(p_property_id uuid, p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $subscription_module_stub$
  SELECT coalesce((public.fn_subscription_access(p_property_id, p_module)->>'allowed')::boolean, false)
$subscription_module_stub$;

CREATE TABLE public.staff (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id),
  user_id uuid REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  assigned_modules text[] NOT NULL DEFAULT ARRAY[]::text[],
  pin_hash text NOT NULL,
  role text NOT NULL,
  last_login timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  email text,
  avatar text
);
CREATE TABLE public.staff_sessions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.staff_pin_attempts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  failed_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  PRIMARY KEY (user_id, property_id)
);
ALTER TABLE public.staff_pin_attempts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.staff_logs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  property_id uuid NOT NULL,
  staff_id uuid,
  staff_name text,
  module text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_member_of_property(p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.property_users pu
    WHERE pu.property_id = p_property_id AND pu.user_id = auth.uid()
  )
$$;
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT false
$$;
CREATE OR REPLACE FUNCTION public.property_role(p_property_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT pu.role FROM public.property_users pu
  WHERE pu.property_id = p_property_id AND pu.user_id = auth.uid()
  LIMIT 1
$$;

INSERT INTO public.profiles(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.properties(id,status,package) VALUES
  ('20000000-0000-4000-8000-000000000001','active','professional'),
  ('20000000-0000-4000-8000-000000000002','active','professional');
UPDATE public.properties
SET name = CASE WHEN id = '20000000-0000-4000-8000-000000000001' THEN 'Fixture Property A' ELSE 'Fixture Property B' END,
    currency = 'KES';
INSERT INTO public.booking_engine_settings(id,property_id,enabled,currency,terms,cancellation_policy,payment_instructions) VALUES
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',true,'KES','Public terms','Public cancellation policy','Pay at booking'),
  ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',false,'KES','Hidden terms','Hidden cancellation policy','Hidden payment instructions');
INSERT INTO public.products(id,property_id,sku,name,category,unit,current_stock,min_stock,selling_price,pos_enabled,pos_active) VALUES
  ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','A-001','Property A Item','Food','portion',10,2,100,true,true),
  ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','B-001','Property B Item','Food','portion',10,2,120,true,true);

INSERT INTO public.property_users(property_id,user_id,role) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','reception');
INSERT INTO public.property_subscriptions(property_id,plan_code,status,enabled_modules) VALUES
  ('20000000-0000-4000-8000-000000000001','professional','active',ARRAY['frontoffice','pos','backoffice','store']),
  ('20000000-0000-4000-8000-000000000002','professional','active',ARRAY['frontoffice','pos','backoffice','store']);
INSERT INTO public.staff(id,property_id,user_id,is_active,assigned_modules,pin_hash,role,full_name,email,avatar) VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',NULL,true,ARRAY['pos'],'fixture-hash','cashier','Fixture Cashier','cashier@example.invalid',NULL),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',NULL,true,ARRAY['frontoffice'],'fixture-hash','receptionist','Fixture Receptionist','reception@example.invalid',NULL);

CREATE OR REPLACE FUNCTION public.current_staff_role(p_property_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT NULL::text
$$;

-- Representative existing policies used to assert that the candidate migration
-- binds staff-role branches to the correct module without rewriting membership branches.
CREATE TABLE public.pos_shifts (
  id uuid PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id),
  status text NOT NULL DEFAULT 'open',
  date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  opened_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.pos_shifts(id,property_id,status,date,opened_at) VALUES
  ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','open',(now() AT TIME ZONE 'Africa/Nairobi')::date,now()),
  ('60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','open',(now() AT TIME ZONE 'Africa/Nairobi')::date,now());
CREATE OR REPLACE FUNCTION public.fn_current_pos_shift(p_property_id uuid)
RETURNS public.pos_shifts LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $shift_stub$
  SELECT NULL::public.pos_shifts WHERE false
$shift_stub$;
GRANT EXECUTE ON FUNCTION public.fn_current_pos_shift(uuid) TO authenticated, service_role;

CREATE TABLE public.stores (id uuid PRIMARY KEY, property_id uuid NOT NULL);
CREATE TABLE public.payments (id uuid PRIMARY KEY, property_id uuid NOT NULL);
ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY fixture_pos_shifts_update ON public.pos_shifts
  FOR UPDATE USING (public.current_staff_role(property_id) = 'cashier')
  WITH CHECK (public.current_staff_role(property_id) = 'cashier');
CREATE POLICY fixture_stores_update ON public.stores
  FOR UPDATE USING (public.current_staff_role(property_id) = 'store_manager')
  WITH CHECK (public.current_staff_role(property_id) = 'store_manager');
CREATE POLICY fixture_payments_insert ON public.payments
  FOR INSERT WITH CHECK (public.current_staff_role(property_id) = 'cashier');

