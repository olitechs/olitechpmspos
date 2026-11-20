# POS Composite Items — Phase 8 Atomic Production / Assembly

**Date:** 2026-11-20  
**Migration:** `20261120140000_phase8_atomic_inventory_production.sql`  
**Depends on:** Phase 2 composite product definitions, Phase 3 unit/cost snapshots, Phase 7.1 location-aware stock writer.

## Implemented on the feature branch

- Added sensitive `stores.production.post` to the database permission catalog and client permission catalog.
- Added the permission to legacy `store_manager` and `fb_manager` fallback roles. Custom roles can assign it independently.
- Added production request key and fingerprint fields, recipe version, immutable component snapshot, total component cost and output unit cost to `inventory_productions`.
- Added a unique property/request-key index.
- Replaced the old membership-only `fn_post_production` endpoint with a deprecation error and revoked authenticated execution.
- Added `fn_post_inventory_production`, which checks property membership, Stores entitlement and the dedicated production permission.
- Requires an active same-property recipe, positive yield, at least one valid component, same-property directly tracked component products and a directly tracked output product.
- Requires a product-linked recipe to produce its linked product. Composite POS menu recipes cannot be used to create direct stock output; use an unlinked production recipe or a direct-product-linked recipe.
- Locks the output product before the linked recipe (matching the recipe-editor lock order), locks recipe ingredient rows, then locks component products in deterministic product-ID order. A property-scoped advisory lock serializes manual production batches while each request key remains independently idempotent.
- Uses normalized recipe base-unit quantities and the saved component unit-cost snapshots from Phase 3.
- Creates the production record first inside the transaction, then posts each component deduction and output addition through the Phase 7.1 location-aware writer.
- Links every stock movement to the production record with stable component/output line keys. Movement unit costs are updated to the saved recipe component cost and calculated output unit cost.
- Records the recipe version and component quantities/units on the production row; stores cost snapshots separately in the private schema.
- Uses a transaction advisory lock, unique request key and payload fingerprint so retries return the original production row and key reuse with different details is rejected.
- Revokes direct authenticated INSERT/UPDATE/DELETE on `inventory_productions`.
- Updates the Inventory Operations Production panel and service to use the new RPC, gate posting by `stores.production.post`, and retain the request key if the call fails.

## Precision and location behavior

The shared location-aware writer now accepts stock changes to six decimal places. This is necessary because Phase 3 recipe quantities are normalized to six decimal places. The wastage request form still applies its own stricter two-decimal input validation.

Production currently resolves each component and output product to its configured default inventory location. The current UI and production schema do not define a batch-specific source or destination location; explicit location selection can be added as a separate workflow without changing this default-location behavior.

The location-aware writer validates that aggregate stock, stock movement ledger and location projection reconcile for each product. It fails closed for any product with a mismatch rather than silently creating a production batch from inconsistent balances.

## Validation boundary

- Added `tools/inventory/phase8-atomic-production.contract.test.mjs` to the architecture test command.
- The static contract tests cover permissions, old endpoint deprecation, direct-DML revocation, same-property/tracked product checks, recipe version and cost snapshots, idempotency, location-aware movement linkage and UI wiring.
- These tests do not prove live PostgreSQL transaction behavior.
- No production migration has been applied and no production stock or production records have been changed.
- Before merge, test on an isolated production-equivalent database: permission denial, role assignment, tenant isolation, empty recipe, cross-property component, untracked product, composite output rejection, linked recipe/output mismatch, retry idempotency, changed-payload key conflict, stock insufficiency rollback, multi-component lock ordering, default-location projection, movement source linkage, recipe edit concurrency, cost snapshots and full transaction rollback.

## Known data gate

Two products were identified in the Phase 7.1 read-only reconciliation snapshot with aggregate/ledger/location discrepancies. The new writer will block production for those products until an authorized stocktake/reconciliation resolves the mismatches. No automatic balance correction is performed.
