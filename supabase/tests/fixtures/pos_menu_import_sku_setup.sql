-- Minimal isolated PostgreSQL fixture for the POS SKU-upsert migration test.
-- This fixture is not a production schema dump and must never be deployed.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  sku text,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  unit text NOT NULL DEFAULT 'pcs',
  current_stock numeric NOT NULL DEFAULT 0,
  min_stock numeric NOT NULL DEFAULT 0,
  max_stock numeric NOT NULL DEFAULT 0,
  selling_price numeric NOT NULL DEFAULT 0,
  pos_enabled boolean NOT NULL DEFAULT false,
  pos_category text,
  production_center text NOT NULL DEFAULT 'Kitchen',
  pos_sort integer NOT NULL DEFAULT 0,
  pos_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_property_id_sku_key UNIQUE (property_id, sku)
);

CREATE TABLE public.pos_menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  name text NOT NULL,
  production_center text NOT NULL DEFAULT 'Kitchen',
  UNIQUE (property_id, name)
);

CREATE FUNCTION public.can_manage_pos_menu(uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
