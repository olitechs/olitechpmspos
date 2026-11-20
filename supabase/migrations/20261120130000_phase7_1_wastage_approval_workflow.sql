-- Phase 7.1: permissioned wastage request and approval with location-safe posting.
-- Additive migration. Do not apply to production until isolated PostgreSQL integration tests pass.
BEGIN;

CREATE SCHEMA IF NOT EXISTS stock_internal;
REVOKE ALL ON SCHEMA stock_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS stock_internal.location_posting_context (
  transaction_id bigint NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, product_id)
);
REVOKE ALL ON TABLE stock_internal.location_posting_context
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the existing non-negative location-balance constraint. Location-specific
-- adjustment/wastage operations cannot overdraw the selected location; warn_allow
-- remains available to aggregate-only legacy flows. This avoids changing the behavior
-- of POS/GRN/transfer/product-import writers before their own migration phases.

-- Keep products_sync_default_location installed. The trusted location-aware writer
-- marks its product update in a private table; this trigger consumes that marker and
-- skips only its own default-location delta for that one product update. All legacy
-- writers continue through the original default-location sync path.
CREATE OR REPLACE FUNCTION public.fn_sync_product_default_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
  v_delta numeric;
  v_context_location_id uuid;
BEGIN
  IF NEW.current_stock IS DISTINCT FROM OLD.current_stock THEN
    DELETE FROM stock_internal.location_posting_context
    WHERE transaction_id = txid_current()
      AND product_id = NEW.id
    RETURNING location_id INTO v_context_location_id;

    IF FOUND THEN
      RETURN NEW;
    END IF;

    v_delta := COALESCE(NEW.current_stock, 0) - COALESCE(OLD.current_stock, 0);

    INSERT INTO public.inventory_locations(property_id, name)
    VALUES (
      NEW.property_id,
      COALESCE(NULLIF(BTRIM(NEW.location), ''), 'Main Store')
    )
    ON CONFLICT (property_id, name) DO NOTHING;

    SELECT id
    INTO v_location_id
    FROM public.inventory_locations
    WHERE property_id = NEW.property_id
      AND name = COALESCE(NULLIF(BTRIM(NEW.location), ''), 'Main Store')
    LIMIT 1;

    INSERT INTO public.product_stock_locations(
      property_id, product_id, location_id, qty
    )
    VALUES (
      NEW.property_id, NEW.id, v_location_id,
      GREATEST(0, COALESCE(NEW.current_stock, 0))
    )
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET qty = GREATEST(
      0,
      public.product_stock_locations.qty + v_delta
    );
  END IF;

  RETURN NEW;
END
$function$;

-- Fail closed if the trigger that consumes the private context is absent or disabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'products'
      AND t.tgname = 'products_sync_default_location'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION
      'Required trigger products_sync_default_location is missing or disabled; refusing location-aware posting setup';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION stock_internal.fn_resolve_product_location(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_location_name text;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in the selected property';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT id
    INTO v_location_id
    FROM public.inventory_locations
    WHERE id = p_location_id
      AND property_id = p_property_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory location does not belong to the selected property';
    END IF;

    RETURN v_location_id;
  END IF;

  v_location_name :=
    COALESCE(NULLIF(BTRIM(v_product.location), ''), 'Main Store');

  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, v_location_name)
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id
  INTO v_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = v_location_name
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve the product default inventory location';
  END IF;

  RETURN v_location_id;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_ensure_product_location_projection(
  p_property_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_default_location_id uuid;
  v_default_location_name text;
  v_default_qty numeric;
  v_other_location_qty numeric;
  v_location_total numeric;
  v_ledger_stock numeric;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'Tracked product not found in the selected property';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN sm.type = 'in' THEN sm.qty
      WHEN sm.type = 'out' THEN -sm.qty
      ELSE 0
    END
  ), 0)
  INTO v_ledger_stock
  FROM public.stock_movements sm
  WHERE sm.property_id = p_property_id
    AND sm.product_id = p_product_id;

  IF ABS(v_ledger_stock - v_product.current_stock) > 0.01 THEN
    RAISE EXCEPTION
      'Stock ledger does not reconcile for %; perform a verified stocktake before posting',
      v_product.name;
  END IF;

  v_default_location_name :=
    COALESCE(NULLIF(BTRIM(v_product.location), ''), 'Main Store');

  INSERT INTO public.inventory_locations(property_id, name)
  VALUES (p_property_id, v_default_location_name)
  ON CONFLICT (property_id, name) DO NOTHING;

  SELECT id
  INTO v_default_location_id
  FROM public.inventory_locations
  WHERE property_id = p_property_id
    AND name = v_default_location_name
  FOR UPDATE;

  SELECT qty
  INTO v_default_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = v_default_location_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT COALESCE(SUM(qty), 0)
    INTO v_other_location_qty
    FROM public.product_stock_locations
    WHERE product_id = p_product_id
      AND location_id <> v_default_location_id;

    v_default_qty := v_product.current_stock - COALESCE(v_other_location_qty, 0);

    INSERT INTO public.product_stock_locations(
      property_id, product_id, location_id, qty
    )
    VALUES (
      p_property_id, p_product_id, v_default_location_id, v_default_qty
    )
    ON CONFLICT (product_id, location_id) DO NOTHING;
  END IF;

  SELECT COALESCE(SUM(qty), 0)
  INTO v_location_total
  FROM public.product_stock_locations
  WHERE product_id = p_product_id;

  IF ABS(v_location_total - v_product.current_stock) > 0.01 THEN
    RAISE EXCEPTION
      'Product and location balances do not reconcile; resolve the existing variance before posting';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION stock_internal.fn_post_stock_movement_at_location(
  p_property_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_change numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_source_line_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_name text;
  v_location_qty numeric;
  v_policy text;
  v_new_stock numeric;
  v_idempotency_key text;
BEGIN
  IF p_change IS NULL OR p_change = 0 OR p_change <> ROUND(p_change, 2) THEN
    RAISE EXCEPTION 'Stock change must be non-zero and use the supported 2-decimal precision';
  END IF;

  IF p_location_id IS NULL
     OR NULLIF(BTRIM(p_source_type), '') IS NULL
     OR p_source_id IS NULL
     OR NULLIF(BTRIM(p_source_line_key), '') IS NULL THEN
    RAISE EXCEPTION 'Location and stable source identifiers are required for stock posting';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found in the selected property';
  END IF;

  IF NOT COALESCE(v_product.track_stock, true) THEN
    RAISE EXCEPTION 'This product is not configured for stock tracking';
  END IF;

  PERFORM stock_internal.fn_ensure_product_location_projection(
    p_property_id, p_product_id
  );

  SELECT COALESCE(
    (
      SELECT ps.negative_stock_policy
      FROM public.property_settings ps
      WHERE ps.property_id = p_property_id
    ),
    'warn_allow'
  )
  INTO v_policy;

  v_new_stock := v_product.current_stock + p_change;

  IF p_change < 0 AND v_new_stock < 0 AND v_policy = 'block' THEN
    RAISE EXCEPTION 'Insufficient total stock for % (available %, required %)',
      v_product.name, v_product.current_stock, ABS(p_change);
  END IF;

  SELECT name
  INTO v_location_name
  FROM public.inventory_locations
  WHERE id = p_location_id
    AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory location does not belong to the selected property';
  END IF;

  INSERT INTO public.product_stock_locations(
    property_id, product_id, location_id, qty
  )
  VALUES (p_property_id, p_product_id, p_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT qty
  INTO v_location_qty
  FROM public.product_stock_locations
  WHERE product_id = p_product_id
    AND location_id = p_location_id
  FOR UPDATE;

  IF p_change < 0 AND v_location_qty + p_change < 0 THEN
    RAISE EXCEPTION 'Insufficient stock at selected location (available %, required %)',
      v_location_qty, ABS(p_change);
  END IF;

  -- The private context is consumed by the still-enabled AFTER UPDATE trigger.
  -- This prevents that trigger from applying the same delta to the default location.
  UPDATE public.product_stock_locations
  SET qty = qty + p_change
  WHERE product_id = p_product_id
    AND location_id = p_location_id;

  INSERT INTO stock_internal.location_posting_context(
    transaction_id, product_id, location_id
  )
  VALUES (txid_current(), p_product_id, p_location_id)
  ON CONFLICT (transaction_id, product_id)
  DO UPDATE SET location_id = EXCLUDED.location_id;

  UPDATE public.products
  SET current_stock = current_stock + p_change,
      updated_at = now()
  WHERE id = p_product_id
    AND property_id = p_property_id;

  IF EXISTS (
    SELECT 1
    FROM stock_internal.location_posting_context
    WHERE transaction_id = txid_current()
      AND product_id = p_product_id
  ) THEN
    RAISE EXCEPTION
      'Location sync trigger did not consume its private posting context; stock update rolled back';
  END IF;

  v_idempotency_key :=
    FORMAT('%s:%s:%s', p_source_type, p_source_id, p_source_line_key);

  INSERT INTO public.stock_movements(
    property_id,
    product_id,
    type,
    qty,
    reason,
    user_id,
    source_type,
    source_id,
    location_id,
    location_name_snapshot,
    source_line_key,
    idempotency_key,
    unit_code,
    base_qty,
    unit_cost
  )
  VALUES (
    p_property_id,
    p_product_id,
    CASE WHEN p_change > 0 THEN 'in' ELSE 'out' END,
    ABS(p_change),
    NULLIF(BTRIM(p_reason), ''),
    auth.uid(),
    p_source_type,
    p_source_id,
    p_location_id,
    v_location_name,
    p_source_line_key,
    v_idempotency_key,
    v_product.base_unit,
    ABS(p_change),
    v_product.cost_price
  );
END
$function$;

REVOKE ALL ON FUNCTION stock_internal.fn_ensure_product_location_projection(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_resolve_product_location(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION stock_internal.fn_post_stock_movement_at_location(
  uuid, uuid, uuid, numeric, text, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;



ALTER TABLE public.inventory_wastage
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS stock_movement_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_wastage'::regclass AND conname='inventory_wastage_status_check') THEN
    ALTER TABLE public.inventory_wastage ADD CONSTRAINT inventory_wastage_status_check
      CHECK (status IN ('pending','approved','rejected','posted'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_wastage_property_request_key
  ON public.inventory_wastage(property_id,request_key) WHERE request_key IS NOT NULL;

INSERT INTO public.employee_permission_codes(code,workspace,label,sensitive,sort_order) VALUES
 ('stores.stock.wastage.submit','store','Submit stock wastage requests',true,36),
 ('stores.stock.wastage.approve','store','Approve or reject stock wastage requests',true,37)
ON CONFLICT(code) DO NOTHING;

-- Keep legacy built-in store managers compatible; custom roles can grant either permission independently.
CREATE OR REPLACE FUNCTION public.fn_employee_permission_codes(p_property_id uuid, p_staff_id uuid DEFAULT NULL::uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $function$
declare
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
begin
  if auth.uid() is null or not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then return '{}'::text[]; end if;
  if public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;
  select s.* into v_staff from public.staff s
  where s.id=coalesce(p_staff_id,public.current_staff_id(p_property_id))
    and s.property_id=p_property_id and s.is_active=true
    and (s.user_id=auth.uid()
      or lower(coalesce(s.email,''))=lower(coalesce((select email from auth.users where id=auth.uid()),''))
      or s.id=public.current_staff_id(p_property_id))
  limit 1;
  if v_staff.id is null then return '{}'::text[]; end if;
  v_assigned:=coalesce(v_staff.assigned_modules,'{}'::text[]);
  if v_staff.role_id is not null then
    select coalesce(r.permission_codes,'{}'::text[]) into v_role_codes
    from public.employee_roles r where r.id=v_staff.role_id and r.property_id=p_property_id;
    if not found then v_role_codes:='{}'::text[]; end if;
  else
    v_role_codes:=case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment','pos.access']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','pos.access']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.stock.wastage.submit','stores.stock.wastage.approve']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access']
      else '{}'::text[] end;
  end if;
  select coalesce(array_agg(distinct c.code),'{}'::text[]) into v_codes
  from public.employee_permission_codes c
  where c.code=any(coalesce(v_role_codes,'{}'::text[])) and c.workspace=any(v_assigned);
  select coalesce(array_agg(distinct g.permission_code),'{}'::text[]) into v_grant_codes
  from public.module_access_grants g join public.employee_permission_codes c on c.code=g.permission_code
  where g.property_id=p_property_id and g.staff_id=v_staff.id and g.revoked_at is null
    and g.expires_at>now() and c.workspace=any(v_assigned);
  return (select coalesce(array_agg(distinct x.code),'{}'::text[])
    from unnest(coalesce(v_codes,'{}'::text[])||coalesce(v_grant_codes,'{}'::text[])) as x(code));
end;
$function$;

-- Disable the old one-step posting endpoint so stale clients cannot bypass approval.
CREATE OR REPLACE FUNCTION public.fn_post_wastage(
  p_property_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,
  p_location_id uuid DEFAULT NULL::uuid,p_expiry_date date DEFAULT NULL::date
) RETURNS public.inventory_wastage
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
BEGIN
  RAISE EXCEPTION 'Direct wastage posting is disabled. Submit a request for manager approval.';
END
$function$;
REVOKE ALL ON FUNCTION public.fn_post_wastage(uuid,uuid,numeric,text,uuid,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fn_submit_inventory_wastage(
  p_property_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,
  p_request_key text,p_location_id uuid DEFAULT NULL::uuid,p_expiry_date date DEFAULT NULL::date
) RETURNS public.inventory_wastage
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location_id uuid;
  v_row public.inventory_wastage%ROWTYPE;
  v_fingerprint text;
  v_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;
  IF NOT public.fn_subscription_module_allowed(p_property_id,'store')
     OR NOT public.fn_employee_has_permission(p_property_id,'stores.stock.wastage.submit') THEN
    RAISE EXCEPTION 'Stores wastage submission permission is required';
  END IF;
  v_key:=NULLIF(BTRIM(p_request_key),'');
  IF v_key IS NULL OR length(v_key)>128 THEN RAISE EXCEPTION 'A valid request key is required'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity<>round(p_quantity,2)
     OR NULLIF(BTRIM(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Wastage quantity (up to 2 decimals) and reason are required';
  END IF;
  v_fingerprint:=md5(jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,
    'reason',btrim(p_reason),'location_id',p_location_id,'expiry_date',p_expiry_date)::text);
  SELECT * INTO v_row FROM public.inventory_wastage
    WHERE property_id=p_property_id AND request_key=v_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request key was already used with different wastage details';
    END IF;
    RETURN v_row;
  END IF;
  SELECT * INTO v_product FROM public.products
    WHERE id=p_product_id AND property_id=p_property_id FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(v_product.track_stock,true) THEN
    RAISE EXCEPTION 'Tracked product not found in the selected property';
  END IF;
  v_location_id:=stock_internal.fn_resolve_product_location(p_property_id,p_product_id,p_location_id);
  INSERT INTO public.inventory_wastage(property_id,product_id,location_id,quantity,reason,expiry_date,created_by,
    status,request_key,request_fingerprint)
  VALUES(p_property_id,p_product_id,v_location_id,p_quantity,btrim(p_reason),p_expiry_date,auth.uid(),
    'pending',v_key,v_fingerprint)
  ON CONFLICT(property_id,request_key) WHERE request_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.inventory_wastage
      WHERE property_id=p_property_id AND request_key=v_key FOR UPDATE;
    IF NOT FOUND OR v_row.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Wastage request key conflict';
    END IF;
  END IF;
  RETURN v_row;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_decide_inventory_wastage(
  p_wastage_id uuid,p_decision text,p_decision_reason text DEFAULT NULL::text
) RETURNS public.inventory_wastage
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_row public.inventory_wastage%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.inventory_wastage WHERE id=p_wastage_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT (public.is_platform_owner() OR public.is_member_of_property(v_row.property_id)) THEN
    RAISE EXCEPTION 'Wastage request not found or not authorized';
  END IF;
  IF NOT public.fn_subscription_module_allowed(v_row.property_id,'store')
     OR NOT public.fn_employee_has_permission(v_row.property_id,'stores.stock.wastage.approve') THEN
    RAISE EXCEPTION 'Wastage approval permission is required';
  END IF;
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision must be approve or reject'; END IF;
  IF v_row.status IN ('approved','rejected') THEN
    IF (v_row.status='approved' AND p_decision='approve') OR (v_row.status='rejected' AND p_decision='reject') THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'Wastage request has already been decided';
  END IF;
  IF v_row.status<>'pending' THEN RAISE EXCEPTION 'Only pending wastage requests can be decided'; END IF;
  IF v_row.created_by=auth.uid() THEN RAISE EXCEPTION 'The requester cannot approve or reject their own wastage request'; END IF;
  IF p_decision='reject' THEN
    IF NULLIF(BTRIM(p_decision_reason),'') IS NULL THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE public.inventory_wastage SET status='rejected',approved_by=auth.uid(),
      approved_at=now(),decision_reason=btrim(p_decision_reason)
    WHERE id=v_row.id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  PERFORM stock_internal.fn_post_stock_movement_at_location(
    v_row.property_id,v_row.product_id,v_row.location_id,-v_row.quantity,
    v_row.reason,'wastage',v_row.id,'wastage'
  );
  UPDATE public.inventory_wastage SET status='approved',approved_by=auth.uid(),
    approved_at=now(),decision_reason=NULLIF(BTRIM(p_decision_reason),''),
    stock_movement_id=(SELECT sm.id FROM public.stock_movements sm
      WHERE sm.property_id=v_row.property_id AND sm.source_type='wastage'
        AND sm.source_id=v_row.id AND sm.source_line_key='wastage'
      ORDER BY sm.created_at DESC LIMIT 1)
  WHERE id=v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_decide_inventory_wastage(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_decide_inventory_wastage(uuid,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
