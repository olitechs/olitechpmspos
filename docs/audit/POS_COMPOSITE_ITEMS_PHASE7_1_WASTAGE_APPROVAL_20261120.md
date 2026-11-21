# POS Composite Items — Phase 7.1 Wastage Approval Workflow

**Date:** 2026-11-20  
**Branch:** `feat/pos-composite-items-phase1-audit`  
**Migration:** `20261120130000_phase7_1_wastage_approval_workflow.sql`

## Delivered on the feature branch

- Added distinct sensitive permissions:
  - `stores.stock.wastage.submit`
  - `stores.stock.wastage.approve`
- Added both permissions to the client permission catalog and the built-in legacy `store_manager` permission set. Custom property roles can assign the two permissions independently.
- Replaced the one-step wastage screen action with a pending request workflow.
- Added `fn_submit_inventory_wastage`: property-scoped, entitlement-checked, employee-permission-checked, tracked-product-only, quantity/reason validated, request-key idempotent, and no stock change at submission.
- Added `fn_decide_inventory_wastage`: requires the separate approval permission; rejects self-decisions; requires a reason for rejection; locks the request; makes repeat decisions idempotent; prevents a conflicting second decision.
- Approval posts one negative stock movement linked to the wastage request. Rejection leaves stock unchanged.
- The old `fn_post_wastage` endpoint now raises a deprecation error and has its authenticated execution revoked, preventing stale clients from bypassing approval.
- Removed direct authenticated INSERT/UPDATE/DELETE access to `inventory_wastage`; reads remain governed by existing RLS.
- Added the location-aware posting context and helper functions from the prior reviewed candidate design. The existing default-location trigger remains installed. A private transaction marker makes the trigger skip only the matching aggregate delta when the trusted writer already updates the selected location. If the trigger fails to consume the marker, the transaction aborts.

## Workflow

1. A staff member with `stores.stock.wastage.submit` creates a request.
2. The request is visible as pending; no stock is deducted.
3. A different staff member with `stores.stock.wastage.approve` approves or rejects it.
4. Approval posts the location-specific stock reduction and a `stock_movements` row with `source_type='wastage'`, `source_id=inventory_wastage.id`, and a stable source-line key.
5. Rejection records the decision and reason without posting stock.

The legacy `store_manager` fallback receives both permissions. Because self-approval is blocked, the same manager cannot submit and approve the same request. Custom roles should normally split submit and approve across storekeepers and managers.

## Live read-only reconciliation snapshot

The production project currently has 941 tracked products. A read-only reconciliation query found two products whose aggregate, movement-ledger, or location balances do not agree:

- **Aperol:** aggregate stock 0, movement ledger 0, location balance 20.
- **Dawa Coctail:** aggregate stock 0, movement ledger -10, location balance 0.

The location-aware helper deliberately fails closed for a product whose ledger or location projection does not reconcile. These two products therefore need a verified stocktake/reconciliation before wastage approval can post against them. This is a product-level block, not a property-wide block. No balances were changed by the inspection.

## Tests and release gate

- Added `tools/inventory/phase7_1-wastage-approval.contract.test.mjs` to the architecture test command.
- Static contract coverage checks separate permissions, old-endpoint deprecation, self-approval prevention, movement linkage, location trigger context and UI/API wiring.
- These are source-contract checks only. They do not prove PostgreSQL execution, RLS, trigger behavior, concurrent approval or rollback.
- The migration has **not** been applied to production. No production schema or stock data was changed.
- Before merge, apply the migration on an isolated production-equivalent PostgreSQL database and test: permission denial; custom role grants; cross-property IDs; self-approval; duplicate request retries; concurrent approval; reject without stock change; approval rollback on insufficient location stock; default and non-default location posting; movement linkage; trigger context cleanup; and the two known reconciliation exceptions.
- Reconcile the two existing product balance discrepancies through an authorized stocktake; do not silently rewrite balances as part of this feature.

## Scope boundary

This phase implements wastage requests and inventory posting only. It does not issue financial refunds, modify receipt totals, or implement production/assembly. Existing composite sale and reversal migrations remain separate and unapplied.
