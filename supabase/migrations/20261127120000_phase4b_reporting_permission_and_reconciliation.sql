-- Phase 4B — reporting correctness, permission parity and reconciliation.
--
-- Forward-only correction layer. This migration does not edit or renumber any
-- applied migration file. It adds corrected RPC names and forward-corrects the
-- legacy fn_management_report with CREATE OR REPLACE so a fallback call can no
-- longer expose inventory valuation to a role without the valuation permission.
-- No applied file is rewritten and no destructive DDL is performed.
--
-- Deployment note:
--   1. Apply this file only after the applied-state preflight in
--      docs/audit/PHASE4_GOVERNANCE_BASELINE.md has been re-run on staging.
--   2. The web client falls back to the legacy management RPC when these
--      functions are absent. The forward-corrected legacy function keeps its
--      membership-only compatibility scope and withholds valuation from roles
--      without stores.inventory.valuation.view. The Storekeeper dashboard uses
--      a new POS-only snapshot RPC so it never needs the full management report.
--   3. No data backfill, staff reassignment or destructive DDL is performed.

-- ---------------------------------------------------------------------------
-- 1. Permission-aware corrected management report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_phase4b_management_report(
  p_property_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base jsonb;
  v_room_folio numeric;
  v_room_payments numeric;
  v_room_payments_excluded numeric;
  v_pos_subtotal numeric;
  v_pos_posted_total numeric;
  v_pos_tax numeric;
  v_pos_discount numeric;
  v_refunds numeric;
  v_voids numeric;
  v_split_total numeric;
  v_split_allocated numeric;
  v_inventory jsonb;
BEGIN
  IF p_property_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_platform_owner()
     AND NOT public.fn_employee_has_permission(p_property_id, 'back_office.reports.view') THEN
    RAISE EXCEPTION 'Permission % is required', 'back_office.reports.view' USING ERRCODE = '42501';
  END IF;

  v_base := public.fn_management_report(p_property_id, p_from, p_to);

  -- Accommodation revenue is recognised from non-reversed room folio lines.
  -- Payments are counted only when they can be attributed to those room lines:
  -- direct allocations, or unallocated payments on room-only reservations.
  -- Other posted folio payments are reported separately so the variance stays
  -- like-for-like and is never silently netted against POS or restaurant sales.
  WITH room_charges AS (
    SELECT c.id, c.reservation_id, c.amount
    FROM public.folio_charges c
    WHERE c.property_id = p_property_id
      AND c.source = 'room'
      AND c.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.folio_charges reversal
        WHERE reversal.reversal_of_id = c.id
      )
      AND (c.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
  ),
  mixed_reservations AS (
    SELECT DISTINCT c.reservation_id
    FROM public.folio_charges c
    WHERE c.property_id = p_property_id
      AND c.source <> 'room'
      AND c.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.folio_charges reversal
        WHERE reversal.reversal_of_id = c.id
      )
      AND c.reservation_id IN (SELECT reservation_id FROM room_charges)
  ),
  room_payments AS (
    SELECT p.amount
    FROM public.payments p
    WHERE p.property_id = p_property_id
      AND p.status = 'posted'
      AND (p.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
      AND (
        p.folio_charge_id IN (SELECT id FROM room_charges)
        OR (
          p.folio_charge_id IS NULL
          AND p.reservation_id IN (SELECT reservation_id FROM room_charges)
          AND p.reservation_id NOT IN (SELECT reservation_id FROM mixed_reservations)
        )
      )
  ),
  excluded_payments AS (
    SELECT p.amount
    FROM public.payments p
    WHERE p.property_id = p_property_id
      AND p.status = 'posted'
      AND (p.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
      AND p.reservation_id IN (SELECT reservation_id FROM room_charges)
      AND NOT (
        p.folio_charge_id IN (SELECT id FROM room_charges)
        OR (
          p.folio_charge_id IS NULL
          AND p.reservation_id NOT IN (SELECT reservation_id FROM mixed_reservations)
        )
      )
  )
  SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM room_charges),
    (SELECT COALESCE(SUM(amount), 0) FROM room_payments),
    (SELECT COALESCE(SUM(amount), 0) FROM excluded_payments)
  INTO v_room_folio, v_room_payments, v_room_payments_excluded;

  -- POS totals come only from posted receipts. Voided receipts stay in a
  -- separate bucket and are never included in the posted total.
  SELECT
    COALESCE(SUM(r.subtotal), 0),
    COALESCE(SUM(r.total), 0),
    COALESCE(SUM(r.vat), 0),
    COALESCE(SUM(r.discount_amount), 0)
  INTO v_pos_subtotal, v_pos_posted_total, v_pos_tax, v_pos_discount
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'posted'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(f.amount), 0)
  INTO v_refunds
  FROM public.cashier_refunds f
  WHERE f.property_id = p_property_id
    AND (f.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(r.total), 0)
  INTO v_voids
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'voided'
    AND (COALESCE(r.voided_at, r.created_at) AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(r.total), 0)
  INTO v_split_total
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'posted'
    AND lower(COALESCE(r.payment_method, '')) = 'split'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(a.amount), 0)
  INTO v_split_allocated
  FROM public.pos_receipt_payments a
  JOIN public.pos_receipts r ON r.id = a.receipt_id
  WHERE a.property_id = p_property_id
    AND r.property_id = p_property_id
    AND r.status = 'posted'
    AND lower(COALESCE(r.payment_method, '')) = 'split'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  IF public.is_platform_owner()
     OR public.fn_employee_has_permission(p_property_id, 'stores.inventory.valuation.view') THEN
    v_inventory := jsonb_build_object(
      'valuation', round(COALESCE((
        SELECT SUM(p.current_stock * p.cost_price)
        FROM public.products p
        WHERE p.property_id = p_property_id
      ), 0), 2),
      'valuation_restricted', false
    );
  ELSE
    v_inventory := jsonb_build_object('valuation', NULL, 'valuation_restricted', true);
  END IF;

  RETURN coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'hotel', coalesce(v_base -> 'hotel', '{}'::jsonb) || jsonb_build_object(
      'room_revenue', round(v_room_folio, 2),
      'room_folio_revenue', round(v_room_folio, 2),
      'room_posted_payments', round(v_room_payments, 2),
      'room_payments_excluded_from_variance', round(v_room_payments_excluded, 2),
      'room_revenue_variance', round(v_room_folio - v_room_payments, 2)
    ),
    'sales', coalesce(v_base -> 'sales', '{}'::jsonb) || jsonb_build_object(
      'pos_gross', round(v_pos_subtotal, 2),
      'pos_posted_total', round(v_pos_posted_total, 2),
      'pos_tax', round(v_pos_tax, 2),
      'discounts', round(v_pos_discount, 2),
      'refunds', round(v_refunds, 2),
      'voids_excluded', round(v_voids, 2),
      'pos_net', round(v_pos_posted_total - v_refunds, 2),
      'pos_tax_discount_variance', round(v_pos_posted_total - (v_pos_subtotal - v_pos_discount + v_pos_tax), 2),
      'pos_split_tender_total', round(v_split_total, 2),
      'pos_split_tender_allocated', round(v_split_allocated, 2),
      'pos_split_tender_variance', round(v_split_allocated - v_split_total, 2)
    ),
    'inventory', coalesce(v_base -> 'inventory', '{}'::jsonb) || v_inventory,
    'reconciliation', jsonb_build_object(
      'room_revenue_variance', round(v_room_folio - v_room_payments, 2),
      'room_payments_excluded_from_variance', round(v_room_payments_excluded, 2),
      'pos_tax_discount_variance', round(v_pos_posted_total - (v_pos_subtotal - v_pos_discount + v_pos_tax), 2),
      'pos_split_tender_variance', round(v_split_allocated - v_split_total, 2),
      'voids_excluded', round(v_voids, 2)
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_phase4b_management_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_management_report(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Forward-correction of the legacy management RPC
-- ---------------------------------------------------------------------------
-- The corrected fn_phase4b_management_report still uses this function for the
-- unchanged legacy base fields. Redefining it here removes the cost-derived
-- valuation leak from every fallback caller. It deliberately does not call
-- fn_phase4b_management_report, so there is no recursion.
CREATE OR REPLACE FUNCTION public.fn_management_report(
  p_property_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $legacy$
DECLARE
  v_days integer;
  v_sellable_rooms integer := 0;
  v_available_room_nights numeric := 0;
  v_occupied_room_nights numeric := 0;
  v_room_revenue numeric := 0;
  v_pos_gross numeric := 0;
  v_pos_tax numeric := 0;
  v_discounts numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_inventory_value numeric := 0;
  v_purchases numeric := 0;
  v_consumption numeric := 0;
  v_wastage numeric := 0;
  v_arrivals integer := 0;
  v_departures integer := 0;
  v_reservations integer := 0;
  v_cash_variance numeric := 0;
  v_open_shifts integer := 0;
  v_closed_shifts integer := 0;
  v_total_stock_movements integer := 0;
  v_transfer_orders integer := 0;
  v_can_view_valuation boolean;
BEGIN
  IF p_property_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Access remains membership-scoped for compatibility with the Storekeeper
  -- dashboard. Only the cost-derived valuation is forwarded conditionally.
  v_can_view_valuation := public.is_platform_owner()
    OR public.fn_employee_has_permission(p_property_id, 'stores.inventory.valuation.view');
  v_days := (p_to - p_from) + 1;

  SELECT count(*) INTO v_sellable_rooms
  FROM public.rooms
  WHERE property_id = p_property_id
    AND active = true
    AND status NOT IN ('maintenance', 'out_of_service', 'blocked');
  v_available_room_nights := v_sellable_rooms * v_days;

  WITH stay_days AS (
    SELECT DISTINCT r.room_id, d::date AS stay_date
    FROM public.reservations r
    CROSS JOIN LATERAL generate_series(
      greatest(r.arrival, p_from)::timestamp,
      least(r.departure - 1, p_to)::timestamp,
      interval '1 day'
    ) d
    WHERE r.property_id = p_property_id
      AND r.status <> 'cancelled'
      AND r.room_id IS NOT NULL
      AND r.arrival <= p_to
      AND r.departure > p_from
  )
  SELECT count(*) INTO v_occupied_room_nights FROM stay_days;

  SELECT COALESCE(SUM(greatest(0, (least(r.departure, p_to + 1) - greatest(r.arrival, p_from))) * COALESCE(r.rate, 0)), 0)
  INTO v_room_revenue
  FROM public.reservations r
  WHERE r.property_id = p_property_id
    AND r.status <> 'cancelled'
    AND r.arrival < p_to + 1
    AND r.departure > p_from;

  SELECT count(*) INTO v_reservations
  FROM public.reservations
  WHERE property_id = p_property_id AND status <> 'cancelled' AND arrival <= p_to AND departure > p_from;
  SELECT count(*) INTO v_arrivals
  FROM public.reservations
  WHERE property_id = p_property_id AND status <> 'cancelled' AND arrival BETWEEN p_from AND p_to;
  SELECT count(*) INTO v_departures
  FROM public.reservations
  WHERE property_id = p_property_id AND status <> 'cancelled' AND departure BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(vat), 0), COALESCE(SUM(discount_amount), 0)
  INTO v_pos_gross, v_pos_tax, v_discounts
  FROM public.pos_receipts
  WHERE property_id = p_property_id
    AND status = 'posted'
    AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_refunds
  FROM public.cashier_refunds
  WHERE property_id = p_property_id
    AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(total), 0) INTO v_voids
  FROM public.pos_receipts
  WHERE property_id = p_property_id
    AND status = 'voided'
    AND (voided_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(total), 0) INTO v_purchases
  FROM public.purchase_orders
  WHERE property_id = p_property_id AND status <> 'cancelled' AND purchase_date BETWEEN p_from AND p_to;
  SELECT COALESCE(SUM(qty), 0) INTO v_consumption
  FROM public.stock_usage
  WHERE property_id = p_property_id AND usage_date BETWEEN p_from AND p_to;
  SELECT COALESCE(SUM(quantity), 0) INTO v_wastage
  FROM public.inventory_wastage
  WHERE property_id = p_property_id
    AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  IF v_can_view_valuation THEN
    SELECT COALESCE(SUM(p.current_stock * p.cost_price), 0)
    INTO v_inventory_value
    FROM public.products p
    WHERE p.property_id = p_property_id;
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'open'),
    count(*) FILTER (WHERE status = 'closed'),
    COALESCE(SUM(variance) FILTER (WHERE status = 'closed'), 0)
  INTO v_open_shifts, v_closed_shifts, v_cash_variance
  FROM public.cashier_shifts
  WHERE property_id = p_property_id
    AND (opened_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT count(*) INTO v_total_stock_movements
  FROM public.stock_movements
  WHERE property_id = p_property_id
    AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;
  SELECT count(*) INTO v_transfer_orders
  FROM public.stock_transfers
  WHERE property_id = p_property_id
    AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'days', v_days,
    'hotel', jsonb_build_object(
      'sellable_rooms', v_sellable_rooms,
      'available_room_nights', v_available_room_nights,
      'occupied_room_nights', v_occupied_room_nights,
      'occupancy_percent', CASE WHEN v_available_room_nights = 0 THEN 0 ELSE round(v_occupied_room_nights / v_available_room_nights * 100, 2) END,
      'room_revenue', round(v_room_revenue, 2),
      'adr', CASE WHEN v_occupied_room_nights = 0 THEN 0 ELSE round(v_room_revenue / v_occupied_room_nights, 2) END,
      'revpar', CASE WHEN v_available_room_nights = 0 THEN 0 ELSE round(v_room_revenue / v_available_room_nights, 2) END,
      'reservations', v_reservations,
      'arrivals', v_arrivals,
      'departures', v_departures
    ),
    'sales', jsonb_build_object(
      'pos_gross', round(v_pos_gross, 2),
      'pos_tax', round(v_pos_tax, 2),
      'discounts', round(v_discounts, 2),
      'refunds', round(v_refunds, 2),
      'voids', round(v_voids, 2),
      'pos_net', round(v_pos_gross - v_refunds, 2)
    ),
    'inventory', jsonb_build_object(
      'valuation', CASE WHEN v_can_view_valuation THEN round(v_inventory_value, 2) ELSE NULL::numeric END,
      'valuation_restricted', NOT v_can_view_valuation,
      'purchases', round(v_purchases, 2),
      'consumption_qty', round(v_consumption, 2),
      'wastage_qty', round(v_wastage, 2),
      'stock_movements', v_total_stock_movements,
      'transfer_orders', v_transfer_orders
    ),
    'cashier', jsonb_build_object(
      'open_shifts', v_open_shifts,
      'closed_shifts', v_closed_shifts,
      'cash_variance', round(v_cash_variance, 2)
    )
  );
END
$legacy$;

REVOKE ALL ON FUNCTION public.fn_management_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_management_report(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1c. Store dashboard POS snapshot (no valuation or hotel financial data)
-- ---------------------------------------------------------------------------
-- The Storekeeper dashboard previously reached fn_management_report through a
-- membership-only RPC. This scoped replacement keeps that workflow working
-- without granting store roles the full management report. It deliberately
-- returns only posted POS evidence, never inventory valuation or room revenue.
CREATE OR REPLACE FUNCTION public.fn_phase4b_store_sales_snapshot(
  p_property_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $store$
DECLARE
  v_pos_subtotal numeric := 0;
  v_pos_posted_total numeric := 0;
  v_pos_tax numeric := 0;
  v_pos_discount numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_split_total numeric := 0;
  v_split_allocated numeric := 0;
BEGIN
  IF p_property_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_platform_owner()
     AND NOT public.fn_employee_has_permission(p_property_id, 'stores.access') THEN
    RAISE EXCEPTION 'Permission % is required', 'stores.access' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(r.subtotal), 0),
    COALESCE(SUM(r.total), 0),
    COALESCE(SUM(r.vat), 0),
    COALESCE(SUM(r.discount_amount), 0)
  INTO v_pos_subtotal, v_pos_posted_total, v_pos_tax, v_pos_discount
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'posted'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(f.amount), 0)
  INTO v_refunds
  FROM public.cashier_refunds f
  WHERE f.property_id = p_property_id
    AND (f.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(r.total), 0)
  INTO v_voids
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'voided'
    AND (COALESCE(r.voided_at, r.created_at) AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(r.total), 0)
  INTO v_split_total
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'posted'
    AND lower(COALESCE(r.payment_method, '')) = 'split'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(SUM(a.amount), 0)
  INTO v_split_allocated
  FROM public.pos_receipt_payments a
  JOIN public.pos_receipts r ON r.id = a.receipt_id
  WHERE a.property_id = p_property_id
    AND r.property_id = p_property_id
    AND r.status = 'posted'
    AND lower(COALESCE(r.payment_method, '')) = 'split'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  RETURN jsonb_build_object(
    'sales', jsonb_build_object(
      'pos_gross', round(v_pos_subtotal, 2),
      'pos_posted_total', round(v_pos_posted_total, 2),
      'pos_tax', round(v_pos_tax, 2),
      'discounts', round(v_pos_discount, 2),
      'refunds', round(v_refunds, 2),
      'voids_excluded', round(v_voids, 2),
      'pos_net', round(v_pos_posted_total - v_refunds, 2),
      'pos_tax_discount_variance', round(v_pos_posted_total - (v_pos_subtotal - v_pos_discount + v_pos_tax), 2),
      'pos_split_tender_total', round(v_split_total, 2),
      'pos_split_tender_allocated', round(v_split_allocated, 2),
      'pos_split_tender_variance', round(v_split_allocated - v_split_total, 2)
    )
  );
END
$store$;

REVOKE ALL ON FUNCTION public.fn_phase4b_store_sales_snapshot(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_store_sales_snapshot(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read-only reconciliation evidence RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_phase4b_reconciliation_report(
  p_property_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_cap integer := 500;
  v_totals jsonb;
  v_folio_lines jsonb;
  v_payment_lines jsonb;
  v_receipts jsonb;
  v_refunds jsonb;
  v_voids jsonb;
  v_allocations jsonb;
  v_folio_count bigint;
  v_payment_count bigint;
  v_receipt_count bigint;
  v_refund_count bigint;
  v_void_count bigint;
  v_allocation_count bigint;
  v_summary jsonb;
BEGIN
  IF p_property_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid reporting period' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.is_platform_owner() OR public.is_member_of_property(p_property_id)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_platform_owner()
     AND NOT public.fn_employee_has_permission(p_property_id, 'back_office.reports.view') THEN
    RAISE EXCEPTION 'Permission % is required', 'back_office.reports.view' USING ERRCODE = '42501';
  END IF;

  v_summary := public.fn_phase4b_management_report(p_property_id, p_from, p_to);
  v_totals := coalesce(v_summary -> 'reconciliation', '{}'::jsonb)
    || jsonb_build_object(
      'room_folio_revenue', coalesce(v_summary #>> '{hotel,room_folio_revenue}', '0')::numeric,
      'room_posted_payments', coalesce(v_summary #>> '{hotel,room_posted_payments}', '0')::numeric,
      'room_payments_excluded_from_variance', coalesce(v_summary #>> '{hotel,room_payments_excluded_from_variance}', '0')::numeric,
      'pos_gross', coalesce(v_summary #>> '{sales,pos_gross}', '0')::numeric,
      'pos_posted_total', coalesce(v_summary #>> '{sales,pos_posted_total}', '0')::numeric,
      'pos_tax', coalesce(v_summary #>> '{sales,pos_tax}', '0')::numeric,
      'discounts', coalesce(v_summary #>> '{sales,discounts}', '0')::numeric,
      'refunds', coalesce(v_summary #>> '{sales,refunds}', '0')::numeric,
      'pos_net', coalesce(v_summary #>> '{sales,pos_net}', '0')::numeric
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'business_date', (c.created_at AT TIME ZONE 'Africa/Nairobi')::date,
      'source', c.source,
      'description', c.description,
      'amount', c.amount,
      'created_at', c.created_at
    ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_folio_lines
  FROM (
    SELECT c.*
    FROM public.folio_charges c
    WHERE c.property_id = p_property_id
      AND c.source = 'room'
      AND c.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.folio_charges rev WHERE rev.reversal_of_id = c.id)
      AND (c.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
    ORDER BY c.created_at DESC
    LIMIT v_cap
  ) c;

  SELECT count(*) INTO v_folio_count
  FROM public.folio_charges c
  WHERE c.property_id = p_property_id
    AND c.source = 'room'
    AND c.reversal_of_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.folio_charges rev WHERE rev.reversal_of_id = c.id)
    AND (c.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  -- Evidence uses the same like-for-like room payment scope as the summary:
  -- allocations to room folio lines, plus unallocated payments on room-only
  -- reservations. Mixed-folio and other posted payments are excluded rather
  -- than being silently presented as room settlement.
  WITH room_charges AS (
    SELECT c.id, c.reservation_id
    FROM public.folio_charges c
    WHERE c.property_id = p_property_id
      AND c.source = 'room'
      AND c.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.folio_charges rev WHERE rev.reversal_of_id = c.id)
      AND (c.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
  ),
  mixed_reservations AS (
    SELECT DISTINCT c.reservation_id
    FROM public.folio_charges c
    WHERE c.property_id = p_property_id
      AND c.source <> 'room'
      AND c.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.folio_charges rev WHERE rev.reversal_of_id = c.id)
      AND c.reservation_id IN (SELECT reservation_id FROM room_charges)
  ),
  room_payment_lines AS (
    SELECT p.*
    FROM public.payments p
    WHERE p.property_id = p_property_id
      AND p.status = 'posted'
      AND (p.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
      AND (
        p.folio_charge_id IN (SELECT id FROM room_charges)
        OR (
          p.folio_charge_id IS NULL
          AND p.reservation_id IN (SELECT reservation_id FROM room_charges)
          AND p.reservation_id NOT IN (SELECT reservation_id FROM mixed_reservations)
        )
      )
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'business_date', (p.created_at AT TIME ZONE 'Africa/Nairobi')::date,
        'amount', p.amount,
        'method', p.method,
        'status', p.status,
        'folio_charge_id', p.folio_charge_id,
        'created_at', p.created_at
      ) ORDER BY p.created_at DESC)
      FROM (SELECT * FROM room_payment_lines ORDER BY created_at DESC LIMIT v_cap) p
    ), '[]'::jsonb),
    (SELECT count(*) FROM room_payment_lines)
  INTO v_payment_lines, v_payment_count;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'order_number', r.order_number,
      'business_date', (r.created_at AT TIME ZONE 'Africa/Nairobi')::date,
      'subtotal', r.subtotal,
      'discount_amount', r.discount_amount,
      'vat', r.vat,
      'total', r.total,
      'payment_method', r.payment_method,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_receipts
  FROM (
    SELECT r.*
    FROM public.pos_receipts r
    WHERE r.property_id = p_property_id
      AND r.status = 'posted'
      AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
    ORDER BY r.created_at DESC
    LIMIT v_cap
  ) r;

  SELECT count(*) INTO v_receipt_count
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'posted'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'business_date', (f.created_at AT TIME ZONE 'Africa/Nairobi')::date,
      'amount', f.amount,
      'method', f.method,
      'receipt_id', f.receipt_id,
      'created_at', f.created_at
    ) ORDER BY f.created_at DESC), '[]'::jsonb)
  INTO v_refunds
  FROM (
    SELECT f.*
    FROM public.cashier_refunds f
    WHERE f.property_id = p_property_id
      AND (f.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
    ORDER BY f.created_at DESC
    LIMIT v_cap
  ) f;

  SELECT count(*) INTO v_refund_count
  FROM public.cashier_refunds f
  WHERE f.property_id = p_property_id
    AND (f.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'business_date', (COALESCE(r.voided_at, r.created_at) AT TIME ZONE 'Africa/Nairobi')::date,
      'total', r.total,
      'reason', r.void_reason,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_voids
  FROM (
    SELECT r.*
    FROM public.pos_receipts r
    WHERE r.property_id = p_property_id
      AND r.status = 'voided'
      AND (COALESCE(r.voided_at, r.created_at) AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
    ORDER BY r.created_at DESC
    LIMIT v_cap
  ) r;

  SELECT count(*) INTO v_void_count
  FROM public.pos_receipts r
  WHERE r.property_id = p_property_id
    AND r.status = 'voided'
    AND (COALESCE(r.voided_at, r.created_at) AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'receipt_id', a.receipt_id,
      'payment_method', a.payment_method,
      'amount', a.amount,
      'business_date', (a.created_at AT TIME ZONE 'Africa/Nairobi')::date
    ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_allocations
  FROM (
    SELECT a.*
    FROM public.pos_receipt_payments a
    JOIN public.pos_receipts r ON r.id = a.receipt_id
    WHERE a.property_id = p_property_id
      AND r.property_id = p_property_id
      AND r.status = 'posted'
      AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
    ORDER BY a.created_at DESC
    LIMIT v_cap
  ) a;

  SELECT count(*) INTO v_allocation_count
  FROM public.pos_receipt_payments a
  JOIN public.pos_receipts r ON r.id = a.receipt_id
  WHERE a.property_id = p_property_id
    AND r.property_id = p_property_id
    AND r.status = 'posted'
    AND (r.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;

  RETURN jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'row_cap', v_cap,
    'totals', v_totals || jsonb_build_object(
      'folio_line_count', v_folio_count,
      'payment_line_count', v_payment_count,
      'posted_receipt_count', v_receipt_count,
      'refund_count', v_refund_count,
      'void_count', v_void_count,
      'allocation_count', v_allocation_count
    ),
    'truncated', jsonb_build_object(
      'folio_lines', v_folio_count > v_cap,
      'payment_lines', v_payment_count > v_cap,
      'posted_receipts', v_receipt_count > v_cap,
      'refunds', v_refund_count > v_cap,
      'voids', v_void_count > v_cap,
      'allocations', v_allocation_count > v_cap
    ),
    'folio_lines', v_folio_lines,
    'payment_lines', v_payment_lines,
    'posted_receipts', v_receipts,
    'refunds', v_refunds,
    'voids', v_voids,
    'tender_allocations', v_allocations
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_phase4b_reconciliation_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_reconciliation_report(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Server-side Stores report loaders with explicit caps
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_phase4b_stores_requisitions(
  p_property_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cap integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_only_own boolean;
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.requisition.create', 'stores.requisition.view',
      'stores.requisition.approve', 'stores.requisition.issue',
      'stores.requisition.receive', 'stores.costcentre.manage'
    ]
  );

  v_only_own := NOT public.fn_stores_can_view_all_requisitions(p_property_id);

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT r.created_at, jsonb_build_object(
      'id', r.id,
      'req_no', r.req_no,
      'status', r.status,
      'priority', r.priority,
      'needed_by', r.needed_by,
      'cost_centre_id', r.cost_centre_id,
      'cost_centre_name', cc.name,
      'from_location_name', fl.name,
      'requested_by', r.requested_by,
      'requested_by_name', rp.full_name,
      'submitted_at', r.submitted_at,
      'approved_at', r.approved_at,
      'created_at', r.created_at,
      'line_count', (SELECT count(*) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id),
      'total_requested', COALESCE((SELECT sum(rl.requested_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0),
      'total_approved', COALESCE((SELECT sum(rl.approved_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0),
      'total_issued', COALESCE((SELECT sum(rl.issued_qty) FROM public.requisition_lines rl WHERE rl.requisition_id = r.id), 0)
    ) AS row_obj
    FROM public.requisitions r
    JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
    LEFT JOIN public.inventory_locations fl ON fl.id = r.from_location_id
    LEFT JOIN public.profiles rp ON rp.id = r.requested_by
    WHERE r.property_id = p_property_id
      AND (p_from IS NULL OR (r.created_at AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
      AND (p_to IS NULL OR (r.created_at AT TIME ZONE 'Africa/Nairobi')::date <= p_to)
      AND (NOT v_only_own OR r.requested_by = auth.uid())
    ORDER BY r.created_at DESC
    LIMIT v_cap
  ) x;

  SELECT count(*)
  INTO v_total
  FROM public.requisitions r
  JOIN public.cost_centres cc ON cc.id = r.cost_centre_id
  LEFT JOIN public.profiles rp ON rp.id = r.requested_by
  WHERE r.property_id = p_property_id
    AND (p_from IS NULL OR (r.created_at AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
    AND (p_to IS NULL OR (r.created_at AT TIME ZONE 'Africa/Nairobi')::date <= p_to)
    AND (NOT v_only_own OR r.requested_by = auth.uid());

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'cap', v_cap,
    'truncated', v_total > v_cap,
    'can_approve', public.fn_employee_has_permission(p_property_id, 'stores.requisition.approve'),
    'can_issue', public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue')
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_phase4b_stores_issue_notes(
  p_property_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cap integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY[
      'stores.requisition.view', 'stores.requisition.issue',
      'stores.requisition.receive', 'stores.requisition.approve',
      'stores.issue.void', 'stores.costcentre.manage'
    ]
  );

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT n.created_at, jsonb_build_object(
      'id', n.id,
      'issue_no', n.issue_no,
      'status', n.status,
      'requisition_id', n.requisition_id,
      'requisition_no', r.req_no,
      'cost_centre_id', n.cost_centre_id,
      'cost_centre_name', cc.name,
      'from_location_name', fl.name,
      'to_location_name', tl.name,
      'issued_by', n.issued_by,
      'issued_by_name', ip.full_name,
      'issued_at', n.issued_at,
      'received_at', n.received_at,
      'created_at', n.created_at,
      'line_count', (SELECT count(*) FROM public.issue_note_lines l WHERE l.issue_note_id = n.id),
      'has_discrepancy', EXISTS (
        SELECT 1 FROM public.issue_note_lines l
        WHERE l.issue_note_id = n.id AND l.discrepancy_qty > 0
      )
    ) AS row_obj
    FROM public.issue_notes n
    JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
    LEFT JOIN public.requisitions r ON r.id = n.requisition_id
    LEFT JOIN public.inventory_locations fl ON fl.id = n.from_location_id
    LEFT JOIN public.inventory_locations tl ON tl.id = n.to_location_id
    LEFT JOIN public.profiles ip ON ip.id = n.issued_by
    WHERE n.property_id = p_property_id
      AND (p_from IS NULL OR (COALESCE(n.issued_at, n.created_at) AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
      AND (p_to IS NULL OR (COALESCE(n.issued_at, n.created_at) AT TIME ZONE 'Africa/Nairobi')::date <= p_to)
    ORDER BY n.created_at DESC
    LIMIT v_cap
  ) x;

  SELECT count(*)
  INTO v_total
  FROM public.issue_notes n
  JOIN public.cost_centres cc ON cc.id = n.cost_centre_id
  LEFT JOIN public.requisitions r ON r.id = n.requisition_id
  WHERE n.property_id = p_property_id
    AND (p_from IS NULL OR (COALESCE(n.issued_at, n.created_at) AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
    AND (p_to IS NULL OR (COALESCE(n.issued_at, n.created_at) AT TIME ZONE 'Africa/Nairobi')::date <= p_to);

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'cap', v_cap,
    'truncated', v_total > v_cap,
    'can_issue', public.fn_employee_has_permission(p_property_id, 'stores.requisition.issue'),
    'can_receive', public.fn_employee_has_permission(p_property_id, 'stores.requisition.receive'),
    'can_view_costs', stock_internal.fn_stores_can_view_costs(p_property_id)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_phase4b_stores_transfers(
  p_property_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cap integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_rows jsonb;
  v_total bigint;
BEGIN
  PERFORM stock_internal.fn_stores_assert_any(
    p_property_id,
    ARRAY['stores.stock.transfer', 'stores.stock.receive', 'stores.inventory.view']
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'document_no', t.document_no,
      'status', t.status,
      'reference', t.reference,
      'notes', t.notes,
      'from_location_id', t.from_location_id,
      'to_location_id', t.to_location_id,
      'from_location_name', f.name,
      'to_location_name', to_loc.name,
      'lines', t.lines,
      'line_count', COALESCE(jsonb_array_length(t.lines), 0),
      'created_at', t.created_at,
      'created_by', t.created_by,
      'expected_at', t.expected_at,
      'dispatched_at', t.dispatched_at,
      'dispatched_by', t.dispatched_by,
      'received_at', t.received_at,
      'received_by', t.received_by,
      'cancelled_at', t.cancelled_at,
      'discrepancies', t.discrepancies,
      'is_overdue', (t.status = 'in_transit' AND t.expected_at < now()) OR t.is_overdue
    ) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT st.*
    FROM public.stock_transfers st
    WHERE st.property_id = p_property_id
      AND (p_from IS NULL OR (st.created_at AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
      AND (p_to IS NULL OR (st.created_at AT TIME ZONE 'Africa/Nairobi')::date <= p_to)
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT v_cap
  ) t
  LEFT JOIN public.inventory_locations f ON f.id = t.from_location_id
  LEFT JOIN public.inventory_locations to_loc ON to_loc.id = t.to_location_id;

  SELECT count(*)
  INTO v_total
  FROM public.stock_transfers st
  WHERE st.property_id = p_property_id
    AND (p_from IS NULL OR (st.created_at AT TIME ZONE 'Africa/Nairobi')::date >= p_from)
    AND (p_to IS NULL OR (st.created_at AT TIME ZONE 'Africa/Nairobi')::date <= p_to);

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'cap', v_cap,
    'truncated', v_total > v_cap,
    'permissions', stock_internal.fn_stores_transfer_permissions(p_property_id)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_phase4b_stores_requisitions(uuid, date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_phase4b_stores_issue_notes(uuid, date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_phase4b_stores_transfers(uuid, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_stores_requisitions(uuid, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_stores_issue_notes(uuid, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_phase4b_stores_transfers(uuid, date, date, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
