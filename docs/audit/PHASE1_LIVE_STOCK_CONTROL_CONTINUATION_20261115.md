# Phase 1 live stock-control continuation — 15 November 2026

Status: **foundation applied; location/security correction prepared for implementation; no further production DDL applied in this continuation.**

Project: `mszogmazldxjsiytrlxr` (`olitechs-pms-pos`)

## Confirmed live state

The additive foundation migration `20261115055500_phase1_stock_control_foundation.sql` is present in the production migration ledger. Read-only catalog checks confirmed:

- `inventory_units` and `inventory_unit_conversions` exist with the seeded standard units/conversions.
- `products.track_stock`, `products.stock_item_type`, and `products.base_unit` exist.
- `stock_movements` now has location, source-line/idempotency, unit/cost, recipe-version, and reversal-reference fields.
- `property_settings.negative_stock_policy` exists with default `warn_allow`.
- The current `fn_apply_stock_movement(uuid,numeric,text,text,uuid)` is SECURITY DEFINER and is not executable by authenticated directly.
- No negative product balances were found in the read-only check (850 products checked).
- Aggregate-to-ledger reconciliation currently has one pre-existing mismatch. Do not repair it without a physical count and approval.
- Aggregate-to-location reconciliation had zero mismatches at the time of the check.

## Confirmed location ownership defect

The live trigger `products_sync_default_location` fires AFTER UPDATE OF product rows (trigger is AFTER UPDATE generally, function checks whether `current_stock` changed). It adds the aggregate stock delta to the product's default location.

The following live RPCs also mutate `product_stock_locations` directly before/alongside calling `fn_apply_stock_movement`:

- `fn_post_stock_adjustment`: changes the requested location, then changes `products.current_stock`; the trigger applies the same delta to the default location.
- `fn_post_wastage`: same double-location application pattern.
- `fn_approve_inventory_count`: overwrites the counted location quantity, then posts the aggregate variance; the trigger applies the aggregate delta to the default location.
- `fn_complete_stock_transfer`: directly changes source and destination location quantities and inserts paired ledger rows, but does not update aggregate stock. Transfer movement rows also lack source identifiers and location metadata.

This means a non-default location adjustment or wastage can shift both the selected location and default location, while aggregate quantity changes once. Count approval can similarly misallocate the aggregate variance. The aggregate can still reconcile while the per-location distribution is wrong.

## Confirmed security gaps

Catalog checks show:

- `authenticated` has INSERT/UPDATE/DELETE table privileges on `product_stock_locations`, and property-member RLS policies allow direct writes.
- `authenticated` has broad write privileges on `products`; the table policy allows Store writes and POS menu management, so stock-related columns are not isolated from ordinary product updates.
- `stock_movements` has a SELECT policy and UPDATE policy in catalog metadata. Authenticated table privileges currently do not include INSERT/UPDATE/DELETE, but the UPDATE policy should be removed as part of the immutable-ledger hardening.
- The current `fn_apply_stock_movement` checks property membership/platform-owner, not action-specific Store entitlement or active staff-session capability.
- POS sale, recipe consumption, GRN, production, count, adjustment, wastage, transfer and minibar RPCs contain distinct authorization and idempotency gaps that must be reconciled individually before a unified capability gate is introduced.

## Required next migration design

Keep `stock_movements` as the only quantity ledger. Implement an internal writer that:

1. Locks the product and the target location row.
2. Validates property ownership of the product and location.
3. Applies the negative-stock policy to the aggregate and target location.
4. Changes the target location projection exactly once.
5. Changes `products.current_stock` exactly once.
6. Inserts exactly one immutable movement with location, source-line/idempotency key, unit and optional cost/recipe snapshot.
7. Does not allow a trigger to apply the same delta to the default location.
8. Keeps transfers atomic with paired location movement rows while leaving aggregate stock unchanged.

Refactor adjustments, counts, wastage, usage, GRN receipt, production and POS to use that posting owner. Remove the default-location AFTER UPDATE trigger only after all quantity writers have been migrated and a new-product initialization path is in place.

Then revoke direct authenticated DML on `product_stock_locations`; deny direct client stock edits on `products.current_stock`; remove movement UPDATE/DELETE policies; and add narrowly scoped, action-specific SECURITY DEFINER RPC authorization. Preserve catalog editing and POS menu workflows without granting those flows authority to change stock quantities.

## Validation boundary

The repository's `docs/audit/PHASE2_FORWARD_MIGRATION_REVIEW_PLAN.md` and SQL regression scripts require schema-parity and rollback-only runtime tests in a production-equivalent disposable database, and explicitly say not to run the runtime suite against production. The existing Supabase development branch was previously observed in `MIGRATIONS_FAILED` state and is not a valid fixture. No PostgreSQL/Docker runtime is available in the current local environment.

Therefore this continuation used read-only production catalog and reconciliation queries only. **No location, stock, movement, product, role, or policy data was modified by this continuation.** Do not apply the next writer/security migration until a valid test fixture or an explicitly reviewed alternative test gate is available.

## Next execution order

1. Reconstruct and test the central writer plus trigger transition.
2. Refactor adjustment, wastage, count, transfer and receiving RPCs.
3. Harden direct table writes and immutable ledger permissions.
4. Add capability checks and verify role/entitlement behavior.
5. Extend runtime tests for POS retries, GRN retries, transfers, count approvals, refunds, voids, recipe usage and cross-property denial.
6. Reconcile the existing one-product ledger mismatch only after a physical stocktake.
7. Run security/performance advisors and production canaries after the candidate passes the test gate.
