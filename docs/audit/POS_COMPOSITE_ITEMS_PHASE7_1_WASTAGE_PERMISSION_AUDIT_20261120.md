# POS Composite Items — Phase 7.1 Wastage Permission and Posting Audit

**Date:** 2026-11-20  
**Repository:** `olitechs/olitechpmspos`  
**Branch:** `feat/pos-composite-items-phase1-audit`  
**Production project:** `mszogmazldxjsiytrlxr`  
**Scope:** Read-only inspection of the live permission catalog, wastage RPC, stock ledger and product-location trigger. No production schema or data changes.

## Decision

Do not extend or expose the current wastage RPC as part of the composite-item release yet. The live implementation has two independent blockers:

1. **Authorization:** `fn_post_wastage` checks only property membership. It does not require a stock-wastage employee permission.
2. **Location posting:** it directly decrements `product_stock_locations`, then calls `fn_apply_stock_movement`, which updates `products.current_stock`. The `products_sync_default_location` trigger then applies the aggregate delta to the default location. This can double-apply or misplace the location delta.

These are live database findings, not inferred from the UI.

## 1. Existing permission architecture

The live permission catalog is `public.employee_permission_codes` with fields `code`, `workspace`, `label`, `sensitive`, and `sort_order`.

Current stock permissions include:

- `stores.stock.receive`
- `stores.stock.issue`
- `stores.stock.transfer`
- `stores.stock.adjust`

There is no wastage-specific permission code.

The employee permission resolver `fn_employee_permission_codes(property_id, staff_id)` combines:
- permissions from a property's `employee_roles.permission_codes`;
- temporary `module_access_grants`;
- built-in fallback permission arrays for legacy staff roles;
- implicit full catalog access for platform owners and property owner/admin roles.

The Roles & Permissions editor uses the client catalog mirror in `src/lib/permissions.js`, grouped by workspace. The `store` workspace is already used by stock permissions. Therefore the existing architecture can represent separate sensitive wastage permissions without inventing a parallel role system.

## 2. Current live wastage RPC

Signature:

```sql
fn_post_wastage(
  p_property_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_location_id uuid default null,
  p_expiry_date date default null
) returns inventory_wastage
```

Current behavior:
1. Checks platform-owner/property membership only.
2. Validates positive quantity and non-empty reason.
3. If a location is supplied, locks and decrements that location row.
4. Calls `fn_apply_stock_movement(product_id, -quantity, reason, 'wastage', null)`.
5. Inserts `inventory_wastage` with the selected location and actor.

The function does not require an employee action permission, does not distinguish submitter from approver, and does not link the resulting stock movement to the created wastage record.

## 3. Confirmed location trigger behavior

The live trigger is:

```sql
CREATE TRIGGER products_sync_default_location
AFTER UPDATE OF current_stock ON public.products
FOR EACH ROW
WHEN (old.current_stock IS DISTINCT FROM new.current_stock)
EXECUTE FUNCTION fn_sync_product_default_location()
```

The trigger computes the aggregate stock delta and applies it to the product's default location, using the product's `location` value or `Main Store`.

Because the current wastage RPC decrements the selected location before calling the aggregate stock writer, a location-specific wastage can cause a second delta to be applied by the trigger. This matches the known location-posting defect previously documented for stock adjustments and inventory counts.

**Do not fix this by simply removing one update without defining the event's single posting owner.** The corrected event must update aggregate stock and exactly one intended location, in one transaction, with one ledger movement.

## 4. Recommended authorization and approval contract

Use two explicit employee permission codes in the existing `store` workspace:

| Permission | Purpose | Suggested assignment |
|---|---|---|
| `stores.stock.wastage.submit` | Create a pending wastage request with product, quantity, reason, location and optional expiry date | Authorized storekeepers / department supervisors |
| `stores.stock.wastage.approve` | Approve or reject a pending request; approval is the only action that posts stock | Store manager / inventory manager / property manager |

Both permissions should be marked sensitive. Do not automatically grant either permission to all employees or reuse `stores.stock.adjust`, `receipts.void`, or `pos.void`.

Approval rules:
- A request starts as `pending` and does not change stock.
- The requester cannot approve their own request.
- Approval locks the request row and performs one atomic stock/ledger/location posting.
- Rejection records approver, timestamp and reason but does not change stock.
- A request can be decided only once.
- Retries return the already-decided result and cannot post a second movement.
- Every posted movement links back to the wastage record and snapshots unit cost.
- Corrections after approval use a separate compensating stock event; posted wastage is never deleted or edited.

## 5. Required implementation sequence

1. Add both permission codes to the database catalog and `src/lib/permissions.js`; verify the Roles & Permissions editor can assign them to a custom role and that the server resolver returns them only for the assigned role/workspace.
2. Add request/approval state and audit fields to `inventory_wastage` using an additive migration.
3. Replace direct posting with separate submit and approve/reject RPCs. Retain property scoping, active staff identity checks, explicit permission checks, fixed `search_path`, and least-privilege grants.
4. Reconcile the location trigger contract. A selected non-default location must be the only location changed by the event; an omitted location must resolve to the default location. Do not write the location row twice.
5. Link the stock movement to the wastage record with a stable source ID and idempotency key.
6. Add UI states for pending, approved and rejected requests, and hide/disable actions without the corresponding permission.
7. Add database integration tests for permission denial, cross-property IDs, self-approval, duplicate approval/retry, insufficient location stock, default and non-default location posting, rollback, movement linkage and unchanged balances on rejection.

## 6. Release gate

- This audit did not apply migrations or modify live data.
- Do not enable the current `fn_post_wastage` for new roles until authorization and location posting are corrected.
- Do not treat static source-contract tests as proof of database transaction correctness.
- Test the migration and approval flow on an isolated production-equivalent PostgreSQL database before merge or deployment.
- The existing composite refund RPC remains inventory-only and separate from financial refunds; wastage must remain a separate event type.
