# Phase 2 — Forward-only inventory correction migration review plan

Status: **review design prepared; executable migration intentionally blocked pending a production-equivalent fixture**. This is not a SQL migration and must not be applied. The deployed function snapshots in this directory are forensic evidence only.

## Target migration contents

### 1. Preflight and fail-closed guards
- Assert exact live signatures, result types, RLS status, trigger names, required columns and constraint/index names for every target object.
- Assert the migration has not already been applied and do not rewrite old migration versions.
- Abort if unexpected overloads exist for `fn_apply_stock_movement`, `fn_record_pos_sale`, the stock adjustment/count/wastage/production/transfer RPCs, GRN receipt, recipe consumption or POS reversal.
- Assert source/target locations and product rows have no cross-property foreign references before changing posting ownership.
- Capture pre-change definitions/ACLs in release evidence.

### 2. Cost-field confidentiality
PostgreSQL RLS protects rows, not individual columns. Hiding `cost_price` in React is insufficient. The planned boundary is:
- Revoke table-level SELECT from `anon`/`authenticated` on `public.products`; grant authenticated SELECT only on explicitly approved non-cost columns.
- Remove all `select('*')` and other broad `products` reads from active `src/` paths, replacing them with explicit non-cost column lists.
- Gate `fn_inventory_valuation` and any valuation-summary endpoint using a database helper that checks property membership, active staff session/module and an explicit cost-view capability. Keep SECURITY DEFINER only with fixed `search_path`, explicit caller/property checks, and narrow EXECUTE grants.
- Keep product writes on authorized RPCs; prevent an unauthorized payload from changing cost values. Preserve existing costs when a caller is permitted to edit non-cost fields but lacks cost capability.
- Test all direct table, RPC, report, export and relationship/embed paths for cost disclosure before release.

### 3. Deny-by-default action authorization
Introduce a database capability helper with explicit actions (catalog write, cost read, usage, wastage, adjustment, count create/approve, purchase order, GRN receive, transfer complete, recipe write, POS sale/reversal, and report/export). It must:
- reject anonymous calls and non-members;
- enforce active property subscription/module and active staff session where staff PIN/session applies;
- map current role IDs (including `property_role`) to the action matrix instead of trusting UI flags;
- limit F&B manager writes to F&B where applicable;
- separate count creation from approval where the actor can be identified;
- deny cross-property products, locations, purchase orders, counts, transfers, recipes and receipts;
- make internal stock writer / recipe consumer / reversal helpers non-callable by API roles; expose only authorized business RPCs.

### 4. One owner for location + aggregate stock balances
- Define `products.current_stock` as the aggregate across the product's active inventory locations. Confirm current data invariant before applying.
- Remove the `products_sync_default_location` after-update delta trigger after the central writer is made the only balance owner. Add a narrowly scoped insert-time initialization path for new products only if needed.
- Extend the internal stock writer to accept an optional location and source key. In one transaction it locks product/location rows, checks negative stock at both aggregate and target-location level, changes the location projection exactly once, changes `products.current_stock` exactly once, and inserts one immutable movement row.
- Adjustments, count variances, wastage, usage, GRNs and production call the writer and must not separately update `product_stock_locations`.
- Transfers remain one atomic operation with paired location deltas and paired out/in movement rows; aggregate quantity is unchanged. Add source linkage to both sides.
- Reconcile `products.current_stock`, signed movement totals and sum of location quantities before and after each test.

### 5. Source idempotency and immutable posting
Add an additive `source_key` column to `stock_movements` and a partial unique index over the property/source key/product identity for non-null keys. The key must be stable per event line; not merely a timestamp or random value generated after a retry. Planned keys:
- POS receipt idempotency key + item ordinal/product, including recipe ingredient ordinal/product;
- GRN line ID;
- transfer ID + line ordinal + direction;
- adjustment ID;
- count ID + count-line ID;
- wastage ID;
- production ID + input/output line identity;
- stock usage source record ID;
- cashier adjustment/refund ID + receipt line for void/refund reversals.

Insert the source/audit row first when necessary to obtain its stable ID, then post movements in the same transaction. A retry must return the prior result or fail before any second balance delta. Do not permit client UPDATE/DELETE of posted movement rows or direct DML on `product_stock_locations`; corrections are compensating entries.

## Required regression gates before this draft becomes a migration

1. Reconstruct the relevant schema from reconciled committed SQL and the captured live definitions in a clean local or already-authorized disposable environment. Do not use the current `olitech-phase-0-disposable-test` as-is; its inventory RPC signatures differ and its advisor reports critical non-inventory issues.
2. Seed two properties, each with a product and default/non-default locations; create separate admin, inventory manager, department staff, cashier and report-only identities, including active staff sessions and subscription entitlements.
3. Run the catalog gate and runtime tests in `supabase/tests/phase2_inventory_security_regression.sql` and `supabase/tests/phase2_inventory_runtime_regression.sql`; extend runtime coverage for GRN retries, transfer completion, recipe consumption, POS idempotency, voids, partial refunds, count approval retries and role denials.
4. Confirm app changes for column-level SELECT work with all explicit product queries and nested relationships; run lint, typecheck, architecture tests, contrast checks and production build.
5. Run security and performance advisors against the disposable schema after the candidate migration. Review each new finding; unrelated historical advisor warnings remain separately tracked.
6. Have a second reviewer approve the final SQL and its source-key semantics.

## Forward-only rollout and recovery

- Never edit historical migration files or production migration ledger rows.
- Deploy only a new migration after the test gate passes; apply DDL transactionally where supported.
- Before production deployment, save the exact function definitions, grants, policies, trigger definitions and stock reconciliation output as a release artifact.
- After deployment, run read-only reconciliation plus canary role checks before re-enabling inventory writes.
- If the canary fails before the release is accepted, stop inventory writes and use a reviewed **forward repair** restoring the previous function behavior/ACLs. Do not reverse or delete posted movements; reconcile with compensating events if any legitimate stock transactions have occurred.
- Movement-time costing and the complete workbook remain a later phase, after security, source idempotency and balance tests pass.
