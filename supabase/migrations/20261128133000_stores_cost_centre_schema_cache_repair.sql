-- OliTechs PMS+POS — Stores cost-centre RPC schema-cache repair
--
-- Forward-only repair for environments where Phase 1 Stores is deployed but
-- PostgREST still reports:
--   Could not find the function public.fn_stores_list_cost_centres(p_property_id)
--   in the schema cache
--
-- Do not edit the applied Phase 1 migration. This migration reasserts the
-- canonical RPC body and authenticated-only privilege, then asks PostgREST to
-- reload its schema cache. It is idempotent and safe to re-run.

CREATE OR REPLACE FUNCTION public.fn_stores_list_cost_centres(p_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.access', 'stores.requisition.create', 'stores.costcentre.manage']
  );

  PERFORM stock_internal.fn_stores_ensure_settings(p_property_id);

  SELECT COALESCE(jsonb_agg(
    stock_internal.fn_stores_cost_centre_json(p_property_id, cc.id)
    ORDER BY cc.active DESC, cc.name
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.cost_centres cc
  WHERE cc.property_id = p_property_id;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'can_manage', public.is_platform_owner()
      OR public.fn_employee_has_permission(p_property_id, 'stores.costcentre.manage')
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_stores_list_cost_centres(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_stores_list_cost_centres(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
