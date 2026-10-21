-- Integration regression for the replacement POS menu upsert RPC.
-- Runs only against the ephemeral fixture created by the dedicated GitHub Action.
BEGIN;

DO $seed$
DECLARE
  v_property_a uuid := '10000000-0000-4000-8000-000000000001';
  v_property_b uuid := '20000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO public.products(property_id, sku, name, category, unit, current_stock, selling_price, pos_enabled)
  VALUES(v_property_a, 'MENU-001', 'Old Menu Name', 'Drinks', 'bottle', 4, 100, true);
  INSERT INTO public.products(property_id, sku, name, category, unit, current_stock, selling_price, pos_enabled)
  VALUES(v_property_a, 'MENU-002', 'Other Product', 'Drinks', 'bottle', 2, 50, true);
  -- The same SKU is legal in a different property because uniqueness is tenant-scoped.
  PERFORM public.fn_upsert_pos_menu_item(
    v_property_b, NULL, 'MENU-001', 'Property B Menu', 'Food', 'portion', 220, 1, 0, 0, 'Kitchen', 0, true
  );
END
$seed$;

DO $upsert_existing$
DECLARE
  v_property_a uuid := '10000000-0000-4000-8000-000000000001';
  v_row public.products;
  v_count integer;
BEGIN
  v_row := public.fn_upsert_pos_menu_item(
    v_property_a, NULL, 'MENU-001', 'Updated Menu Name', 'Drinks', 'bottle', 150, 8, 1, 20, 'Bar', 4, true
  );
  SELECT count(*) INTO v_count FROM public.products WHERE property_id = v_property_a AND sku = 'MENU-001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: import created duplicate product row(s): %', v_count; END IF;
  IF v_row.name <> 'Updated Menu Name' OR v_row.selling_price <> 150 OR v_row.current_stock <> 4 THEN
    RAISE EXCEPTION 'FAIL: existing SKU update changed identity, price, or ledger-owned stock incorrectly';
  END IF;
  RAISE NOTICE 'PASS: importing an existing SKU updates the same product';
END
$upsert_existing$;

DO $different_property$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.products
  WHERE property_id = '20000000-0000-4000-8000-000000000002' AND sku = 'MENU-001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: property-scoped SKU uniqueness was not preserved'; END IF;
  RAISE NOTICE 'PASS: same SKU remains independent across properties';
END
$different_property$;

DO $edit_collision$
DECLARE
  v_other_id uuid;
  v_property_a uuid := '10000000-0000-4000-8000-000000000001';
BEGIN
  SELECT id INTO v_other_id FROM public.products WHERE property_id = v_property_a AND sku = 'MENU-002';
  BEGIN
    PERFORM public.fn_upsert_pos_menu_item(
      v_property_a, v_other_id, 'MENU-001', 'Other Product', 'Drinks', 'bottle', 99, 2, 0, 0, 'Bar', 0, true
    );
    RAISE EXCEPTION 'FAIL: editing another product stole an existing SKU';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE 'SKU "%" is already assigned to another product%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS: SKU collision returns an actionable unique violation';
  END;
END
$edit_collision$;

ROLLBACK;
