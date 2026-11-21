# POS Composite Items — Phase 4 Atomic Sales and Category Routing

**Status:** Implemented on the composite-items feature branch; CI validation pending.  
**Migration:** `20261120090000_phase4_atomic_composite_pos_sales.sql`

## Composite stock deduction

The existing POS sale transaction already invokes `fn_consume_recipe_stock` before inserting the receipt. This phase replaces that helper rather than introducing a second checkout path.

- Resolves recipes by stable `recipes.menu_product_id`.
- Retains name matching only for legacy recipes whose product link is still null.
- Converts ordered menu quantity into recipe yield quantity and component quantities.
- Locks component product rows and updates stock within the existing sale transaction.
- Writes a stock movement per consumed component, including normalized base quantity, unit, recipe ID and recipe version.
- Writes stock usage rows for inventory reporting.
- Honors the property's `negative_stock_policy`: block or warn/allow.
- Uses an advisory transaction lock and unique stock-movement idempotency key so component consumption cannot be duplicated by a retry of the same sale transaction.
- Any failure rolls back component stock movements and the receipt together.

## POS visibility

The existing `pos_enabled` and `pos_active` controls remain the primary sellable-menu controls. The menu RPC now additionally excludes inventory-only `raw_ingredient` and `consumable` product types. Existing legacy products with no `stock_item_type`, and sellable retail/finished-good products, remain visible when enabled.

This is the Phase 4 interpretation of the requested rule: inventory-only variable/raw stock is not a cashier-facing menu tile; sellable products remain available.

## Category printer routing

- Category editor exposes a Kitchen printer / Bar printer routing choice.
- It persists through the existing `pos_menu_categories.production_center` field; no duplicate routing table or printer configuration is introduced.
- POS menu RPC resolves the category's production center and passes it to the existing order routing path.
- The existing printer assignments still determine which physical printer receives Kitchen and Bar tickets.
- Receipt printing and the existing printer agent remain unchanged.

## Boundaries

- No production migration applied.
- No production stock balances or receipts changed.
- No new physical printer records or assignments created.
- Raw components are not emitted as separate customer-facing sale lines.
- Refunds, partial refunds and wastage remain Phase 7 work.
- Inventory location allocation remains governed by the existing product/location model; this phase does not invent a location mapping.

## Required validation

- Architecture suite including Phase 2–4 contracts.
- Lint, typecheck and production build.
- Disposable database test of sale rollback, negative-stock block/warn, repeated sale idempotency, duplicate component rows, legacy recipe fallback, multiple properties, category Kitchen/Bar routing.
- Authorized POS acceptance test with real printers before production release.
