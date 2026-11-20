# POS Composite Items — Phase 8 Production / Assembly Audit

**Date:** 2026-11-20  
**Scope:** Read-only inspection of the live production RPC, recipe tables, production ledger table, grants and existing Inventory Operations UI. No production data or schema was changed.

## Live implementation

The current RPC is:

```sql
fn_post_production(
  p_property_id uuid,
  p_recipe_id uuid,
  p_output_product_id uuid,
  p_quantity numeric,
  p_reference text default null
) returns inventory_productions
```

It is SECURITY DEFINER and executable by `authenticated`. Its authorization check is only platform-owner/property membership. It does not check a production-specific employee permission or the Stores module entitlement.

The RPC:
1. Loads an active recipe by ID and property.
2. Checks that the output product belongs to the property.
3. Loops recipe ingredients and calls `fn_apply_stock_movement` with `source_type='production'` and `source_id=NULL`.
4. Calls `fn_apply_stock_movement` to add the output quantity.
5. Inserts `inventory_productions` after the movements.

## Confirmed gaps

1. **Authorization:** property membership is not a production permission. Any authenticated property member able to invoke the RPC can attempt production.
2. **No idempotency:** the RPC accepts no request key. A retry can consume components and create output again.
3. **Unlinked stock movements:** component and output movements use a null source ID, so they cannot be reliably traced back to the `inventory_productions` row.
4. **Recipe validation gap:** the posting RPC does not reject an empty ingredient list. It also does not revalidate that each ingredient product belongs to the selected property and is stock-tracked.
5. **Output validation gap:** it verifies property ownership but does not require the output product to be stock-tracked. The stock helper returns without changing stock for an untracked product, while the production row can still be inserted.
6. **No immutable production snapshot:** `inventory_productions` stores recipe ID, output product, quantity, reference, status and actor, but no component quantities/cost snapshot. Recipe edits can make historic production difficult to reconstruct.
7. **Location behavior:** the RPC does not select component/output locations. The generic stock helper updates aggregate product stock and relies on the existing default-location trigger. It cannot post a batch to an explicitly selected location.
8. **Direct table privileges:** the live `inventory_productions` table grants INSERT, UPDATE and DELETE to `anon` and `authenticated`, while its observed RLS policy is SELECT-only. The grants should still be revoked so the RPC is the only client write path.
9. **UI authorization:** the current Inventory Operations Production panel exposes a Post Production action without checking a dedicated production permission.

## Proposed Phase 8 contract

Add one sensitive employee permission in the existing `store` workspace:

- `stores.production.post` — post a production/assembly batch.

Expose it in the client permission catalog and custom Roles & Permissions editor. Grant it in the legacy built-in `store_manager` and `fb_manager` fallback roles; other employees receive it only through an explicit custom role or temporary permission grant. Enforce it in Postgres, not only in the UI.

The production RPC should:
- require active Stores entitlement, property membership and `stores.production.post`;
- require a stable request key and reject reuse with different payload details;
- lock the recipe and all involved products in deterministic product-ID order;
- require an active property-owned recipe with a positive yield and at least one valid ingredient;
- verify every component and output is a tracked product in the same property;
- reject cross-property recipe components and invalid quantities;
- create the production record before posting movements, within one transaction;
- use the location-aware stock writer for every component deduction and output addition, resolving the product default location until explicit production locations are supported;
- link every movement to the production record with stable component/output line keys and idempotency keys;
- snapshot the recipe/component quantities, units, unit costs and output quantity/cost on the production record;
- revoke authenticated direct INSERT/UPDATE/DELETE on `inventory_productions`;
- disable the old membership-only RPC after the replacement endpoint is wired into the service and UI.

The UI should hide or disable the production posting action without `stores.production.post`, retain a request key across a retry, and clearly report that a failed transaction did not post a batch.

## Dependencies and release gates

- The location-aware internal writer is introduced by Phase 7.1. Production posting must be migrated after that migration, in the same ordered release.
- Recipe unit conversions and component cost snapshots from the composite recipe phases must be used where present; do not infer unit equivalence from display labels.
- The Phase 7.1 writer fails closed when a product's aggregate stock, movement ledger or location projection does not reconcile. The existing two known product discrepancies must be resolved through an authorized stocktake before those products can be used in production.
- No production migration or UI implementation is included in this audit.
- Before merge, test permission denial, retry idempotency, duplicate request payload mismatch, empty recipe, cross-property ingredient, untracked component/output, negative-stock policy, default-location deltas, movement linkage, recipe snapshot immutability, rollback and tenant isolation on a disposable production-equivalent database.
