-- Phase 1: enforce printer group ownership and atomic saves.
-- Forward-only migration; apply to a disposable database and run tenant tests before production.

CREATE OR REPLACE FUNCTION public.fn_guard_printer_group_printer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_group public.printer_groups;
  v_printer public.printers;
BEGIN
  SELECT * INTO v_group FROM public.printer_groups WHERE id = NEW.printer_group_id;
  SELECT * INTO v_printer FROM public.printers WHERE id = NEW.printer_id;

  IF v_group.id IS NULL OR v_printer.id IS NULL THEN
    RAISE EXCEPTION 'Printer group and printer must both exist' USING ERRCODE = '23503';
  END IF;

  IF v_group.store_id IS DISTINCT FROM v_printer.store_id
     OR v_group.workspace_id IS DISTINCT FROM v_printer.workspace_id
     OR v_group.property_id IS DISTINCT FROM (
       SELECT s.property_id FROM public.stores s WHERE s.id = v_printer.store_id
     ) THEN
    RAISE EXCEPTION 'Printer must belong to the same store, workspace, and property as its group'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS printer_group_printer_link_guard ON public.printer_group_printers;
CREATE TRIGGER printer_group_printer_link_guard
BEFORE INSERT OR UPDATE ON public.printer_group_printers
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_printer_group_printer_link();

CREATE OR REPLACE FUNCTION public.fn_save_store_printer_group(
  p_workspace_id uuid,
  p_store_id uuid,
  p_property_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_category_ids uuid[] DEFAULT '{}',
  p_printer_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_group_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_store public.stores;
  v_category_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_category_ids, '{}')) x);
  v_printer_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_printer_ids, '{}')) x);
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR auth.role() NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_store
  FROM public.stores s
  WHERE s.id = p_store_id
    AND s.workspace_id = p_workspace_id
    AND s.property_id IS NOT DISTINCT FROM p_property_id;

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Store/workspace/property combination is invalid' USING ERRCODE = '42501';
  END IF;

  -- Platform-owner status alone is deliberately insufficient for this property UI RPC.
  -- The actor must hold a real membership in the selected workspace and store,
  -- and must have a property/store management role.
  IF NOT EXISTS (
       SELECT 1 FROM public.workspace_members wm
       WHERE wm.workspace_id = p_workspace_id AND wm.user_id = auth.uid()
         AND wm.role IN ('owner', 'admin')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.store_members sm
       WHERE sm.store_id = p_store_id AND sm.user_id = auth.uid()
         AND sm.role IN ('owner', 'admin', 'manager')
     )
     AND NOT (
       public.is_member_of_property(p_property_id)
       AND public.property_role(p_property_id) IN ('owner', 'admin', 'manager')
     ) THEN
    RAISE EXCEPTION 'Not authorized to manage printer groups for this store' USING ERRCODE = '42501';
  END IF;

  IF v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'Printer group name must contain 1 to 80 characters' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.pos_menu_categories c
  WHERE c.id = ANY(v_category_ids) AND c.property_id IS NOT DISTINCT FROM p_property_id;
  IF v_count <> cardinality(v_category_ids) THEN
    RAISE EXCEPTION 'One or more categories do not belong to this property' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.printers p
  WHERE p.id = ANY(v_printer_ids)
    AND p.store_id = p_store_id
    AND p.workspace_id = p_workspace_id;
  IF v_count <> cardinality(v_printer_ids) THEN
    RAISE EXCEPTION 'One or more printers do not belong to this store and workspace' USING ERRCODE = '23514';
  END IF;

  IF p_group_id IS NULL THEN
    INSERT INTO public.printer_groups(workspace_id, store_id, property_id, name)
    VALUES (p_workspace_id, p_store_id, p_property_id, v_name)
    RETURNING id INTO v_group_id;
  ELSE
    UPDATE public.printer_groups
    SET name = v_name, updated_at = now()
    WHERE id = p_group_id
      AND workspace_id = p_workspace_id
      AND store_id = p_store_id
      AND property_id IS NOT DISTINCT FROM p_property_id
    RETURNING id INTO v_group_id;

    IF v_group_id IS NULL THEN
      RAISE EXCEPTION 'Printer group not found in the selected store' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- All link mutations run inside this function's transaction. Any failure
  -- rolls back the group update and both link replacements.
  DELETE FROM public.printer_group_categories WHERE printer_group_id = v_group_id;
  DELETE FROM public.printer_group_printers WHERE printer_group_id = v_group_id;

  INSERT INTO public.printer_group_categories(printer_group_id, category_id, property_id)
  SELECT v_group_id, c.id, p_property_id
  FROM public.pos_menu_categories c
  WHERE c.id = ANY(v_category_ids) AND c.property_id IS NOT DISTINCT FROM p_property_id;

  INSERT INTO public.printer_group_printers(printer_group_id, printer_id)
  SELECT v_group_id, p.id
  FROM public.printers p
  WHERE p.id = ANY(v_printer_ids)
    AND p.store_id = p_store_id
    AND p.workspace_id = p_workspace_id;

  RETURN v_group_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_save_store_printer_group(uuid, uuid, uuid, uuid, text, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_save_store_printer_group(uuid, uuid, uuid, uuid, text, uuid[], uuid[]) TO authenticated;

-- Ensure the link table itself cannot be used to bypass group/store ownership checks.
DROP POLICY IF EXISTS printer_group_printers_access ON public.printer_group_printers;
CREATE POLICY printer_group_printers_access ON public.printer_group_printers
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.printer_groups g
    WHERE g.id = printer_group_id
      AND public.is_workspace_member(g.workspace_id)
      AND public.is_store_member(g.store_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.printer_groups g
    WHERE g.id = printer_group_id
      AND public.is_workspace_member(g.workspace_id)
      AND public.is_store_member(g.store_id)
  )
);

NOTIFY pgrst, 'reload schema';


-- Platform ownership grants platform-level administration, not implicit membership
-- in every property/store settings surface. Property UI queries must be scoped
-- by an actual workspace/store or property membership.
DROP POLICY IF EXISTS stores_select ON public.stores;
CREATE POLICY stores_select ON public.stores FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = stores.workspace_id AND wm.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = stores.id AND sm.user_id = auth.uid())
  OR (property_id IS NOT NULL AND public.is_member_of_property(property_id))
);

DROP POLICY IF EXISTS printers_access ON public.printers;
CREATE POLICY printers_access ON public.printers FOR ALL
USING (
  (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = printers.workspace_id AND wm.user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = printers.store_id AND sm.user_id = auth.uid())
   OR (SELECT s.property_id FROM public.stores s WHERE s.id = printers.store_id) IS NOT NULL
      AND public.is_member_of_property((SELECT s.property_id FROM public.stores s WHERE s.id = printers.store_id)))
WITH CHECK (
  (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = printers.workspace_id AND wm.user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = printers.store_id AND sm.user_id = auth.uid())
   OR (SELECT s.property_id FROM public.stores s WHERE s.id = printers.store_id) IS NOT NULL
      AND public.is_member_of_property((SELECT s.property_id FROM public.stores s WHERE s.id = printers.store_id)))
);

DROP POLICY IF EXISTS printer_groups_access ON public.printer_groups;
CREATE POLICY printer_groups_access ON public.printer_groups FOR ALL
USING (
  (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = printer_groups.workspace_id AND wm.user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = printer_groups.store_id AND sm.user_id = auth.uid())
   OR (property_id IS NOT NULL AND public.is_member_of_property(property_id)))
WITH CHECK (
  (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = printer_groups.workspace_id AND wm.user_id = auth.uid())
   OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = printer_groups.store_id AND sm.user_id = auth.uid())
   OR (property_id IS NOT NULL AND public.is_member_of_property(property_id)))
);

DROP POLICY IF EXISTS printer_group_categories_access ON public.printer_group_categories;
CREATE POLICY printer_group_categories_access ON public.printer_group_categories FOR ALL
USING (
  property_id IS NOT NULL AND public.is_member_of_property(property_id)
  AND EXISTS (SELECT 1 FROM public.printer_groups g WHERE g.id = printer_group_id AND g.property_id = printer_group_categories.property_id)
)
WITH CHECK (
  property_id IS NOT NULL AND public.is_member_of_property(property_id)
  AND EXISTS (SELECT 1 FROM public.printer_groups g WHERE g.id = printer_group_id AND g.property_id = printer_group_categories.property_id)
);

DROP POLICY IF EXISTS printer_group_printers_access ON public.printer_group_printers;
CREATE POLICY printer_group_printers_access ON public.printer_group_printers FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.printer_groups g
    WHERE g.id = printer_group_printers.printer_group_id
      AND (
        EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = g.workspace_id AND wm.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = g.store_id AND sm.user_id = auth.uid())
        OR (g.property_id IS NOT NULL AND public.is_member_of_property(g.property_id))
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.printer_groups g
    WHERE g.id = printer_group_printers.printer_group_id
      AND (
        EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = g.workspace_id AND wm.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.store_members sm WHERE sm.store_id = g.store_id AND sm.user_id = auth.uid())
        OR (g.property_id IS NOT NULL AND public.is_member_of_property(g.property_id))
      )
  )
);
