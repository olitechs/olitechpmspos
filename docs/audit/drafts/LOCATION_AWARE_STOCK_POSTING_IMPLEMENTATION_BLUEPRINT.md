# Location-Aware Stock Posting — Implementation Blueprint
Date: 2026-11-15
Status: design only; NOT an executable migration and NOT deployed

## Objective

Make `stock_movements` the single auditable movement ledger and establish one trusted posting path that updates:
1. the product aggregate (`products.current_stock`),
2. exactly one intended location balance (`product_stock_locations`), and
3. one immutable movement record (`stock_movements`).

A posting operation must be atomic. It must not update a location twice, update the wrong location, or permit a client to bypass authorization by writing stock tables directly.

## Live code confirmed on 2026-11-15

The following definitions were read from the production catalog (read-only):

- `fn_apply_stock_movement(uuid,numeric,text,text,uuid)` locks the product, checks only platform-owner/property membership, applies the configured negative-stock policy, updates `products.current_stock`, and inserts a movement. It does not explicitly post to a requested location, attach the new location/source-line metadata, or check the Stores entitlement.
- `fn_sync_product_default_location()` is attached to `products_sync_default_location`, an AFTER UPDATE OF `current_stock` trigger. It calculates the product aggregate delta and applies it to the default location selected from `products.location` (or Main Store).
- `fn_post_stock_adjustment` directly changes `product_stock_locations` when a location is supplied, then calls `fn_apply_stock_movement`. The product update fires the default-location trigger as well.
- `fn_post_wastage` directly decrements the selected location, then calls `fn_apply_stock_movement`, which updates the aggregate and fires the default-location trigger.
- `fn_approve_inventory_count` writes the selected location to the counted quantity, then posts the variance through `fn_apply_stock_movement`; this also fires the default-location trigger.
- `fn_complete_stock_transfer` directly decrements/increments the two location rows and inserts two movements, but does not attach location/source identifiers to those movement rows or use the common posting function.
- `fn_post_production` and `fn_record_stock_usage` use `fn_apply_stock_movement` without a location identifier.
- `fn_apply_stock_movement` honors `property_settings.negative_stock_policy` (default `warn_allow`, configurable `block`) against aggregate stock, while adjustment/wastage/transfer functions independently enforce some location-level checks.

## Required design decisions

### A. Do not patch the existing trigger with a caller-controlled bypass flag

A user-settable session setting is not an authorization boundary: a client can set custom PostgreSQL settings. Do not let a caller suppress location synchronization by setting a GUC.

The trigger and writer need a database-enforced ownership contract. The preferred end state is that all stock-changing paths call one internal SECURITY DEFINER posting service, while the legacy aggregate-to-default-location trigger is removed only after every writer and product-initialization path has been migrated and verified.

### B. Introduce a single location-aware internal posting primitive

The internal function should accept, at minimum:
- product and property identifiers,
- signed base-unit quantity,
- explicit location identifier (or a deliberately defined legacy/default-location resolution mode),
- reason and source type/id,
- stable source-line/idempotency key,
- optional recipe and unit-cost snapshot metadata.

It must:
1. lock the product row and validate product/property ownership;
2. validate the location belongs to the same property;
3. check the Stores module entitlement and the caller's permitted role/action using the canonical authorization helper, after verifying the helper's actual signature and role semantics;
4. return without movement for `track_stock = false`;
5. reject zero quantities and invalid units;
6. enforce the configured negative-stock policy against the correct balance(s), including the selected location when one is specified;
7. use a database uniqueness constraint for idempotency, not a prior SELECT alone;
8. write exactly one signed movement with `location_id`, source, source-line/idempotency, unit/base quantity and cost snapshot where known;
9. update location and aggregate balances exactly once in the same transaction;
10. return a stable result for a repeated idempotency key without applying the quantity again.

The aggregate is the sum across locations only where the product has been fully migrated to location-managed stock. Legacy/no-location products require an explicit, documented compatibility path. Do not silently mix the two models.

### C. Refactor writers before removing the trigger

Migrate in this order, preserving each public RPC signature where the frontend currently depends on it:
1. adjustments;
2. wastage;
3. inventory count approval (counted quantity must reconcile the selected location, not overwrite an unrelated location);
4. transfers (paired source/destination movements, one transfer-line identity, and no aggregate quantity change);
5. usage and production;
6. receiving / goods receipts;
7. POS recipe and direct-item consumption;
8. folio direct stock charges, refunds, voids and reversal paths;
9. minibar and any remaining stock writers.

For transfers, the aggregate should remain unchanged while the two location balances move. Record paired movements with the correct source and destination locations and a stable transfer-line key. Transfer completion must be idempotent.

For count approval, compare the count against the locked current quantity at that location. Do not trust a stale `expected_qty` snapshot without validating or explicitly preserving the count-session semantics.

### D. Trigger retirement and product initialization

Before dropping `products_sync_default_location`:
- identify and migrate every function and application path that changes `products.current_stock`;
- identify product creation/import paths that seed initial stock;
- ensure legacy products without a location row are handled deterministically;
- run reconciliation proving aggregate = sum of location balances for all location-managed products;
- run regression tests for all stock writers.

Do not drop the trigger as an isolated fix. Do not backfill or rewrite live quantities as part of this migration without an approved physical stocktake/reconciliation plan.

### E. Security hardening is a separate, sequenced gate

After confirming every UI workflow uses the intended RPCs:
- revoke authenticated direct INSERT/UPDATE/DELETE on `product_stock_locations`;
- make `stock_movements` append-only for application roles (no UPDATE/DELETE);
- restrict product stock-column updates so ordinary product/menu edits cannot mutate `current_stock`;
- enforce authorization inside every SECURITY DEFINER stock RPC, not just in the UI;
- keep read access scoped to the caller's property and Store entitlement.

Do not revoke access before confirming that no live screen depends on direct table writes.

## Required regression matrix (non-production database only)

### Location and aggregate invariants
- inbound and outbound at default and non-default locations;
- two locations for the same product;
- aggregate equals sum of location quantities for migrated products;
- transfer moves quantity between locations without changing aggregate;
- no duplicate default-location delta;
- concurrent postings to the same product/location.

### Business operations
- adjustment, wastage, count approval, transfer, GRN receiving;
- stock usage and production;
- POS direct tracked product and recipe ingredient;
- open bill and KOT do not deduct;
- settled/issued POS deducts once;
- POS room charge does not deduct again at checkout;
- direct folio stock charge deducts once;
- refund/void reverses the original movement, not today's recipe;
- physical restock occurs only when the item is actually returned;
- untracked products and missing Stores entitlement do not block non-stock POS/folio operations.

### Security and reliability
- unauthorized member, wrong property, wrong location, and insufficient role;
- no Stores entitlement;
- duplicate idempotency key;
- concurrent duplicate POS/transfer submissions;
- authenticated direct DML denied after cutover;
- ledger UPDATE/DELETE denied;
- transaction rollback leaves all three records/balances unchanged.

## Existing live anomaly — do not auto-correct

The read-only reconciliation found one product whose aggregate and ledger do not agree (aggregate 9, ledger-derived -1; difference +10). It was deliberately left unchanged. A physical stocktake and an approved adjustment are required before any correction.

## Deployment gate

The existing Supabase preview branch is `MIGRATIONS_FAILED` and is not a valid test environment. The production database must not be used for runtime regression tests. No executable migration should be added under `supabase/migrations/`, applied to production, or treated as ready until:
1. a valid production-equivalent disposable test database is available;
2. schema parity is established;
3. this regression matrix passes;
4. the migration is reviewed against the live function signatures and all frontend call sites;
5. rollback/forward-recovery steps are documented.

This blueprint records the implementation path only. It does not change database schema, stock quantities, application behavior, or production security policies.
