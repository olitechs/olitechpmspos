# Phase 1 — Inventory integrity execution baseline

Status: **in progress — read-only audit complete; implementation is gated on a reproducible schema fixture.**

Date: 2026-11-06

## Environment and cost boundary

- Use the already-running Supabase free-tier project `olitechs-pms-pos` (`mszogmazldxjsiytrlxr`) for read-only inspection only.
- Do not create a paid Supabase development branch or project.
- Do not apply migrations, execute write SQL, alter grants/policies/triggers, deploy Edge Functions, or change production data as part of this baseline.
- The connected main branch was reported as `MIGRATIONS_FAILED`; it is not an approved migration target.
- The existing free-tier project is not a safe substitute for an isolated test database. Production remains read-only until an isolated, reproducible fixture is available and an explicit production rollout approval is given.

## Protected scope — do not modify

The following functionality is explicitly excluded from this workstream:

- Printer service, printer configuration, device connectivity and routing
- Paper-feed behavior, margins, cutter commands and printer-specific formatting
- Order-ticket templates and printing
- Unsettled-bill receipts and paid receipts
- POS cashier/payment printing flows

Do not edit printer, ticket, receipt, bill or cashier-printing files or migrations while implementing inventory integrity. Any unrelated change that risks these paths must be split out and stopped for review.

## Live read-only observations

The connected free-tier database was inspected without writes.

| Check | Observed result |
|---|---:|
| Products | 850 |
| Stock movement rows | 2 |
| Product-location balance rows | 850 |
| Products with location/aggregate drift | 0 |
| Products with movement-ledger drift | 1 |
| Negative aggregate balances | 0 |
| Negative location balances | 0 |

One product has aggregate stock of 10 while its movement total is 0. Do not guess its opening balance or auto-correct it. Establish the product's stock history and opening-balance provenance before any reconciliation write.

The low movement-row count relative to product count is a provenance/coverage concern, not proof that all existing balances are wrong. Determine when movement capture began and whether opening balances were intentionally seeded outside the movement ledger.

## Confirmed risks to resolve

1. **Multiple balance owners:** migration `0064_sync_store_location_stock.sql` installs an after-update trigger on `products.current_stock` that changes the default location balance. Several inventory RPCs also update `product_stock_locations` directly, creating a risk of double or misdirected deltas.
2. **Direct location writes:** authenticated API roles have direct write access to `product_stock_locations` under the inspected grants/policies. This can bypass the movement ledger.
3. **Incomplete source linkage:** some callers of the shared movement writer pass null source identifiers. Retries therefore may not be consistently traceable or idempotent.
4. **Cost-field exposure risk:** `src/services/inventoryService.js` reads products with `select('*')` and masks `cost_price` only after the response reaches the browser. Client-side masking is not a database security boundary.
5. **Action-level authorization:** property membership checks and SECURITY DEFINER execute grants need function-by-function review; advisor warnings alone do not prove exploitability.
6. **Schema/provenance uncertainty:** the connected project's migration state and deployed signatures must be reconciled with committed migration history before a forward-only migration can be authored safely.

## Existing regression gates

The repository already contains:

- `supabase/tests/phase2_inventory_security_regression.sql`
- `supabase/tests/phase2_inventory_runtime_regression.sql`
- `docs/audit/PHASE2_FORWARD_MIGRATION_REVIEW_PLAN.md`

These are test/review artifacts, not proof that the current live schema passes. The runtime test requires two-property fixtures and a controlled authenticated identity. It must only run on a local or already-authorized disposable database.

## Implementation sequence

### A. Establish a reproducible test baseline

- Reconcile committed migrations, deployed migration ledger, current function signatures/bodies, triggers, table/column grants, RLS policies and constraints.
- Resolve the main branch's migration failure before treating any migration workflow as reliable.
- Build a clean local test database from reconciled source or obtain an already-authorized isolated fixture.
- Seed two properties, distinct roles, active staff sessions, products and default/non-default locations.
- Record the baseline reconciliation output and schema fingerprint.

**Gate:** no executable SQL migration until this baseline is reproducible and reviewed.

### B. Enforce one stock-balance owner

- Define the invariant for aggregate product stock and location projections.
- Centralize all location and aggregate deltas in one transactional writer.
- Remove duplicate location updates from business RPCs only after the shared writer is proven.
- Retire the aggregate-to-default-location trigger only in a reviewed forward migration after every caller has been migrated.
- Keep transfers atomic, with paired source-linked movements and no aggregate quantity change.

### C. Make postings traceable and retry-safe

- Add stable source identity at the originating event/line level.
- Make each posting idempotent under retries.
- Preserve immutable movement history; correct mistakes with compensating movements.
- Test POS, recipe consumption, GRN, transfer, adjustment, count, wastage, production, usage and reversal paths.

### D. Close direct-write and authorization bypasses

- Remove client direct DML on location balances and movement/source ledgers.
- Replace broad product reads with explicit non-cost projections where appropriate.
- Enforce cost visibility and action capabilities in database authorization, not UI role-name checks.
- Review each SECURITY DEFINER function's fixed search path, caller checks, property scoping and EXECUTE grants before changing any grants.

### E. Verify before rollout

- Run catalog security assertions and two-property runtime regression tests.
- Exercise positive/negative adjustments at default and non-default locations, count variance, transfer, GRN retry, recipe consumption, POS retries, voids and refunds.
- Confirm aggregate stock, location totals and signed movement totals reconcile.
- Run application build, lint, typecheck and relevant workflow regressions.
- Run Supabase security/performance advisors on the isolated candidate schema.
- Obtain a second review of migration SQL and source-key semantics.

Only after these gates pass should a new forward-only migration be proposed. Never edit applied historical migrations or manually rewrite the migration ledger.

## Current decision

Proceed with source/schema analysis and isolated-fixture preparation using free/local resources. Keep the connected free-tier database read-only. Do not merge or deploy an inventory migration until the test baseline and rollout gates above are satisfied.
