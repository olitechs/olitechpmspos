# POS Composite Items — Phase 2 Implementation

**Status:** Implemented on feature branch; awaiting CI and review.  
**Migration:** `20261120070000_phase2_composite_product_definitions.sql`

## Delivered

- Added `products.inventory_tracking_mode` with `untracked`, `direct`, and `composite` values. Existing products default to `direct`; no existing stock balances are changed.
- Added nullable `recipes.menu_product_id` with a property-scoped unique index.
- Added positive `recipes.recipe_version` metadata.
- Backfilled only legacy recipes whose menu-item name matches exactly one product in the same property. Ambiguous matches remain untouched.
- Added a manager-guarded RPC, `fn_upsert_composite_product_recipe`, to create/update/disable a fixed-component recipe by stable product ID.
- Validates same-property components, positive quantities, no self-reference, no duplicate component IDs, and tracked inventory components.
- The RPC changes only the tracking mode; it does not mutate current stock, stock movements, receipts, or POS sales.
- Added `CompositeItemEditor.jsx` to the existing POS product edit modal. It supports enabling/disabling composite mode, adding/removing components, selecting existing inventory products, decimal quantities, notes, and an indicative component cost.
- Added inventory service methods and a Phase 2 contract test in the architecture test command.

## Deliberate boundaries

- This phase does not change POS sale posting or recipe deduction. The current sale path still consumes recipes by name until Phase 4 replaces that path atomically.
- Do not apply the migration to production or enable composite products for live sale until Phase 4 is implemented and tested. The editor is a configuration capability, not yet a safe stock-deduction release.
- Unit conversion, canonical unit validation and cost snapshots are Phase 3.
- No production/assembly workflows.
- No refund/wastage changes in this phase.
- Existing product `track_stock` is preserved when setting composite mode. Phase 4 will make the tracking-mode resolver authoritative for sale deduction.

## Validation still required

- Run the new contract test and full architecture suite.
- Run ESLint, typecheck and production build.
- Test migration on a production-equivalent disposable database.
- Verify grants, RLS, role checks and legacy recipe mapping against representative multi-property fixtures.
- Verify component editor interaction with a real authorized manager account.
- Review the migration SQL with the live location and ledger invariants before any deployment.

## Safety

No production migration was applied, no production stock or receipt rows were changed, and no production/assembly workflow was added.
