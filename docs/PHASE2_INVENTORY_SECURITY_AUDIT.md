# Phase 2 — Inventory Security and Data-Integrity Audit

**Repository:** `olitechs/olitechpmspos`  
**Branch:** `phase-2-inventory-security-audit`  
**Base commit:** `b9890d84aa6e370c719fbb4a9952dc5f4be80e27` (Phase 1 merge)  
**Audit date:** 2026-10-18  
**Status:** Read-only audit findings captured; implementation/schema changes are gated.

## Safety boundary

This phase inspected the current repository and read-only metadata from the existing Supabase project `olitechs-pms-pos` (`mszogmazldxjsiytrlxr`). No SQL DDL/DML was executed, no migration was applied, no production data was changed, and no paid Supabase branch was created. The existing disposable test project was not modified. Do not rewrite or renumber historical migrations.

The next implementation step must not start with new stock tables. First close the authorization and reconciliation questions below, add regression tests, and establish a reproducible local/disposable test path without changing production.

## Confirmed source/live findings

### P0 — Buying cost is masked in the UI, not protected at the data boundary

- `public.products` contains `cost_price`; the live `products_select` RLS policy permits any property member to select the row.
- `inventoryService.listProducts()` replaces `cost_price` with `null` for roles outside a UI allow-list. This is presentation filtering, not a database access boundary.
- `public.fn_inventory_valuation(p_property_id uuid)` is SECURITY INVOKER and executable by authenticated users. It returns `cost_price` and `stock_value`, while the underlying product policy only requires property membership. The UI mask therefore does not protect cost from direct table/RPC reads.

**Required response:** design and test a server-enforced cost-visibility contract. Consider role-authorized RPCs/views that return only approved fields, plus explicit grants and RLS. Do not expose a broad product row containing cost to unauthorized roles. Validate both direct table reads and RPC calls using representative staff/property roles.

### P0 — Several stock mutation RPCs check property membership but not the store action entitlement/role

Read-only inspection of the live function definitions and grants found authenticated execution for SECURITY DEFINER functions including:

- `fn_record_stock_usage`
- `fn_post_stock_adjustment`
- `fn_adjust_product_stock`
- `fn_approve_inventory_count`
- `fn_complete_stock_transfer`
- `fn_create_inventory_count`
- `fn_create_purchase_order`
- `fn_receive_purchase_order`
- `fn_consume_recipe_stock`
- `fn_upsert_recipe`

The inspected mutation bodies generally check `is_platform_owner()` or `is_member_of_property(...)`; that is a tenant boundary, not necessarily permission to issue stock, approve a count, receive goods, transfer stock, edit recipes, or change buying cost. By contrast, `fn_bulk_upsert_store_products` also calls `can_store_write(property, category)`, which checks subscription-module access and the active staff role.

**Required response:** define an explicit role/action matrix and enforce it inside every privileged RPC, not just React components. Include tenant isolation, subscription entitlement, active staff session/role, and approval separation. Audit all SECURITY DEFINER functions individually; do not blindly revoke execute from all 96 advisor findings because some RPCs are intentional and need caller-specific authorization.

### P0 — Location-specific adjustments/count approval can desynchronize location balances

The live `fn_post_stock_adjustment` updates `product_stock_locations` for the requested location, then calls `fn_apply_stock_movement`, which changes `products.current_stock`. The `products_sync_default_location` trigger also applies that global stock delta to the product's default location. Consequently, an adjustment aimed at a non-default location can alter that location and also apply the delta to the default location. If the target is the default location, the same delta can be applied twice.

The live `fn_approve_inventory_count` similarly writes a counted quantity into the selected location and then posts the difference through `fn_apply_stock_movement`, which invokes the default-location sync trigger. This path requires the same review.

**Required response:** settle the inventory invariant first. Define whether `products.current_stock` is a maintained aggregate of all locations or a compatibility/default-location value. Then make a single transaction own both aggregate and location deltas; avoid triggers that infer the target location when a caller already specified one. Add tests for default and non-default locations, positive and negative changes, and repeated/retried approval.

### P1 — Multiple stock representations exist and must be mapped before extension

Live schema includes the newer `products` + `stock_movements` ledger and `inventory_locations` + `product_stock_locations` balances, as well as older `inventory_items` + `inventory_movements`. It also includes `stock_usage`, `purchase_orders`, GRNs, transfers, counts, adjustments, wastage, recipes, and POS inventory paths.

The repository's Phase 4 migration describes `stock_movements` as the authoritative ledger, and POS sales were routed through `fn_apply_stock_movement`. Other functions, such as transfer completion, post paired movement rows directly. Recipe consumption can call `fn_apply_stock_movement` and insert a `stock_usage` row. The exact event graph and ownership of each mutation must be documented before any further path is added, to avoid duplicate deductions and inconsistent audit metadata.

**Required response:** document each source event (GRN, POS sale, recipe, direct usage, adjustment, count, transfer, production, wastage, refund/void) with its single posting owner, location effect, reversal path, idempotency key/source link, and audit record. Do not create a parallel ledger.

### P1 — Cost history is not sufficient for historical consumption valuation

- `fn_inventory_valuation` calculates current stock value as `current_stock * current cost_price`.
- GRN receiving updates `products.cost_price` using a moving-average calculation when the received unit cost is positive.
- Bulk product import writes `cost_price` directly and can reconcile stock through the movement function.
- `stock_movements` records quantity/type/reason/source metadata, but the inspected schema does not include a movement-level unit-cost or extended-cost snapshot.

Changing a product's current cost therefore cannot reliably reconstruct historical usage value from the movement record alone.

**Required response:** document the costing policy before implementing reports. Preserve receipt unit cost and movement-time cost/value in a transactionally consistent way (or use a rigorously defined cost-layer ledger). Define treatment of opening stock, returns, partial receipts, void/refund reversals, transfers, count variances, and imports. Do not silently rewrite historical cost.

### P1 — Existing movement exports are incomplete and capped

- `inventoryService.listMovements()` applies date/category filters but caps each request at 500 rows.
- `listUsage()` and `listInventoryHistory()` also cap results at 500.
- `exportStockReport()` creates one worksheet with date, product, SKU, category, type, quantity, reason, and user. It does not include opening/closing balances, movement value, buying cost, department totals, or POS-versus-direct-usage reconciliation.
- `UsageForm.jsx` hard-codes only F&B, Housekeeping, Laundry, and Bar.

**Required response:** retain product import/export and existing stock workflows. For a future stock-control workbook, use a paginated/server-aggregated date range and role-authorized costing fields. Add configurable hotel departments only after the posting/security contract is fixed. The requested daily/weekly/monthly sheets belong after ledger correctness, not before.

### P1 — Migration provenance is not yet reconciled

- The live Supabase migration ledger currently reports 38 entries.
- The repository has a much larger migration directory with overlapping numeric prefixes (for example, duplicate `0035`, `0037`, `0040`, `0045`, `0047`, `0048`, and `0049`) and duplicate timestamp prefixes (including `20261008170000` and `20261008223000`).
- Some committed migration files explicitly state that SQL was applied through Supabase before the parity file was committed. Live migration versions/names do not provide SQL checksums, so this metadata comparison alone cannot prove exact source/live equivalence.

**Required response:** create a source-to-live reconciliation table mapping each live migration ledger entry to its committed SQL file (or documenting a known manually-applied migration), then compare relevant function, trigger, policy, grant and table definitions. Do not edit old migration filenames or mark historical entries as applied just to silence drift. New changes, if approved later, must be forward-only migrations tested against a disposable/local database first.

## Read-only Supabase advisor snapshot

At the time of this audit, security advisors reported:
- 1 informational finding: `staff_pin_attempts` has RLS enabled with no policies (may be deliberate for a service-only table; confirm grants and intended access before changing it).
- 1 warning: `fn_public_booking_engine_config(uuid)` is executable by `anon` as SECURITY DEFINER. It may be an intentional public booking-engine endpoint; inspect exposed fields and authorization intent before changing it.
- 96 warnings for authenticated execution of SECURITY DEFINER functions. These require per-function body/grant review, not blanket revocation.
- 1 Auth warning: leaked-password protection is disabled.
- Performance advisors also report 45 unindexed foreign keys, 103 unused indexes, and 20 multiple-permissive-policy findings. These are a separate review queue; do not drop indexes or rewrite policies without query/workload evidence.

The public booking function and unrelated global advisor findings are recorded as baseline issues; they are not to be changed incidentally in the stock phase.

## Phase 2 exit gates

Do not implement or apply a database migration until all are satisfied:

1. [ ] Document the authoritative ledger, all stock mutation call paths, location balance invariant, and reversal/idempotency behavior.
2. [ ] Write an explicit role/action matrix for cost reads, stock issue, adjustment, count creation/approval, transfers, purchasing/receiving, recipe management, and exports.
3. [ ] Reconcile live migration history to committed source files without rewriting historical migration history.
4. [ ] Add repeatable tests for tenant isolation, role denial, cost-field denial, negative stock, GRN partial receipt, transfer, count variance, location-specific adjustment, POS sale, void/refund, recipe consumption, and retry/idempotency.
5. [ ] Reproduce the relevant schema locally or in an already-authorized disposable environment; do not create paid Supabase branches.
6. [ ] Run Supabase security advisors and the application lint/typecheck/test/build suite after changes.
7. [ ] Obtain review of the forward-only migration and its rollback/recovery plan before any shared database deployment.

## Next implementation sequence

1. Build an inventory event/role matrix and tests first.
2. Fix role enforcement and location-balance correctness in a reviewed forward migration, plus corresponding client error handling.
3. Add movement-time costing after the valuation policy is agreed and tested.
4. Only then implement department-configurable usage and full daily/weekly/monthly Excel reporting.
