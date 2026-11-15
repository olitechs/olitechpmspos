-- Phase 1 stock-control foundation.
-- Additive only: preserves all existing stock balances and historical movement rows.
-- Negative stock defaults to warn_allow; properties may explicitly choose block.

CREATE TABLE IF NOT EXISTS public.inventory_units (
  code text PRIMARY KEY,
  label text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('mass','volume','count')),
  allows_fraction boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inventory_units (code,label,dimension,allows_fraction) VALUES
  ('g','Gram','mass',true),
  ('kg','Kilogram','mass',true),
  ('mg','Milligram','mass',true),
  ('ml','Millilitre','volume',true),
  ('l','Litre','volume',true),
  ('each','Each','count',false),
  ('pcs','Pieces','count',false),
  ('bottle','Bottle','count',false),
  ('glass','Glass','count',false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inventory_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  from_unit text NOT NULL REFERENCES public.inventory_units(code),
  to_unit text NOT NULL REFERENCES public.inventory_units(code),
  factor numeric(20,10) NOT NULL CHECK (factor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_unit_conversions_distinct_units CHECK (from_unit <> to_unit)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_unit_conversions_scope_key
  ON public.inventory_unit_conversions
  (coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), from_unit, to_unit);

INSERT INTO public.inventory_unit_conversions (property_id,from_unit,to_unit,factor) VALUES
  (NULL,'kg','g',1000),
  (NULL,'g','kg',0.001),
  (NULL,'mg','g',0.001),
  (NULL,'g','mg',1000),
  (NULL,'l','ml',1000),
  (NULL,'ml','l',0.001),
  (NULL,'each','pcs',1),
  (NULL,'pcs','each',1)
ON CONFLICT DO NOTHING;

ALTER TABLE public.inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_units_authenticated_read ON public.inventory_units;
CREATE POLICY inventory_units_authenticated_read
  ON public.inventory_units FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS inventory_unit_conversions_property_read ON public.inventory_unit_conversions;
CREATE POLICY inventory_unit_conversions_property_read
  ON public.inventory_unit_conversions FOR SELECT TO authenticated
  USING (property_id IS NULL OR public.is_platform_owner() OR public.is_member_of_property(property_id));

REVOKE ALL ON public.inventory_units FROM anon, authenticated;
REVOKE ALL ON public.inventory_unit_conversions FROM anon, authenticated;
GRANT SELECT ON public.inventory_units TO authenticated;
GRANT SELECT ON public.inventory_unit_conversions TO authenticated;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stock_item_type text,
  ADD COLUMN IF NOT EXISTS base_unit text;

UPDATE public.products
SET base_unit = lower(btrim(unit))
WHERE base_unit IS NULL
  AND EXISTS (
    SELECT 1 FROM public.inventory_units u
    WHERE u.code = lower(btrim(public.products.unit))
  );

UPDATE public.products SET base_unit = 'pcs' WHERE base_unit IS NULL OR btrim(base_unit) = '';
ALTER TABLE public.products ALTER COLUMN base_unit SET DEFAULT 'pcs';
ALTER TABLE public.products ALTER COLUMN base_unit SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_base_unit_fkey'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_base_unit_fkey
      FOREIGN KEY (base_unit) REFERENCES public.inventory_units(code);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_stock_item_type_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_item_type_check
      CHECK (stock_item_type IS NULL OR stock_item_type IN
        ('raw_ingredient','sub_recipe','finished_good','retail','consumable'));
  END IF;
END $$;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS location_id uuid,
  ADD COLUMN IF NOT EXISTS location_name_snapshot text,
  ADD COLUMN IF NOT EXISTS source_line_key text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS unit_code text,
  ADD COLUMN IF NOT EXISTS base_qty numeric(20,6),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(20,6),
  ADD COLUMN IF NOT EXISTS recipe_id uuid,
  ADD COLUMN IF NOT EXISTS recipe_version integer,
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_location_id_fkey') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES public.inventory_locations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_unit_code_fkey') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_unit_code_fkey
      FOREIGN KEY (unit_code) REFERENCES public.inventory_units(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_recipe_id_fkey') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_recipe_id_fkey
      FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_reversal_of_id_fkey') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_reversal_of_id_fkey
      FOREIGN KEY (reversal_of_id) REFERENCES public.stock_movements(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_base_qty_nonnegative') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_base_qty_nonnegative
      CHECK (base_qty IS NULL OR base_qty >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_unit_cost_nonnegative') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_unit_cost_nonnegative
      CHECK (unit_cost IS NULL OR unit_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_recipe_version_positive') THEN
    ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_recipe_version_positive
      CHECK (recipe_version IS NULL OR recipe_version > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_property_idempotency_key
  ON public.stock_movements(property_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_source_line_product_type_key
  ON public.stock_movements(property_id,source_type,source_id,source_line_key,product_id,type)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND source_line_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS stock_movements_location_created_idx
  ON public.stock_movements(property_id,location_id,created_at DESC);

CREATE INDEX IF NOT EXISTS stock_movements_reversal_idx
  ON public.stock_movements(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

ALTER TABLE public.property_settings
  ADD COLUMN IF NOT EXISTS negative_stock_policy text NOT NULL DEFAULT 'warn_allow';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.property_settings'::regclass
      AND conname='property_settings_negative_stock_policy_check'
  ) THEN
    ALTER TABLE public.property_settings
      ADD CONSTRAINT property_settings_negative_stock_policy_check
      CHECK (negative_stock_policy IN ('warn_allow','block'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_apply_stock_movement(
  p_product_id uuid,
  p_change numeric,
  p_reason text,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.products;
  v_type text;
  v_negative_policy text;
BEGIN
  SELECT * INTO v
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found.';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(v.property_id)) THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;

  IF NOT coalesce(v.track_stock, true) OR coalesce(p_change, 0) = 0 THEN
    RETURN v;
  END IF;

  SELECT coalesce(
    (SELECT ps.negative_stock_policy
     FROM public.property_settings ps
     WHERE ps.property_id = v.property_id),
    'warn_allow'
  ) INTO v_negative_policy;

  IF p_change < 0
     AND v.current_stock + p_change < 0
     AND v_negative_policy = 'block' THEN
    RAISE EXCEPTION 'Insufficient stock for % (available %, required %).',
      v.name, v.current_stock, abs(p_change);
  END IF;

  v_type := CASE WHEN p_change > 0 THEN 'in' ELSE 'out' END;

  UPDATE public.products
  SET current_stock = current_stock + p_change,
      updated_at = now()
  WHERE id = p_product_id
  RETURNING * INTO v;

  INSERT INTO public.stock_movements(
    property_id,product_id,type,qty,reason,user_id,source_type,source_id
  )
  VALUES(
    v.property_id,v.id,v_type,abs(p_change),nullif(trim(p_reason),''),auth.uid(),p_source_type,p_source_id
  );

  RETURN v;
END
$function$;
