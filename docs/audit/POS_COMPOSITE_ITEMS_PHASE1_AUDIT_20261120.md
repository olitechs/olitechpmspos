# POS Composite Items — Phase 1 Audit

**Date:** 2026-11-20  
**Repository:** `olitechs/olitechpmspos`  
**Branch:** `feat/pos-composite-items-phase1-audit`  
**Production Supabase project:** `mszogmazldxjsiytrlxr` (PostgreSQL 17.6.1)  
**Scope:** Read-only source and live-catalog audit. No schema, data, application, or production changes were made.

## Executive decision

The composite-item feature should extend the existing `recipes` / `recipe_ingredients` model and the authoritative `stock_movements` ledger. Do not add a parallel stock ledger, and do not add client-side stock deductions.

The current system has a working recipe foundation, but the live sale and refund paths are not yet safe enough to extend directly. The blockers are stable product identity, recipe-version snapshots, per-line movement idempotency, location-aware posting ownership, and quantity-based refund reversal.

**Phase 1 result: audit complete; implementation is gated on resolving the blockers below.**

## 1. Active application call path

| Area | Active path | Finding |
|---|---|---|
| POS settlement | `BillPayment.jsx` → `pmsService.recordPosSale` → `fn_record_pos_sale_with_vat_snapshot` | Sale, receipt, payment allocations and stock posting are committed through the database sale path. Do not add a second client deduction. |
| Sale RPC | VAT snapshot wrapper → `fn_record_pos_sale` (16-argument split-payment overload) | The live wrapper delegates to the 16-argument sale overload. The live catalog also retains a legacy 10-argument overload. |
| Recipe consumption | Sale RPC → `fn_consume_recipe_stock` | Recipes are resolved by case-insensitive `menu_item_name`, not by a stable sellable product ID. |
| Direct product consumption | Same sale RPC loops receipt items and calls `fn_apply_stock_movement` for linked direct products that do not match an active recipe name. | Direct product and recipe paths are separate. The recipe path must remain the only owner for a composite product. |
| Stock adjustment / wastage | `inventoryService.js` → adjustment/wastage RPCs | The current functions update a selected location directly and also call the aggregate stock writer. This can interact incorrectly with the default-location synchronization trigger. |
| Refund / void | Cashier adjustment → `fn_approve_cashier_adjustment` → `fn_reverse_pos_stock` | Reversal is recalculated from receipt JSON and the *current* recipe, rather than reversing the original sale's exact component movements. |
| Product editor | Active Store / product services | Existing product stock fields are `track_stock`, `stock_item_type`, and `base_unit`. There is no `inventory_tracking_mode` column yet. |

## 2. Live production schema verified read-only

### Products

The live `products` table contains:
- `id`, `property_id`, `name`, `sku`, `unit`, `base_unit`
- `current_stock`, `min_stock`, `max_stock`
- `cost_price`, `selling_price`
- `track_stock`, `stock_item_type`
- POS visibility/category/visual fields

It does **not** currently contain an explicit `inventory_tracking_mode` field or a product-level stock unit conversion relation.

### Recipes

The live `recipes` table contains:
- `id`, `property_id`, `menu_item_name`
- `yield_qty`, `active`, `notes`, `created_at`

It does **not** contain `menu_product_id`, a recipe version, or an effective-version reference.

The live `recipe_ingredients` table contains:
- `id`, `recipe_id`, `product_id`, `qty`

This is already a product-ID-based component list, but its parent recipe is associated with the sellable menu product by name.

### Units and stock ledger

The live schema already includes:
- `inventory_units` with unit code, label, dimension and fractional-quantity support.
- `inventory_unit_conversions` with `property_id`, `from_unit`, `to_unit`, and `factor`.
- `stock_movements` with `source_type`, `source_id`, `location_id`, `source_line_key`, `idempotency_key`, `unit_code`, `base_qty`, `unit_cost`, `recipe_id`, `recipe_version`, and `reversal_of_id`.
- `inventory_locations` and `product_stock_locations`.

Therefore Phase 3 must first assess and reuse the existing unit/conversion and movement metadata. Do not blindly add duplicate columns or tables.

## 3. Live sale and stock-posting findings

### 3.1 Recipe consumption currently uses names

The live `fn_consume_recipe_stock(uuid,jsonb,text)`:
1. Reads each POS item name and quantity from JSON.
2. Finds active recipes where `lower(trim(menu_item_name)) = lower(item name)`.
3. Scales each ingredient quantity by `order quantity / yield_qty`.
4. Calls `fn_apply_stock_movement(ingredient_id, -needed, ..., 'pos_recipe', NULL)`.
5. Inserts a `stock_usage` audit/department row.

Risks:
- Product renames or duplicate names can change which recipe is consumed.
- Recipe edits after a sale can change how a historical refund is calculated.
- Movement source IDs are NULL, so a receipt/line cannot be reliably identified for reversal or retry deduplication.
- The sale JSON does not establish an immutable component snapshot.

### 3.2 Direct stock posting is a separate loop

The live 16-argument `fn_record_pos_sale`:
- checks `pos.process_sale` and discount/folio permissions;
- checks property membership and the open cashier shift;
- supports split payments and validates the allocations total;
- checks the receipt idempotency key;
- invokes `fn_consume_recipe_stock` once;
- loops receipt lines and posts directly tracked products through `fn_apply_stock_movement`;
- writes the receipt and split-payment rows in the same transaction.

The direct stock call currently passes a NULL source ID. The recipe helper also passes a NULL source ID. The receipt idempotency key prevents duplicate receipts, but it does not by itself prove that each individual stock movement has a stable, unique source-line key.

### 3.3 Authoritative stock writer

The live `fn_apply_stock_movement(uuid,numeric,text,text,uuid)`:
- locks the product row with `FOR UPDATE`;
- verifies platform-owner/property membership;
- respects `track_stock`;
- reads the property negative-stock policy;
- updates `products.current_stock`;
- inserts an immutable `stock_movements` row.

It does not accept a location, source-line key, or idempotency key. The current property setting defaults to `warn_allow` when no setting exists; the helper blocks a shortage only when the setting is `block`. The implementation must preserve the configured policy unless a separately approved policy change is made.

### 3.4 Location ownership is a blocker

The current adjustment and wastage RPCs:
- mutate `product_stock_locations` for the selected location;
- then call `fn_apply_stock_movement`, which changes aggregate `products.current_stock`;
- the aggregate update can trigger default-location synchronization.

This creates a risk of a second or misplaced location delta. POS composite deduction must not be added to this location path until the posting owner and trigger invariant are reconciled and tested.

The intended invariant remains:
- `stock_movements` is the authoritative quantity ledger;
- `products.current_stock` is an aggregate projection;
- `product_stock_locations` is a location projection;
- one event has exactly one posting owner.

## 4. Refund and void findings

The live `fn_reverse_pos_stock`:
- receives receipt JSON and a numeric ratio;
- resolves active recipes by item name again;
- calculates ingredient reversal from the current recipe;
- posts positive movements through `fn_apply_stock_movement`;
- uses NULL source IDs.

The live `fn_approve_cashier_adjustment`:
- restores stock for a full receipt void using ratio 1;
- for a partial receipt refund, uses `refund amount / receipt total` as the stock-reversal ratio;
- records financial refund allocations and updates receipt status when fully refunded.

This is not a reliable quantity-return model. A money-only refund, a prepared/discarded meal, a partial item return, and a physical return of usable stock must not all restore the same proportional ingredients.

Required future contract:
- retain the exact component movement rows generated by the original sale;
- reverse only explicitly returned line quantities;
- record whether returned stock is physically usable and restocked;
- treat prepared/discarded items as wastage, not refund restock;
- make reversal idempotent and linked to the original receipt and refund/void event.

## 5. Phase 1 blockers and implementation order

| Blocker | Required resolution | Phase |
|---|---|---|
| Recipe parent keyed by name | Add stable product linkage while preserving existing recipes and resolving duplicate-name/legacy mappings safely. | 2 |
| No immutable recipe snapshot | Add explicit recipe versions and snapshot the version/component quantities used by each sale line. | 2 / 4 |
| Unit conversion model exists but is generic | Inspect and reuse current unit catalog/conversion rows; validate dimensions and precision before extending. | 3 |
| Movement helper lacks event/line identity and location | Design a single internal posting contract with stable receipt idempotency + line/component keys and explicit location ownership. | 4 |
| Recipe and direct product paths are separate | Make the sale RPC resolve one tracking mode per sellable product and expand composites exactly once. | 4 |
| Refunds reverse by money ratio/current recipe | Introduce quantity-based returned-line data and reverse original component movements only. | 7 |
| Location projections may double-apply | Reconcile triggers, all current-stock writers, and live balances before any location-aware stock change. | 1 prerequisite to 4 |
| Offline sale reconciliation | Preserve the current stable receipt key and ensure replay returns the original committed receipt without reposting component movements. | 4 / 6 |

## 6. Agreed product behavior

The requested feature is a fixed-component composite item:
- A sellable POS product is configured as a composite.
- It contains one or more existing inventory products and a quantity per one sale unit.
- Selling multiple units multiplies each component quantity.
- Component costs contribute to the composite cost calculation.
- The composite's own stock is not decremented by default; its component stock is.
- Component products can remain hidden from the POS catalogue while remaining available to inventory.
- Production/assembly/batch output is explicitly out of scope for this implementation.

## 7. Required verification before Phase 2/4 code

1. Reconcile the deployed sale/stock/refund function bodies with committed migration source and function grants.
2. Inspect the full product/recipe/location trigger graph and prove the balance projection invariant.
3. Verify the live `inventory_unit_conversions` constraints, seed rows and all current consumers.
4. Build a production-equivalent disposable database fixture; do not use the documented non-equivalent disposable project as proof.
5. Add regression tests for one composite, multiple quantities, fractional units, insufficient component stock, split tender, retry replay, concurrent sales, full void, partial quantity return, money-only refund and cross-property references.
6. Keep all existing role, package entitlement, RLS, receipt, kitchen-ticket, printer and offline behavior intact.

## 8. Non-actions

- No production SQL was executed beyond read-only catalog/schema inspection.
- No migration was applied.
- No stock or receipt data was changed.
- No production/assembly workflow was added.
- No application code was changed.
