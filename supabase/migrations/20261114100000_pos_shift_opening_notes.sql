-- Persist the opening-shift notes a cashier types in the POS "Open Shift" dialog.
-- Until now only closing notes were stored (cashier_shifts.closing_notes); the
-- opening notes were silently discarded because fn_open_cashier_shift had no
-- notes parameter.
-- Governance: additive column, forward-only replacement of the RPC signature;
-- no applied migration renamed. Deploy this migration before the frontend that
-- sends p_notes.

BEGIN;

ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS opening_notes text;

COMMENT ON COLUMN public.cashier_shifts.opening_notes IS
  'Optional notes recorded by the cashier when the shift was opened.';

-- Adding a defaulted parameter creates an ambiguous overload with the previous
-- two-argument function, so the old signature is replaced explicitly.
DROP FUNCTION IF EXISTS public.fn_open_cashier_shift(uuid, numeric);

CREATE OR REPLACE FUNCTION public.fn_open_cashier_shift(
  p_property_id uuid,
  p_opening_float numeric DEFAULT 0,
  p_notes text DEFAULT NULL
) RETURNS public.cashier_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shift public.cashier_shifts;
  v_staff_id uuid;
  v_role text;
BEGIN
  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;
  IF p_opening_float < 0 THEN RAISE EXCEPTION 'Opening float cannot be negative.'; END IF;

  v_role := public.current_staff_role(p_property_id);
  IF v_role IS NOT NULL AND v_role NOT IN ('hotel_admin','super_admin','cashier','fb_manager') THEN
    RAISE EXCEPTION 'Only authorised cashier staff can open a cashier shift.';
  END IF;
  IF v_role IS NULL AND NOT (public.is_platform_owner() OR public.property_role(p_property_id) IN ('owner','admin','manager','cashier')) THEN
    RAISE EXCEPTION 'Only authorised cashier staff can open a cashier shift.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cashier_shifts WHERE property_id = p_property_id AND opened_by = auth.uid() AND status = 'open') THEN
    RAISE EXCEPTION 'You already have an open cashier shift.';
  END IF;

  v_staff_id := public.current_staff_id(p_property_id);
  INSERT INTO public.cashier_shifts(property_id, staff_id, opened_by, opening_float, opening_notes)
  VALUES (p_property_id, v_staff_id, auth.uid(), p_opening_float, NULLIF(trim(COALESCE(p_notes, '')), ''))
  RETURNING * INTO v_shift;
  RETURN v_shift;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_open_cashier_shift(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_open_cashier_shift(uuid, numeric, text) TO authenticated;

COMMIT;
