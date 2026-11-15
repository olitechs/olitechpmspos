# Location-Aware Posting — Adjustments, Wastage and Counts

Date: 2026-11-15  
Status: candidate SQL and application changes committed; **not applied to any database**.

## Deliverables

- Candidate SQL: `docs/audit/drafts/LOCATION_AWARE_ADJUSTMENT_WASTAGE_COUNT_CANDIDATE_20261115.sql`
- Runtime gate: `supabase/tests/phase3_location_aware_posting_runtime_regression.sql`
- Source contract: `tools/inventory/phase3-location-aware-posting.contract.test.mjs`
- Service RPC updates: `src/services/inventoryService.js`
- Inventory UI updates: `src/components/modules/InventoryOperations.jsx`
- The source contract is included in `npm run test:architecture`.

## Live behavior confirmed before drafting

Read-only production catalog inspection confirmed:

- `fn_post_stock_adjustment`, `fn_post_wastage` and `fn_approve_inventory_count` directly changed a selected location and then changed `products.current_stock`.
- The `products_sync_default_location` AFTER UPDATE trigger also applied the product aggregate delta to the default location.
- `fn_create_inventory_count` captured the selected location's current quantity but did not store the location on each count line.
- Authenticated users had direct INSERT/UPDATE/DELETE table privileges on `product_stock_locations`, `inventory_counts`, `inventory_count_lines`, `stock_adjustments` and `inventory_wastage`.
- The active Inventory Operations UI only reads count records directly; its write actions use the inventory RPCs. The count UI previously defaulted blank physical counts to the property-wide `products.current_stock`, not the selected location balance.
- The live movement types used for the current ledger projection are `in` and `out`.
- The live database currently has one product-level movement-ledger variance. No quantity was changed to repair it.

## Candidate design

### One location-aware posting owner

The candidate adds a non-exposed `stock_internal` schema with a transaction-scoped context table and private helper functions.

For each adjustment, wastage or count variance, the helper:

1. Locks the product row and validates property ownership and stock tracking.
2. Checks that the existing movement ledger reconciles to `products.current_stock`.
3. Ensures the product's default-location projection row exists and checks that all location balances reconcile to the aggregate.
4. Locks and updates exactly the selected location.
5. Adds a private transaction marker, then updates `products.current_stock`.
6. Relies on the existing default-location trigger to consume the marker and skip only the duplicate default-location delta for that update.
7. Inserts one movement with source ID, source-line key, location snapshot, unit and cost metadata, and a unique idempotency key.

The trigger remains installed and enabled. The candidate does not use a caller-controlled GUC to bypass it. Legacy aggregate-only writers still use the existing trigger path.

### Event behavior

- **Adjustment:** source record first, followed by one signed movement in the same transaction.
- **Wastage:** source record first, followed by one negative movement in the same transaction.
- **Count creation:** stores the resolved location on each count line and snapshots that location's expected quantity.
- **Count approval:** locks the count and lines, calculates the applied variance as counted quantity minus the original expected snapshot, applies that delta to the live location balance (so intervening sales/receipts are preserved), stores the delta in `inventory_count_lines.variance`, posts one movement per changed line, and makes approval one-way. Repeated approval returns the already-approved count without another movement.

### Authorization and direct writes

The four public Store operations require `can_store_write(property_id, NULL)` in addition to the property-membership check. The candidate revokes direct client DML on the five RPC-owned tables while retaining their read paths and service-role privileges.

The internal helper functions are not executable by anon, authenticated or service-role clients. They are called by the trusted SECURITY DEFINER wrappers.

### Retry compatibility

The new UI generates a request key and keeps it unchanged after a failed request, so retrying the same form submission returns the original source record. The database stores a payload fingerprint and rejects reuse of a key with different details.

For compatibility during rollout, `p_request_key` has a database default. An older frontend that omits it can still call the RPC, but receives a generated legacy key and does **not** get retry deduplication. The updated UI passes the key explicitly.

### Physical-count UI correction

The count screen now loads `product_stock_locations` for the selected location, displays that location's system quantity, and submits only tracked products for which the user entered a counted quantity. It no longer treats `products.current_stock` as the count for a single location.

## Deliberate limits and remaining risks

1. **Trigger stays.** POS, GRN, transfers, production, recipe consumption, manual usage and bulk product upsert have not yet been migrated to the location-aware helper. They must be migrated and regression-tested before the trigger can ever be retired.
2. **Product stock column ACL remains a separate P0.** This candidate revokes direct writes to location projections and the five operation records, but does not yet remove the broad authenticated update path on `products.current_stock`. That needs a separate compatible product-update/stock-column authorization phase.
3. **Known ledger discrepancy remains untouched.** The new helper refuses to post for a product whose movement ledger does not reconcile with its aggregate. The affected product needs a verified physical stocktake; no automatic repair is included.
4. **Location-level negative stock:** the existing non-negative `product_stock_locations.qty` constraint is preserved. A location-specific adjustment or wastage cannot overdraw its selected location, even when the property's aggregate policy is `warn_allow`. `warn_allow` remains available to aggregate-only legacy flows until those flows are migrated. The `block` policy also checks aggregate stock.
5. **Precision:** current product and location balance columns support two decimal places. The candidate validates two-decimal input rather than silently allowing movement/projection rounding differences. A wider precision migration is separate work.
6. **Retry persistence:** request keys live in the form state. They protect retries within the same form session, but are not yet persisted as an offline outbox across a browser reload.
7. **Existing direct product writes:** product metadata and `current_stock` are still on the same table. Do not claim the entire stock ledger is immutable or fully authoritative after this phase alone.

## Required validation before migration promotion

The current Supabase preview branch is migration-failed and is not a valid test target. No new project or branch was created.

The candidate must be promoted to `supabase/migrations/` only after a production-equivalent disposable database is available, the schema and grants are reconciled, and all of the following pass:

- Apply/replay the candidate on the disposable database.
- Run `node --test tools/inventory/phase3-location-aware-posting.contract.test.mjs`.
- Run the full `npm run test:architecture`.
- Run `supabase/tests/phase3_location_aware_posting_runtime_regression.sql` with the documented psql fixture variables and an authenticated user with an active Store-authorized session and Stores entitlement.
- Verify direct DML is denied, the trigger remains enabled, location and aggregate deltas occur once, request retries do not duplicate movements, and a legacy aggregate-only posting still syncs through the retained trigger.
- Run Supabase security and performance advisors and inspect any new findings.
- Verify existing POS, GRN, transfer, production, recipe and product-import paths still work.

The candidate is intentionally stored under `docs/audit/drafts/`, not `supabase/migrations/`, because the Supabase CLI is not available in this execution environment to create the migration with `supabase migration new`, and the required disposable-database gate is not yet available. Do not apply this SQL to production.

## Current deployment state

- Candidate SQL committed to `main`.
- Application service and UI changes committed to `main`.
- Contract and runtime test sources committed and integrated into the architecture suite.
- No production DDL, grants, trigger changes, RPC changes or stock quantities have been applied.
- Node test suite and PostgreSQL runtime suite have **not** been executed in a checked-out, production-equivalent environment.
