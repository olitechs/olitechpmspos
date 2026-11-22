# Stores requisitions and issue notes — implementation baseline

**Status:** Phase 1 approved baseline; implementation gated on stock-integrity regression tests  
**Branch:** `feat/stores-requisitions-issue-notes-phase1`  
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
