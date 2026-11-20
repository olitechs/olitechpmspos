-- Phase 8: authorized, idempotent and source-linked inventory production batches.
-- Depends on Phase 7.1's stock_internal location-aware writer.
BEGIN;

INSERT INTO public.employee_permission_codes(code,workspace,label,sensitive,sort_order)
VALUES ('stores.production.post','store','Post inventory production and assembly batches',true,38)
ON CONFLICT(code) DO NOTHING;

-- Extend the legacy manager role fallbacks. Custom roles may grant this permission
-- independently through the existing employee_roles.permission_codes catalog.
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
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.stock.wastage.submit','stores.stock.wastage.approve','stores.production.post']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view','stores.production.post']
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

ALTER TABLE public.inventory_productions
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS recipe_version integer,
  ADD COLUMN IF NOT EXISTS components_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS component_cost_total numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_unit_cost numeric(20,6) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_productions_property_request_key
  ON public.inventory_productions(property_id,request_key) WHERE request_key IS NOT NULL;

-- Disable the membership-only legacy endpoint. The replacement below is the sole
-- authenticated path for posting a production batch.
CREATE OR REPLACE FUNCTION public.fn_post_production(
  p_property_id uuid,p_recipe_id uuid,p_output_product_id uuid,p_quantity numeric,p_reference text DEFAULT NULL::text
) RETURNS public.inventory_productions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
BEGIN
  RAISE EXCEPTION 'Direct production posting is disabled. Use the authorized production workflow.';
END
$function$;
REVOKE ALL ON FUNCTION public.fn_post_production(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fn_post_inventory_production(
  p_property_id uuid,
  p_recipe_id uuid,
  p_output_product_id uuid,
  p_quantity numeric,
  p_reference text,
  p_request_key text
) RETURNS public.inventory_productions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
  v_recipe public.recipes%ROWTYPE;
  v_output public.products%ROWTYPE;
  v_row public.inventory_productions%ROWTYPE;
  v_line record;
  v_product_ids uuid[];
  v_locked_count integer;
  v_ingredient_count integer;
  v_needed numeric;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_component_total numeric:=0;
  v_snapshot jsonb:='[]'::jsonb;
  v_fingerprint text;
  v_key text;
  v_output_location uuid;
  v_component_location uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized for this property';
  END IF;
  IF NOT public.fn_subscription_module_allowed(p_property_id,'store')
     OR NOT public.fn_employee_has_permission(p_property_id,'stores.production.post') THEN
    RAISE EXCEPTION 'Stores production permission is required';
  END IF;
  v_key:=NULLIF(BTRIM(p_request_key),'');
  IF v_key IS NULL OR length(v_key)>128 THEN RAISE EXCEPTION 'A valid production request key is required'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity<>round(p_quantity,6) THEN
    RAISE EXCEPTION 'Production quantity must be positive and use up to 6 decimal places';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_property_id::text||':production:'||v_key,0));
  v_fingerprint:=md5(jsonb_build_object('recipe_id',p_recipe_id,'output_product_id',p_output_product_id,
    'quantity',p_quantity,'reference',NULLIF(BTRIM(p_reference),''))::text);
  SELECT * INTO v_row FROM public.inventory_productions
    WHERE property_id=p_property_id AND request_key=v_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This request key was already used with different production details';
    END IF;
    RETURN v_row;
  END IF;

  SELECT * INTO v_recipe FROM public.recipes
    WHERE id=p_recipe_id AND property_id=p_property_id AND active=true FOR UPDATE;
  IF NOT FOUND OR v_recipe.yield_qty<=0 THEN RAISE EXCEPTION 'Active property recipe with a positive yield is required'; END IF;

  SELECT * INTO v_output FROM public.products
    WHERE id=p_output_product_id AND property_id=p_property_id;
  IF NOT FOUND OR NOT coalesce(v_output.track_stock,true)
     OR coalesce(v_output.inventory_tracking_mode,'direct')<>'direct' THEN
    RAISE EXCEPTION 'Output must be a directly tracked product in the selected property';
  END IF;

  PERFORM 1 FROM public.recipe_ingredients
    WHERE recipe_id=v_recipe.id ORDER BY product_id,id FOR UPDATE;
  SELECT count(*) INTO v_ingredient_count
  FROM public.recipe_ingredients WHERE recipe_id=v_recipe.id;
  IF v_ingredient_count=0 THEN RAISE EXCEPTION 'A production recipe must contain at least one component'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
    LEFT JOIN public.products p ON p.id=ri.product_id AND p.property_id=p_property_id
    WHERE ri.recipe_id=v_recipe.id
      AND (p.id IS NULL OR NOT coalesce(p.track_stock,true)
        OR coalesce(p.inventory_tracking_mode,'direct')<>'direct'
        OR ri.qty<=0)
  ) THEN
    RAISE EXCEPTION 'Every recipe component must be a positive-quantity, directly tracked product in this property';
  END IF;
  IF EXISTS (SELECT 1 FROM public.recipe_ingredients WHERE recipe_id=v_recipe.id AND product_id=p_output_product_id) THEN
    RAISE EXCEPTION 'The output product cannot also be a component of the same production batch';
  END IF;

  SELECT array_agg(DISTINCT product_id ORDER BY product_id) INTO v_product_ids
  FROM (
    SELECT ri.product_id FROM public.recipe_ingredients ri WHERE ri.recipe_id=v_recipe.id
    UNION SELECT p_output_product_id
  ) product_ids;
  PERFORM 1 FROM public.products p
    WHERE p.property_id=p_property_id AND p.id=ANY(v_product_ids)
    ORDER BY p.id FOR UPDATE;
  GET DIAGNOSTICS v_locked_count=ROW_COUNT;
  IF v_locked_count<>cardinality(v_product_ids) THEN
    RAISE EXCEPTION 'A production component or output product is outside the selected property';
  END IF;

  FOR v_line IN
    SELECT ri.id,ri.product_id,ri.qty,ri.entered_qty,ri.entered_unit,ri.unit_cost_snapshot,
      p.name AS product_name,p.base_unit,p.cost_price
    FROM public.recipe_ingredients ri
    JOIN public.products p ON p.id=ri.product_id AND p.property_id=p_property_id
    WHERE ri.recipe_id=v_recipe.id
    ORDER BY ri.product_id,ri.id
  LOOP
    v_needed:=round(v_line.qty*(p_quantity/v_recipe.yield_qty),6);
    IF v_needed<=0 THEN RAISE EXCEPTION 'A recipe component resolves to a zero stock quantity'; END IF;
    v_unit_cost:=coalesce(v_line.unit_cost_snapshot,v_line.cost_price,0);
    v_line_cost:=round(v_needed*v_unit_cost,6);
    v_component_total:=v_component_total+v_line_cost;
    v_snapshot:=v_snapshot||jsonb_build_array(jsonb_build_object(
      'recipe_ingredient_id',v_line.id,'product_id',v_line.product_id,'product_name',v_line.product_name,
      'recipe_base_qty',v_line.qty,'required_base_qty',v_needed,'entered_qty',v_line.entered_qty,
      'entered_unit',v_line.entered_unit,'base_unit',v_line.base_unit,
      'unit_cost_snapshot',v_unit_cost,'line_cost_snapshot',v_line_cost
    ));
  END LOOP;

  INSERT INTO public.inventory_productions(
    property_id,recipe_id,output_product_id,quantity,reference,created_by,status,
    request_key,request_fingerprint,recipe_version,components_snapshot,component_cost_total,output_unit_cost
  ) VALUES (
    p_property_id,v_recipe.id,p_output_product_id,p_quantity,NULLIF(BTRIM(p_reference),''),auth.uid(),'posted',
    v_key,v_fingerprint,v_recipe.recipe_version,v_snapshot,v_component_total,round(v_component_total/p_quantity,6)
  ) RETURNING * INTO v_row;

  FOR v_line IN
    SELECT ri.id,ri.product_id,ri.qty
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id=v_recipe.id
    ORDER BY ri.product_id,ri.id
  LOOP
    v_needed:=round(v_line.qty*(p_quantity/v_recipe.yield_qty),6);
    v_component_location:=stock_internal.fn_resolve_product_location(p_property_id,v_line.product_id,NULL);
    PERFORM stock_internal.fn_post_stock_movement_at_location(
      p_property_id,v_line.product_id,v_component_location,-v_needed,
      'Production consumption: '||coalesce(NULLIF(BTRIM(p_reference),''),v_row.id::text),
      'production',v_row.id,'component:'||v_line.id::text
    );
    UPDATE public.stock_movements SET unit_cost=coalesce((v_snapshot->(SELECT count(*)-1 FROM public.recipe_ingredients ri2 WHERE ri2.recipe_id=v_recipe.id AND (ri2.product_id<v_line.product_id OR (ri2.product_id=v_line.product_id AND ri2.id<=v_line.id)))->>'unit_cost_snapshot')::numeric,0)
    WHERE property_id=p_property_id AND source_type='production' AND source_id=v_row.id
      AND source_line_key='component:'||v_line.id::text;
  END LOOP;

  v_output_location:=stock_internal.fn_resolve_product_location(p_property_id,p_output_product_id,NULL);
  PERFORM stock_internal.fn_post_stock_movement_at_location(
    p_property_id,p_output_product_id,v_output_location,p_quantity,
    'Production output: '||coalesce(NULLIF(BTRIM(p_reference),''),v_row.id::text),
    'production',v_row.id,'output'
  );
  UPDATE public.stock_movements SET unit_cost=round(v_component_total/p_quantity,6)
    WHERE property_id=p_property_id AND source_type='production' AND source_id=v_row.id AND source_line_key='output';

  RETURN v_row;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_post_inventory_production(uuid,uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_post_inventory_production(uuid,uuid,uuid,numeric,text,text) TO authenticated;

REVOKE INSERT,UPDATE,DELETE ON TABLE public.inventory_productions FROM anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
