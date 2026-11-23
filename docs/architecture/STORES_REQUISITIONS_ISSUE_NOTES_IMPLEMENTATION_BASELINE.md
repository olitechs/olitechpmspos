# Stores requisitions and issue notes — implementation baseline

**Status:** Phase 1 approved baseline; Phase 7.1 wastage migration passed isolated PostgreSQL runtime tests; full production-equivalent parity and remaining stock-writer migration are still gated.  
**Merged to:** `main` via PRs #209 and #210  
**Production changes:** None

## Adopted defaults

This baseline records the recommended defaults accepted by the user's instruction to proceed. They are implementation defaults, not a claim that the workflows are already deployed.

1. Kitchen and Bar requests originate from F&B/POS.
2. Housekeeping and Maintenance requests originate from Front Office.
3. Stores owns approval, picking and physical issue.
4. Department/location stock remains visible by stock location. When stock is issued for consumption, the issue is posted to the selected cost centre/department.
5. Requester and approver must be different identities. Issuer and receiver must also be different identities by default. Property administrators may configure the control, but cannot bypass tenant or permission checks.
6. Composite menu products are excluded from ordinary requisitions. Only directly tracked inventory products may be requested.
7. Existing pending transfers are preserved unchanged.
8. Existing `store_manager` assignments and permissions remain compatible. A distinct Storekeeper role is introduced additively; no existing employee is silently reassigned.

## Production evidence requiring the first fix

The live schema already contains `products`, `stock_movements`, `inventory_locations`, `product_stock_locations`, inventory counts, adjustments, wastage, transfers, GRNs and recipes. The Phase 1 unit/conversion foundation and movement provenance columns are already applied.

The current `products_sync_default_location` trigger updates the product's default location whenever `products.current_stock` changes. Existing adjustment, wastage and count-approval RPCs also mutate an explicitly selected location before calling `fn_apply_stock_movement`. The trigger can therefore apply the same aggregate delta to the default location as well. Aggregate totals can appear correct while location distribution is wrong.

The current `fn_apply_stock_movement` does not accept a location, idempotency key or source-line identity. Existing transfer completion directly mutates location balances and inserts movement rows without the full provenance fields. This must be addressed before new issue-note or dispatch/receipt workflows can safely post stock.

## Phase 1A candidate revalidation — 22 November 2026

The existing draft `docs/audit/drafts/LOCATION_AWARE_ADJUSTMENT_WASTAGE_COUNT_CANDIDATE_20261115.sql` must **not** be promoted unchanged.

1. **It conflicts with the newer wastage approval design.** The candidate recreates `fn_post_wastage` and grants authenticated execution. The repository's later `20261120130000_phase7_1_wastage_approval_workflow.sql` instead deprecates that endpoint and uses `fn_submit_inventory_wastage` plus `fn_decide_inventory_wastage`, with a separate approval permission and self-decision prevention. The current `inventoryService.js` calls the submit/decide workflow. Replaying the older candidate would reopen a direct-posting path around that approval control.
2. **Its adjustment retry contract is incomplete for the current client.** The candidate accepts an optional request key and generates a fresh `legacy:<uuid>` key when omitted. The current adjustment client sends no request key. Retrying the same old client request would therefore create another adjustment rather than return the first result. The client and RPC need a stable request key before relying on retry idempotency.
3. **It is not a complete stock-writer cutover.** The candidate explicitly leaves POS, GRN, production, transfers, recipe consumption, product import/upsert and generic stock usage on their existing paths. It cannot by itself establish one authoritative stock writer or justify removing the default-location trigger.
4. **Its original tests are not runtime proof.** `tools/inventory/phase3-location-aware-posting.contract.test.mjs` is a source-contract test. `supabase/tests/phase3_location_aware_posting_runtime_regression.sql` is a rollback-only psql script requiring a production-equivalent fixture. A separate Phase 7.1 PostgreSQL 15 CI fixture now applies the real wastage migration and exercises its core transaction/permission/stock invariants; it does not yet validate the wider adjustment/count/POS/GRN/transfer writer set or the full production RLS and authorization catalog.
5. **The candidate intentionally fails closed on unreconciled products.** Its projection helper compares the movement ledger with `products.current_stock` and the location projection. This is preferable to silently repairing the known pre-existing ledger mismatch, but that product will remain blocked until a physical stocktake and approved reconciliation.

### Phase 7.1 isolated runtime gate — 22 November 2026

PR [#210](https://github.com/olitechs/olitechpmspos/pull/210) is merged to `main`. Its GitHub Actions PostgreSQL 15 job successfully applied the actual `20261120130000_phase7_1_wastage_approval_workflow.sql` migration to a disposable fixture and passed the runtime assertions for request idempotency, no deduction on submission, self-approval denial, separate approver authorization, selected non-default location posting, aggregate/ledger/location reconciliation, rejection without deduction, permission denial, cross-property rejection, insufficient-stock rollback, and legacy direct-post revocation.

The fixture uses stubbed property-membership, package-entitlement and employee-permission helpers. It is a meaningful PostgreSQL execution test, but it is **not** a complete production clone and does not validate every real RLS policy, staff-role lookup, or interaction with all live stock writers. It therefore does not authorize production application of the migration by itself.

A read-only comparison of the live `fn_employee_permission_codes` definition with the migration's replacement found the same role-resolution structure; the migration adds the two new wastage permissions to the legacy `store_manager` fallback. No production function was changed by this comparison.

### Production/repository parity check

The production migration ledger read on 22 November 2026 did not list `20261120130000_phase7_1_wastage_approval_workflow` or `20261120140000_phase8_atomic_inventory_production`. A read-only production function probe also found the exact current submit/decide wastage RPC signatures absent, while the legacy `fn_post_wastage` signature still exists. Therefore the newer repository wastage workflow is **not confirmed deployed to production**. Do not assume the main-branch UI/API and production database are in parity; reconcile and test this separately before claiming the new approval workflow is live.

### Live production preflight — 22 November 2026

A read-only catalog and migration-ledger preflight was run against the linked production project. Results:

| Check | Live result |
|---|---|
| Migration version `20261120130000` recorded | Missing |
| `fn_submit_inventory_wastage` | Missing |
| `fn_decide_inventory_wastage` | Missing |
| Legacy `fn_post_wastage` | Present and still executable by `authenticated` |
| `inventory_wastage.status` and approval/idempotency columns | Missing |
| `stock_internal.location_posting_context` | Missing |
| Wastage direct table DML | Still granted to `authenticated` |
| Wastage submit/approve permission codes | Missing |
| `products_sync_default_location` trigger | Enabled |

The read-only repeatable check is committed at `supabase/tests/phase7_1_wastage_production_parity_preflight.sql`. It returns a pass/fail row for each migration, RPC, column, grant, permission-seed and trigger expectation. Its source contract is included in `npm run test:architecture`.

**Current impact:** the main-branch inventory client uses the new wastage submission/decision RPCs, while the live database still exposes the legacy direct-post RPC. Wastage request/approval actions are therefore not confirmed operational in production and may return a missing-function error. Do not work around this by restoring direct stock posting from the client.

No production DDL or stock mutation was performed during this check.

### Expanded live stock-writer census — 22 November 2026

A second read-only production pass inspected the live function bodies, trigger definitions, table columns and aggregate projections. It did not execute DDL/DML or change stock.

**Balance reconciliation (separate invariants):**

| Check | Live result |
|---|---:|
| Products inspected | 942 |
| Product rows with aggregate different from sum of location rows | 2 |
| Product rows with aggregate different from movement-ledger signed total | 1 |
| Total absolute aggregate/ledger difference | 10.00 units |
| Location projection rows | 944 |
| Movement rows | 49 |
| Movement rows without `location_id` | 49 |
| Movement rows without `idempotency_key` | 49 |
| Outbound movement rows without `source_id` | 10 |

The two aggregate/location exceptions are not assumed to be the same as the separate aggregate/ledger exception. These are different reconciliation checks and must remain separately tracked. Product names and identifiers are intentionally omitted from this repository document; the live data requires a controlled physical verification and approved reconciliation.

**Confirmed posting paths requiring migration or an explicit compatibility decision:**

- `fn_apply_stock_movement` locks the product, updates `products.current_stock` and inserts `stock_movements`, but does not post to a specified location or populate location/idempotency/source-line metadata. Its product update fires `products_sync_default_location`.
- `fn_post_stock_adjustment`, `fn_post_wastage` and `fn_approve_inventory_count` write selected location balances and then invoke the aggregate writer. These paths retain the double-application/misallocation risk.
- `fn_complete_stock_transfer` directly decrements/increments location projections and inserts paired movement rows. It does not update the aggregate (which is correct for a pure internal transfer), but the movements lack location and source-line/idempotency provenance.
- `fn_bulk_upsert_store_products` and `fn_upsert_pos_menu_item` can change aggregate stock during product upsert; these are stock writers too, not merely catalogue edits.
- `fn_receive_purchase_order`, `fn_create_and_receive_purchase`, `fn_post_production`, `fn_record_stock_usage`, `fn_post_minibar_consumption`, POS sale/recipe paths and related reversal paths also participate in stock changes and need to be included in the call-path inventory before trigger retirement.

**Precision note:** `products.current_stock` and `product_stock_locations.qty` are currently `numeric(14,2)`, while `stock_movements.base_qty` is `numeric(20,6)`. The target writer must define base-unit rounding and conversion semantics explicitly; adding six-decimal ledger values alone does not make the location projection six-decimal accurate.

**Implementation consequence:** do not deploy a location-aware adjustment/count patch in isolation, and do not remove the default-location trigger yet. The writer cutover must include product upserts and all purchase/POS/production/usage/transfer paths, plus tests for both reconciliation invariants. The live production data remains unchanged.

### Revised Phase 1A order

- Preserve the wastage submit/approve/reject contract; migrate the approved decision path to the location-aware writer rather than restoring the old direct-post RPC.
- Add stable request keys to the adjustment client before enabling the new adjustment RPC contract. Preserve a deliberate compatibility path for old clients during rollout.
- Refactor count creation/approval with stable request identity and snapshot semantics, then validate intervening movements and concurrent approval.
- Inventory every remaining stock writer (POS direct product and recipe consumption, GRN, production, transfers, minibar/usage, product import/upsert, adjustments, wastage and counts). Migrate each to the agreed posting owner or a tested paired-transfer owner before changing the trigger.
- Keep the existing default-location trigger enabled until the full writer inventory is migrated and regression-tested.
- Reconcile repository migrations against the live production catalog and migration ledger; do not infer deployment from a file existing on `main`.

## Implementation sequence

### Phase 1A — authoritative stock posting

- Define and document the invariant: `products.current_stock` is the aggregate across active stock locations.
- Introduce one internal, transaction-scoped posting owner for product aggregate, selected location projection and immutable `stock_movements` row.
- Support location, base-unit quantity, source document/line, idempotency key, actor, reason and optional movement-time unit cost.
- Validate product and location tenant ownership, stock tracking, unit compatibility and negative-stock policy.
- Preserve compatibility with legacy callers while they are migrated.
- Refactor adjustment, wastage, count approval, usage and GRN receipt before changing/removing the default-location trigger.
- Refactor transfer posting as paired location movements that do not change aggregate stock.
- Only after all quantity writers are migrated: remove the default-location trigger's quantity mutation behavior and revoke direct client writes to stock projections and movement rows.

### Phase 1B — requisitions and issue notes

- Add property-scoped cost centres and department/location mappings.
- Add requisition headers/lines with draft, submitted, approved, partially issued, issued, rejected and cancelled lifecycle.
- Add issue-note headers/lines with requested, approved, issued and received quantities.
- Support partial issues, receiver confirmation, shortages, substitutions only when authorised, and reversal documents instead of editing posted issues.
- Require distinct requester/approver and issuer/receiver identities by default.
- Keep every stock posting linked to a source document and source line with idempotency protection.
- Exclude composite menu products from requestable stock.

### Phase 1C — transfer lifecycle

- Extend transfer lifecycle with dispatched/in-transit/partially received/received states.
- Dispatch moves stock from source location into a virtual in-transit location.
- Receipt moves confirmed quantities from in-transit to destination.
- Discrepancies remain visible and require an authorised resolution; never silently adjust quantities.
- Preserve all legacy pending/completed/cancelled rows and their historical meaning.

### Phase 1D — roles and navigation

- Add a distinct Storekeeper role without rewriting existing Store Manager assignments.
- Add granular permission codes for requisition create/approve, issue, receive, dispatch, transfer receipt, cost view and cost-centre administration.
- Enforce all permissions and package entitlements inside SECURITY DEFINER RPCs, not only in the UI.
- Add one navigation registry entry per screen and preserve current routes as compatible wrappers.

## Required validation before production

The earlier live-stock continuation explicitly records that the existing development database branch is not a valid fixture and that the runtime SQL regression suite must not run against production. Do not bypass this gate.

Required tests include:

- Positive and negative stock movements against default and non-default locations.
- Aggregate equals sum of location quantities after every posted movement.
- Concurrent posting and repeated request idempotency.
- Insufficient aggregate and location stock under both negative-stock policies.
- Cross-property product/location/document rejection.
- Adjustment, wastage, count approval and GRN receipt round trips.
- POS sale, recipe consumption, void and refund compatibility.
- Transfer dispatch/receipt, partial receipt and discrepancy resolution.
- Requisition/issue segregation of duties and permission-denial cases.
- Cost fields hidden at the database boundary for users without cost permission.
- Existing pending transfer and existing Store Manager compatibility.

Production rollout is blocked until a disposable PostgreSQL/Supabase fixture is available and the migration plus rollback/recovery path pass the runtime suite. No paid Supabase branch is to be created without cost approval.

## Explicit non-actions

- Do not repair the one pre-existing aggregate-to-ledger mismatch without a physical stocktake.
- Do not rewrite historical migrations or mark them applied to hide drift.
- Do not directly update stock balances from browser code.
- Do not drop the default-location trigger until every writer has been migrated.
- Do not deploy schema changes to production merely because frontend CI passes.
