# Phase 2 — Inventory event and authorization contract

Status: **contract proposal based on committed SQL; not a runtime guarantee**. This document deliberately does not change schema or production behavior. Function bodies deployed live still need source/live reconciliation before any corrective migration is drafted.

## 1. One authoritative posting path per event

The authoritative quantity ledger is `public.stock_movements`; `public.products.current_stock` is its current balance projection/compatibility field. `product_stock_locations` is the location balance projection. The latter two must reconcile with the ledger at the same transaction boundary. The older `inventory_items` / `inventory_movements` pair is legacy and must not receive a second posting for events already represented in `stock_movements`.

| Business event | Single posting owner (target contract) | Ledger source key | Balance effect | Reversal/correction contract | Current source observation / risk |
|---|---|---|---|---|---|
| POS sale | `fn_record_pos_sale` delegates each tracked item once to `fn_apply_stock_movement` | `pos_sale` + receipt/order id (must be stable, not NULL) | Negative; reject insufficient stock | A void/refund calls `fn_reverse_pos_stock`; reversal must be idempotent and linked to original receipt + adjustment/refund id | Migration `20261008160000` rewrites direct product update + movement insert to the shared function, but its replacement currently supplies a NULL source id. Fix only after receipt ID semantics are reconciled. |
| Recipe consumption caused by a POS sale | Exactly one owner: either POS sale expands recipe ingredients **or** `fn_consume_recipe_stock` posts them; never both | `pos_recipe` + stable POS receipt/order id | Negative ingredient quantities | Reverse only the ingredient movements belonging to the original receipt; partial refunds reverse the proportional recipe quantity under an explicit policy | Current `fn_consume_recipe_stock` posts each ingredient through `fn_apply_stock_movement` and also writes `stock_usage` (usage is audit/department data, not a second quantity ledger). Verify whether the POS sale function independently consumes recipes. |
| Standalone/manual recipe consumption | `fn_consume_recipe_stock` | Unique usage/production operation id | Negative ingredient quantities | Compensating movement linked to original operation; retries must not double consume | Current signature accepts a reference string but uses NULL `source_id`; duplicate-call protection is not established. |
| Goods receipt (GRN) / partial PO receipt | `fn_receive_purchase_order` owns GRN creation and invokes `fn_apply_stock_movement` once per received line | `purchase` + GRN id; each line needs a stable unique line/source key | Positive received quantity only | Do not delete/overwrite receipt; correct with supplier return/reversal movement referencing GRN and reason | Committed SQL prevents over-receiving and supports partial receipts. Movement idempotency per GRN line must be tested; retry after a committed response loss is a risk if the same received payload can be posted again. |
| Stock transfer | `fn_complete_stock_transfer` owns both paired movement entries atomically | `transfer_out` and `transfer_in` + transfer id and line id | Source location decreases; destination increases; property total unchanged | Transfer can be cancelled only before posting; after posting use paired compensating transfer movements | Older transfer implementations directly insert movement rows. Verify one completion per transfer and location deltas; do not additionally call a second posting helper for the same transfer. |
| Manual stock adjustment | `fn_post_stock_adjustment` is the only owner; it calls the shared ledger writer once and owns location balance updates | `manual_adjustment` + adjustment id | Signed delta at exactly the requested location; global balance changes by the same delta | Never edit/delete posted ledger rows; add a compensating adjustment linked to the original | Current location path may update the selected location and then trigger a second default-location delta through `products.current_stock`. This is a known balance correctness defect to fix after invariant/test setup. |
| Inventory count variance | `fn_approve_inventory_count` owns approval, variance calculation and posting once per count line | `inventory_count` + count id/line id | Counted minus expected at that location | Approval is one-way/idempotent; reopen/correction requires a new count or explicit compensating adjustment | Current implementation writes counted location quantity and calls shared movement path; the default-location sync trigger may double-apply or misplace the variance. Approval needs a locked status transition and duplicate-approval test. |
| Wastage | `fn_post_wastage` owns the wastage record and one negative ledger movement | `wastage` + wastage id | Negative at selected location | Correction through compensating stock movement; do not delete posted event | Confirm whether deployed RPC writes through shared helper and captures location consistently. |
| Production / batch output | `fn_post_production` owns one set of ingredient issues and one output receipt | `production` + production id and line ids | Inputs negative; output positive; atomic transaction | Reverse the whole batch via linked compensating movements | Must not post ingredients again through recipe consumption after production posting. Confirm each line has source linkage and retry protection. |
| POS void | Existing receipt-void RPC owns financial status transition and calls `fn_reverse_pos_stock` once | `pos_void` + cashier adjustment/void id, linked to original receipt | Restore the stock for a full void of a posted sale | Only a posted receipt can be voided; status transition + stock reversal in one transaction; reject second void | Migration `20261008103000` and later cashier hardening call stock reversal. Verify one-time receipt lock and idempotency. |
| POS refund | Existing approved-refund RPC owns financial refund and calls `fn_reverse_pos_stock` with approved ratio | `pos_refund` + refund/adjustment id, linked to original receipt | Restore only the approved returned proportion; policy must distinguish physical return vs money-only refund | Enforce cumulative refunds <= refundable quantity/value and prevent duplicate adjustment posting | Current source uses `amount / total`; this is only valid if the product-return policy is explicitly proportional. Money-only refunds must not restock items. |
| Direct stock usage (housekeeping/laundry/bar etc.) | `fn_record_stock_usage` owns one negative movement and one `stock_usage` record | `stock_usage` id | Negative at selected location | Correct with compensating usage/movement, not deletion | `stock_usage` is a secondary operational log; it must not independently change balance. Department list should be configurable later, after this contract is secured. |
| Product import/opening balance | A single import/opening operation invokes the shared posting path for quantity deltas; metadata-only edits do not post stock | import batch id + product line id | Delta from previous on-hand quantity, not full quantity on every re-import | Idempotent by import batch/line; correction is a new import adjustment | Bulk upsert currently can reconcile stock; establish whether imported stock means target balance or additive quantity before changing behavior. |

### Non-negotiable ledger invariants

1. One committed business event produces one net quantity delta per product/location and a linked set of immutable `stock_movements` rows.
2. All balance changes, ledger writes, source status transitions and source links commit or roll back together.
3. `products.current_stock` must be explicitly defined as either (a) aggregate across all active locations or (b) compatibility balance for a documented default location. Do not mix the two meanings. Proposed target: **aggregate across locations**, with location balances summing to the aggregate; legacy rows without a location need a documented migration/backfill rule.
4. A supplied `location_id` is authoritative. No trigger may infer the default location and apply the same delta again.
5. Every retryable event has a unique source key and database-enforced uniqueness or a locked one-way source status transition. NULL source IDs are not sufficient idempotency.
6. Never UPDATE/DELETE posted movements to correct them. Use linked compensating entries and retain the original actor, event, and reason.
7. A transfer preserves property-wide quantity; only location balances change. A refund changes stock only when the goods-return policy says inventory physically returned.
8. `stock_usage`, GRN lines, count lines, transfer records, and POS receipt items are source/audit records; none may be an independent second quantity posting path.

## 2. Staff role/action matrix (deny by default)

The role names below are logical capabilities, not assumptions that every label is already represented identically in the live staff-role enum. Before coding, map them to actual role identifiers and `can_store_write` / `fn_staff_module_access` semantics from the reconciled live definitions.

| Capability | Property admin / owner | Inventory or store manager | Department/store staff | POS cashier | Auditor / report viewer |
|---|---:|---:|---:|---:|---:|
| Read product identity, SKU, on-hand quantities | Allow in assigned property | Allow in assigned property | Allow only assigned module/category/location | Menu-required fields only | Allow if inventory-report entitlement |
| Read `cost_price`, unit costs, stock valuation | Allow | Allow only with explicit inventory-cost entitlement | Deny by default | Deny | Allow only with explicit cost-report entitlement |
| Create/edit product catalogue | Allow | Allow with inventory write entitlement | Category-limited only if policy explicitly grants | Deny | Deny |
| Record routine usage / wastage | Allow | Allow | Allow for assigned department/location and permitted category | Deny (sale path owns POS deductions) | Deny |
| Create adjustment | Allow | Allow; reason mandatory | Deny unless explicitly delegated | Deny | Deny |
| Approve adjustment / count variance | Allow, with audit trail | Allow only if not creator where separation-of-duties is enabled | Deny | Deny | Deny |
| Create inventory count | Allow | Allow | Allow count capture for assigned location, no approval | Deny | Deny |
| Approve inventory count | Allow | Allow if independent from count creator | Deny | Deny | Deny |
| Create purchase order | Allow | Allow | Deny unless purchasing capability assigned | Deny | Deny |
| Receive/partially receive GRN | Allow | Allow with receiving entitlement | Deny unless receiving capability assigned | Deny | Deny |
| Create/complete stock transfer | Allow | Allow with transfer entitlement; source/destination property scope enforced | Capture request only unless explicitly authorized | Deny | Deny |
| Create/edit recipes | Allow | Allow with recipe entitlement | Deny | Read-only consumption is through sale posting path | Deny |
| POS sale stock posting | Authorized POS workflow only | Not via inventory RPC directly | Not via inventory RPC directly | Allow through receipt/sale RPC and active shift/session | Deny |
| Void / refund | Approval/financial policy required | Not by inventory role alone | Deny | Request only or approve within cashier policy; never call stock reversal directly | Deny |
| Export quantity movement history | Allow | Allow | Assigned department/category only | Deny | Allow with report entitlement |
| Export costs/valuation | Allow | Explicit cost entitlement | Deny | Deny | Explicit cost-report entitlement |
| Cross-property read or write | Deny except trusted platform support workflow | Deny | Deny | Deny | Deny |

Authorization must be enforced in the database/RPC, not only by hiding UI controls. For every write RPC check: authenticated caller, property membership/owner, active staff session and role (where applicable), subscription module entitlement, action-specific capability, product/category/location ownership within the same property, and approval separation. A platform-owner bypass must be explicit and audited, not a general membership substitute.

## 3. Regression-test contract

Tests must run against a disposable/local database that matches the relevant production schema, using two properties (A and B), and separate users for property admin, inventory manager, department staff, cashier, and report-only role. Never use production fixtures or commit credentials.

### Cost visibility and tenant isolation
- A manager with cost entitlement can read product cost and valuation only in property A.
- A department user without cost entitlement cannot obtain `cost_price` via direct `products` select, a view, `fn_inventory_valuation`, `fn_inventory_valuation_summary`, export RPC, or another RPC response.
- Property A user cannot read or mutate property B products, receipts, GRNs, locations, counts, transfers, or movement history by guessing UUIDs.
- A user cannot pass a property A ID with a property B product/location/source ID to any mutation RPC.
- Anonymous callers cannot execute internal inventory mutation RPCs.
- An authenticated property member without the required action role/module cannot execute a SECURITY DEFINER write RPC directly.

### Ledger and balance correctness
- Shared movement helper rejects insufficient stock and leaves both ledger and balance unchanged on error.
- POS sale deducts each tracked product/recipe ingredient once; replay of the same receipt/event does not deduct again.
- Partial GRN adds exactly the received quantity, does not exceed the PO remainder, and replay does not duplicate the receipt movement.
- Transfer posts one source-out and one destination-in; property aggregate is unchanged; completion retry is a no-op/rejected.
- Adjustment at a non-default location changes only that location and aggregate once; default-location adjustment is also applied once.
- Count variance is posted once; retry/double approval does not reapply variance.
- Full void restores the original sale quantity once; partial refund restores only physically returned quantities under policy; cumulative/duplicate refund is rejected.
- Recipe usage, direct usage, wastage and production each post once and preserve the source ID on movement rows.
- All event changes roll back atomically if any line fails.
- Posted movement UPDATE/DELETE remains denied; correction requires compensating movement.

## 4. Migration provenance gate

No forward-only migration may be authored as a fix until the committed source and live catalog are reconciled for:
- migration version/name and duplicate numeric/timestamp prefixes;
- the exact function body/signature and SECURITY DEFINER/INVOKER mode;
- function EXECUTE grants by role;
- table RLS enabled state, grants, policies, and permissive-policy interactions;
- triggers and trigger order, especially `products_sync_default_location`;
- constraints/indexes required for source-event idempotency;
- current quantity totals across `stock_movements`, `products.current_stock`, and `product_stock_locations`.

The live migration ledger has no SQL checksum, so a name/version match alone is not proof. Preserve all historical filenames and ledger rows. Record discrepancies; create only a new forward migration after a local/disposable reproduction, repeatable tests, advisor review, and an explicit rollback/recovery plan.

## 5. Sequenced implementation plan

1. **This contract:** event ownership, role/action capabilities, and test cases.
2. Build the two-property test fixtures and source/live migration reconciliation report.
3. Implement database-enforced cost visibility and action checks, plus location balance correction and event idempotency in a reviewed forward-only migration.
4. Run database regression tests and app lint/typecheck/architecture tests/build; inspect Supabase advisors.
5. Only after passing those gates, add movement-time costing, then daily/weekly/monthly workbook/reporting.
