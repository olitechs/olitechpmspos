# POS Composite Items — Phase 3 Unit Conversion and Costing

**Status:** Implemented on the Phase 2 feature branch; validation pending.  
**Migration:** `20261120080000_phase3_composite_unit_costing.sql`

## Existing foundation reused

The live production schema already contains `inventory_units` and `inventory_unit_conversions`, with global conversions for mass (g/kg/mg), volume (ml/l) and count (each/pcs). These tables are read-only to authenticated clients; no duplicate unit catalogue was introduced.

## Delivered

- Added entered quantity/unit and unit-cost/line-cost snapshot columns to `recipe_ingredients`.
- Preserved `recipe_ingredients.qty` as the normalized quantity in the component product's `base_unit`. This keeps the downstream stock deduction contract stable for Phase 4.
- Added `fn_inventory_unit_factor`, which validates that units share a dimension, resolves direct or reverse conversion factors, and prefers property-specific conversions over global defaults.
- Replaced the composite recipe save RPC implementation while retaining its signature and manager/property authorization checks.
- Server-side save validates component ownership and tracking mode, rejects nested composites, normalizes entered quantities to base units, snapshots current product cost, and calculates the recipe's component cost.
- Count units marked as not allowing fractions reject fractional entered quantities.
- Updated the editor to load the unit catalogue/conversions, offer only dimension-compatible units, show normalized stock quantities and line costs, and send unit-aware component definitions.
- Added Phase 3 architecture contract tests to the architecture test command.

## Cost basis

The server treats each component product's current `cost_price` as cost per its `base_unit`. The recipe line snapshot is:

`normalized base quantity × current cost_price per base unit`

The recipe-level estimate is the sum of component line snapshots. Currency formatting in the editor currently uses KES; property-specific currency metadata is not part of this phase.

## Boundaries and safety

- No stock balances or stock movements are changed.
- No sale deduction, refunds, wastage or production/assembly workflows are added.
- No production migration was applied.
- Existing legacy recipe ingredient quantities are left intact; for legacy rows with no entered-unit snapshot, the editor displays the stored quantity in the component's base unit.
- Cost snapshots are refreshed when the recipe is explicitly saved; they are not retroactively rewritten when product cost changes.
- Phase 4 must consume the normalized `qty` field and snapshot the recipe version into stock movements as part of the sale transaction.

## Required validation

- Run Phase 2 and Phase 3 contract tests and full architecture suite.
- Run lint, typecheck and production build.
- Apply both Phase 2 and Phase 3 migrations in order to a disposable production-equivalent database.
- Verify standard and property-specific conversions, inverse conversions, incompatible dimensions, fractional count rejection, permissions and legacy recipe preservation.
- Verify the editor using an authorized manager account.
