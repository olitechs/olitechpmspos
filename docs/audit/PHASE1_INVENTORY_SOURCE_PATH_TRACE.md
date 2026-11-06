# Phase 1 — Inventory source-path trace (free-tier continuation)

Date: 2026-11-06  
Branch: `feat/phase-1-inventory-integrity-free-tier`  
Scope: source review only; no application/SQL changes.

## Executive result

The source review confirms that the inventory defect is not isolated to one adjustment RPC. Multiple business workflows have distinct stock mutation paths, and some paths combine a shared writer, direct location writes, and a trigger that synchronizes location quantities from aggregate product stock. A safe fix must establish one posting owner per business event before changing any of those paths.

This report is not a migration specification. The current live free-tier database remains read-only, and the existing project is not an isolated regression environment.

## Traced paths and risks

### 1. Shared writer and aggregate-to-location trigger

- `20261008120000_phase4_authoritative_inventory_ledger.sql` defines `fn_apply_stock_movement(product_id, change, reason, source_type, source_id)`. The function locks the product, checks property membership and negative aggregate stock, updates `products.current_stock`, and inserts a movement row.
- `0064_sync_store_location_stock.sql` installs `products_sync_default_location`, an AFTER UPDATE OF `current_stock` trigger. It applies the aggregate delta to the location named by `products.location`.
- The 2026-10-18 forensic snapshot confirms this trigger was present in the inspected production catalog at that time. It is evidence only and must never be replayed.

**Implication:** any RPC that updates a location row and then calls the shared writer can apply one business delta to two location rows, or apply it twice to the same default location.

### 2. Manual adjustment and count approval

The 2026-10-18 forensic function snapshot records:

- `fn_post_stock_adjustment` directly inserts/updates `product_stock_locations` for the requested location and then calls `fn_apply_stock_movement`.
- `fn_approve_inventory_count` writes the counted quantity to the selected location, then calls `fn_apply_stock_movement` with the count variance.

Combined with the aggregate trigger above, these paths can misallocate the delta. The existing runtime regression test correctly asserts that a non-default adjustment must not change the default location and that a positive/negative round trip restores both locations and aggregate stock.

**Implementation rule:** remove the duplicate location mutation only after the shared writer accepts and owns the intended location; do not simply remove the location write or disable the trigger without migrating every affected caller.

### 3. POS sale and recipe consumption

- `20261008041101_phase3_pos_pms_integration.sql` includes receipt-level idempotency through `pos_receipts.idempotency_key`.
- The source body calls `fn_consume_recipe_stock` and separately deducts tracked non-recipe products by updating `products.current_stock` and inserting `stock_movements` directly.
- `20261008120000_phase4_authoritative_inventory_ledger.sql` defines a shared writer, while `20261008160000_phase4_pos_inventory_authority.sql` attempts a text replacement against one exact 16-argument `fn_record_pos_sale` signature. Its replacement supplies a NULL source ID.
- The recipe-consumption implementation in the tracked source updates aggregate stock and inserts movement rows directly; the forensic snapshot records a later implementation calling the shared writer but still passing NULL source IDs.

**Implication:** source migration order/signature provenance must be reconciled before assuming the POS replacement was applied to the currently deployed overload. POS receipt idempotency does not automatically make each stock movement source-linked. Recipe consumption and direct product deduction must remain mutually exclusive for recipe products, as intended by the current conditional.

**Required tests:** duplicate POS request with the same idempotency key; sale of a recipe item; sale of a tracked non-recipe item; partial/full refund and void; assert one stock delta and exact linked movement set.

### 4. Goods receiving

- `20261008133000_phase4_goods_receiving_grn.sql` creates a new GRN for each receive call, inserts receipt lines, and calls the shared writer with the GRN ID.
- The PO is locked and over-receipt is checked against previously recorded receipt lines.
- A retried request after a successful commit can create a new GRN and receive the same still-remaining quantity again if the original request was only a partial receipt. The PO lock and remaining-quantity check prevent over-receiving but do not identify the original client request.

**Implication:** add a stable request/source key at GRN-line level and enforce idempotency before considering a retry safe. Do not rely on a generated GRN number as the retry key.

### 5. Transfers

The committed transfer schema stores source/destination locations and a pending/completed/cancelled status. Prior live/source review records paired direct location updates and paired out/in movement inserts without stable source linkage.

**Implication:** transfers are a special atomic two-location event. They should retain paired postings, use one transfer/line identity for both movement rows, lock the transfer and affected balances, and preserve the property-wide aggregate. Do not route each side through a generic aggregate-delta trigger that changes the total stock.

### 6. Bulk product import

- `src/services/inventoryService.js` sends imports through `fn_bulk_upsert_store_products`.
- `20261008121500_phase4_bulk_import_ledger.sql` sends opening-stock and reconciliation deltas through `fn_apply_stock_movement`, then separately upserts the imported quantity into `product_stock_locations`.
- The current trigger also synchronizes a default location when the shared writer updates aggregate stock. The import function then explicitly sets the selected import location quantity.

**Implication:** import currently mixes ledger-driven aggregate updates, trigger side effects, and a direct location assignment. Import semantics also need to be explicit: target-on-hand reconciliation vs additive receipt. Re-import idempotency requires an import-batch/line key, not just the product ID.

### 7. Product cost visibility

`inventoryService.listProducts()` selects `*` and only masks `cost_price` after fetching the response in the browser. `createProduct()` and `updateProduct()` also read back `*`. The existing cost-access audit identifies the same exposure and calls for safe non-cost projections plus a separately authorized cost read. Browser masking is not a database security boundary.

**Implication:** treat cost confidentiality as a database/API remediation, with explicit role authorization in valuation and write RPCs. Do not use a UI-only role check as the control.

## Work sequencing decisions

1. Freeze business-path inventory: list every caller of the shared writer and every direct mutation of `products.current_stock`, `product_stock_locations`, and `stock_movements`.
2. Resolve live overloads and migration provenance for each function. The 2026-10-18 snapshots are historical evidence and must be refreshed read-only before a future rollout.
3. Define the stock invariant and one location-aware posting owner. The proposed invariant is aggregate stock equals the sum of active location balances, with movements reconciling under a documented opening-balance policy.
4. Implement source-key/idempotency for each retryable event.
5. Close direct table DML and enforce action-specific authorization in the database.
6. Run the existing catalog and runtime regression suites against a reproducible local fixture, extending them for POS, GRN retries, transfer, recipe consumption, import and cost access.
7. Only then propose a forward-only migration and application changes for review.

## Files deliberately not changed

No source code, SQL migration, printer, paper-feed, order-ticket, receipt, unsettled-bill, cashier-printing, or payment-printing file was modified in this continuation.


## Regression-test quality finding (6 November 2026)

A focused review of the existing `tools/inventory/phase2-ledger-contract.test.mjs` found that its POS source assertion is a migration-text characterization, not proof of the deployed function body:

- The test asserts that the POS migration contains `fn_apply_stock_movement`, but also asserts that the migration contains the legacy direct `UPDATE products` and `INSERT stock_movements` statements. Those legacy statements are embedded as the exact text-replacement target inside the migration's `replace(...)` call.
- The migration replaces that fragment with a shared-writer call, but supplies `source_type = 'pos_sale'` and `source_id = NULL`. Thus the migration's intended replacement still leaves stock movements without a stable source identity.
- The test does not execute the migration, inspect the resulting function definition, verify that the replacement matched the deployed overload, or prove idempotent movement posting.

**Required test correction before implementation:** separate (1) a source-text test that confirms the expected legacy fragment and replacement are exact, from (2) a database catalog/runtime test that inspects the resulting overload and verifies a non-null stable sale/line source key and duplicate-request behavior. A passing source-text test must never be reported as runtime or deployment verification.

This is a test-quality and source-design finding only. No test, SQL, application code, or database was changed. The protected printer, paper-feed, ticket, receipt, unsettled-bill, and cashier-printing scope remains excluded.
