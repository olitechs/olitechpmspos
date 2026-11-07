# POS-to-stock deduction workflow

**Product:** OliTechs PMS + POS  
**Research date:** 2026-11-07  
**Status:** Design and safe client-side hardening completed; database correction is intentionally blocked pending the repository’s source/live reconciliation and production-equivalent test gates. No database migration was authored or applied.

## Posting trigger recommendation

Keep a single authoritative quantity ledger: `public.stock_movements`. Treat `products.current_stock` and `product_stock_locations` as projections that must reconcile to that ledger; do not also post POS consumption to legacy `inventory_items` / `inventory_movements`.

For the current implementation, use **finalized-sale settlement** as the default posting event. The existing POS already posts its receipt, tracked-item/recipe consumption and tender allocations through one settlement RPC; keeping that boundary avoids consuming stock for draft tickets and makes split tender one sale event. Do not defer posting to shift close: it would leave on-hand figures stale during service and collect avoidable posting failures into one large close operation. A property may later opt into a **server-accepted kitchen-fire** event for operations that need ingredients reserved/consumed before payment. That mode must be implemented end-to-end before it is enabled; an order being locally displayed or a printer being called is not a posting event.

The default negative-stock policy should be **block**. An exceptional warning-and-allow override, if approved later, must require an authorized actor, reason, and audit trail. A refund is a financial event; stock is returned only for explicitly identified quantities that physically return to usable stock. Prepared food discarded after fire is waste, not a refund-driven restock.

## Cross-vendor evidence

There is no universal inventory-depletion hook in the reviewed products. Current Toast IQ documents depletion when an order fires to the kitchen; Square documents completed/paid order processing and explicit inventory adjustments; Odoo and ERPNext expose configuration-dependent payment/order or session-close posting paths. Net Restaurant, Loyverse, and Lightspeed materials do not establish one precise universal internal trigger. The public Net Restaurant brochure documents “stock and deduction of sold courses” but not the exact event; do not infer a Send/payment/close hook from that wording. [1], [2], [3], [4], [5], [6], [7].

| Product | Documented approach | Relevance and evidence limit |
|---|---|---|
| Net Restaurant / Net-Store | Sold-course stock deduction, recipes, course cancellation, bill division, stock documents and movements are described. | Exact posting trigger, BOM explosion, unit conversions, refund reversal, idempotency, offline stock replay and tenant security are not documented. [5], [8] |
| Loyverse | Composite items consume component quantities; inventory history includes sales/refunds/transfers/receipts/adjustments; refunds can select returned quantities; negative-stock alerts are soft; offline sales queue as unsynced receipts. | Exact sale-write idempotency and native inventory hook are undocumented; refund quantity is a better model than refund-dollar pro-rating. [9], [10], [11], [12] |
| Lightspeed K-Series / Retail R-Series | K-Series documents physical Kitchen/Bar/Cellar locations, movement history and configurable reverse-stock behavior by void reason. R-Series selects a location for completed sales and distinguishes pre-payment voids from post-completion refunds. | These are distinct products; neither reviewed source establishes one shared internal hook. K-Series void/reason and cancellation reporting should inform the sent-item workflow. [13], [14], [15] |
| Toast IQ Inventory | Current IQ explicitly depletes recipe ingredients when the order fires to the kitchen; it distinguishes post-fire void/restock from refund-without-restock when food was discarded. | Strong precedent for a configurable kitchen-fire mode and separate waste/refund reasons. Current within-site sub-location limits and offline replay guarantees are not established. [1], [16] |
| Square for Restaurants | One-level Recipes; completed order/payment and Inventory API adjustments; batch changes use a UUID idempotency key, client timestamps and atomic batches. | Best supplied example for retry-safe writes, but recipe/modifier support is bounded and native POS send-time timing is not specified. [17], [2], [18] |
| Odoo POS / Inventory 19.0 | Posting may occur in backend payment/order processing or at session close, depending on stock configuration; locations, pickings and phantom-BOM handling are available. | Demonstrates why the event must be a named policy rather than inferred from a UI label. Offline stock sync is not real-time. [3], [19], [20] |
| ERPNext POS / Stock | Submitted Sales Invoices can post stock; POS Invoice mode consolidates at POS Closing Entry. Warehouse and Stock Ledger movements are explicit. | Shows that session-close posting is a product mode, not a universal rule. POS BOM explosion and offline replay semantics are not established by the reviewed POS docs. [4], [21], [22] |

Unit conversion should use a declared base stock unit and preserve the conversion used on the sale/movement. Toast, Square, Odoo and ERPNext document conversion behavior; their models differ (including cross-dimension density handling, fractional sale quantities and stock-UOM conversion). Recipes, composites, modifiers and manufacturing BOMs are also not interchangeable. [16], [23], [24], [25].

## Current OliTechs implementation audit

| Area | Current behavior | Finding |
|---|---|---|
| Sale trigger | `BillPayment` calls `pmsService.recordPosSale` during payment settlement. The sale RPC posts stock and receipt/tender records in a database transaction. | Settlement is the existing default; KDS send is earlier and currently does not post inventory. |
| Direct products / recipes | Direct tracked products and active recipe ingredients use the shared `fn_apply_stock_movement` path. Recipes consume ingredient quantities scaled by recipe yield. | There is one intended posting owner for recipe ingredients; do not add a second client deduction. |
| Split tender | Split allocations are validated against the receipt total inside the sale flow. | A split tender must remain one receipt and one stock event, not one deduction per tender. |
| Negative stock | The shared movement helper locks the product and rejects insufficient stock. | Current server behavior is block; retain this default and ensure recipe component shortages fail the whole transaction. |
| Retry identity | The database checks a receipt-level idempotency key, but the payment screen generated a new random key on mount and on success. | Fixed in the client: retries now use a stable property + table + order key. A database-enforced per-line movement source key remains a migration item. |
| Item mapping | A line with no mapped product/recipe could be accepted without a stock movement. | Fixed in the client: receipt JSON now preserves `order_line_id` and `stock_tracking_status`; unlinked/unverified lines trigger a cashier warning. This does not yet force the server to reject an unmapped line. |
| Kitchen voids | Sent items use the existing KDS control-void path and print a void ticket. No sale movement exists before settlement. | If food was prepared/discarded before settlement, there is no automatic wastage movement today. Do not “reverse” stock that was never posted; add a distinct waste posting in a reviewed transactional workflow. |
| Refunds | Cashier UI asks for a refund amount and reason; the current RPC restores the full receipt’s stock by `amount / receipt.total`. | This is not accurate for arbitrary partial quantities or money-only refunds. A returned-line quantity and physical-restock decision are needed before a safe database correction. |
| Alerts | `Store` exposes out-of-stock, low-stock and expiry alerts; the POS catalog returns `current_stock` and `min_stock`. | POS product cards now show a warning-token LOW STOCK badge at or below `min_stock`, and keep zero/negative catalog items blocked. Recipe-component availability remains server-validated; automatic reorder creation is not established. |
| Locations / ledger linkage | `inventory_locations` and `product_stock_locations` exist. POS movement source IDs are NULL in the captured contract; location balance ownership has known trigger/double-application risks. | Stable movement source keys, location reconciliation and one balance owner are migration-gated. |
| Legacy inventory | The active legacy `Inventory.jsx` screen uses `inventory_items`, separate from POS-linked `products`. | Its obsolete “automatic deduction is planned” note was replaced with an explanation and a link to Store / Products; the two data models are not silently merged. |
| Roles / tenant safety | UI role gates and property-scoped services exist. | The Phase 2 security audit identifies database action-entitlement and cost-visibility gaps; UI filtering is not a security boundary. |

## Recommended flow and states

Use `property_id` as the current tenant scope and `inventory_locations` as stock locations until the separately approved schema establishes a business/branch hierarchy. Dining tables and checks are service objects, not stock locations. Every write must be scoped to property, product, location, staff/device, subscription entitlement and action role at the database boundary.

```mermaid
flowchart TD
  A[Draft order line] --> B{Posting policy}
  B -->|settlement default| C[Persisted check / KDS send is stock-neutral]
  C --> D[Settle cash, card, room or split tender]
  D --> E[Stable property + table + order idempotency key]
  E --> F[One transactional sale RPC]
  B -->|optional kitchen-fire| G[Server accepts first fired line once]
  G --> F
  F --> H{Resolve line mapping}
  H -->|direct tracked product| I[Consume product quantity]
  H -->|active recipe| J[Expand versioned recipe into base-unit ingredients]
  H -->|unmapped| K[Persist warning / block if policy requires]
  I --> L[Lock product + authorized location]
  J --> L
  L --> M{Negative-stock policy}
  M -->|block| N[Fail transaction; no receipt/tender/movement commits]
  M -->|authorized override| O[Audit actor + reason]
  M -->|sufficient| P[Append immutable movement(s)]
  O --> P
  P --> Q[Update/reconcile location and aggregate projections]
  Q --> R[Commit receipt + payment allocations]
  R --> S[Refresh low-stock/out-of-stock alerts]
  S --> T[Print current receipt format]
  G --> U{Cancel after fire?}
  U -->|prepared/discarded| V[Post wastage; do not restock]
  U -->|usable physical return| W[Explicit return/restock movement]
  D --> X{Refund?}
  X -->|money only / discarded food| Y[Financial refund only]
  X -->|physical item returned| Z[Refund selected line quantities + explicit restock disposition]
```

The recommended property policy is `settlement` by default, with an optional `kitchen_fire` mode after its full line-level implementation and tests. Do not add `shift_close` as a default: stock and low-stock decisions would be stale during service, and errors would arrive after the operational event. For a fire-time policy, the first successful server-side fire of an order line consumes it exactly once; unsent/draft cancellation has no movement; cancellation after fire is either a compensating restock of usable returned stock or a waste movement if prepared/discarded. For settlement policy, a pre-settlement KDS void has no prior sale movement to reverse; prepared/discarded items must be recorded as waste through an authorized workflow.

## Data model: existing foundation and proposed additive changes

Do not create a parallel ledger. The proposals below are design-only; implement only after migration provenance, exact live function/grant/policy comparison, location invariants and production-equivalent database tests are complete.

| Entity | Current foundation | Additive target |
|---|---|---|
| Tenant/store and locations | `properties.property_id` scope; `inventory_locations`; `product_stock_locations`; current product aggregate. | Keep tenant and location scope explicit; add/validate `stock_movements.location_id` and make a single server writer own both location and aggregate projections. Reconcile before changing the invariant. |
| Sellable products vs stock items | `products` holds the POS catalog and stock fields; `pos_enabled` identifies POS availability. | Add an explicit `inventory_tracking_mode` (`untracked`, `direct`, `recipe`) and validated `stock_uom`; keep sellable menu product and raw stock item identity clear. |
| Recipes | `recipes` and `recipe_ingredients` hold names, yields and ingredient quantities; current POS matching can use menu-item name. | Add a stable `menu_product_id` and immutable recipe version/effective identifier; snapshot the recipe version and base-unit quantities on the receipt line. Preserve existing records during migration. |
| Unit conversions | Product unit text and recipe quantities exist; no general product-level conversion engine is established. | Add property/product-scoped `product_unit_conversions` rows (`from_uom`, `to_stock_uom`, positive factor, dimension, precision, rounding rule, active/effective fields). Require explicit packaging factors for crate→bottle and compatible dimensions for kg→g. |
| Stock movements | `stock_movements` is the authoritative movement table with direction/type, reason, actor/timestamp and `source_type`/`source_id`; `products.current_stock` and locations are projections. | Add stable `source_key`, `location_id` and `reversal_of_movement_id` fields where exact catalog comparison confirms they are absent. Add a partial unique constraint on tenant + event key; use event-specific keys for each direct item or recipe ingredient line. Do not UPDATE/DELETE posted rows. |
| POS receipt lines | Receipt items are JSONB; this change adds `order_line_id` and `stock_tracking_status` metadata to the payload. | If JSONB cannot enforce stable line uniqueness/references, add a normalized `pos_receipt_lines` source table with `UNIQUE(receipt_id, order_line_id)`, product/recipe version, quantity, input UOM/conversion snapshot and modifiers. It is a source record, not a second quantity ledger. |
| Posting policy | Current behavior is settlement-triggered. | Add one property-scoped policy record with `posting_trigger` (`settlement` or `kitchen_fire`), `negative_stock_policy` (`block`, `warn_allow`, `allow_report`), default consuming location and policy version. Disallow unimplemented modes in the UI. |
| Returns / refunds | `cashier_adjustments` stores amount, reason and method; refund stock currently uses an amount ratio. | Add normalized `pos_refund_lines` tied to refund, receipt and original order-line ID with returned quantity, disposition (`restock`, `waste`, `no_stock_effect`), target location and movement reference. Enforce cumulative returned quantity ≤ sold quantity and a unique refund-line event key. |
| Wastage / transfers / counts / GRN | Existing sources and APIs cover purchase/GRN, transfers, counts, adjustments, wastage, production and history. | Keep each source’s one posting owner, stable event-line idempotency and compensating-event reversal. Correct location/accounting ownership before extending. |

### Service/RPC contracts

- **POS settlement:** `pmsService.recordPosSale` remains the only client entry point. It supplies the stable receipt key and stable order-line IDs. The database RPC validates property membership/action permissions, shift/payment allocations, each tracked product/recipe, policy and stock sufficiency; then appends movement(s), persists receipt and allocations, and commits atomically. The client never writes `stock_movements` or location balances directly.
- **Kitchen-fire mode (future):** a server RPC accepts fired line IDs plus a stable event key, locks the order-line state, snapshots recipe version/location, posts exactly once, and returns the accepted KDS state. A duplicate fire returns the prior result. Printing is downstream of persisted KDS state and cannot determine stock posting.
- **Void/cancel:** unsent cancellation has no stock movement. A post-fire, pre-settlement cancellation produces a waste or authorized return event, not an automatic full-sale reversal. A posted receipt void is a one-time compensating event linked to the original movements and cashier adjustment.
- **Refund:** `recordCashierAdjustment` accepts item quantities and a reason. Financial amount/method remain separate from physical restock disposition. Money-only refunds do not restore stock; physically returned usable goods restore only selected returned quantities. A prepared/discarded item is waste.
- **Split bills/tenders:** line identity survives split/recombine. Stock posts once per finalized sale line; tender allocations do not re-trigger consumption.
- **Inventory operations:** purchase receipt, transfer, count, adjustment, production and wastage each keep their own single posting owner. Every source replay is idempotent and every correction is a compensating movement.
- **Alerts/reporting:** on-hand/low/out-of-stock/expiry states are refreshed after committed movements. Reorder reminders should show suggested order quantity (`max_stock - projected_on_hand`) but never create a PO without an authorized staff action. Reports reconcile sale lines, source movements, location/aggregate balances, returns, waste, transfers, counts and exceptions.

## Regression coverage and current status

The standard `npm run test:architecture` suite now includes source-contract tests for normal sale routing, recipe yield scaling, KDS sent-item void controls and posted-receipt reversal, approved refunds, split-tender totals, negative-stock rejection, duplicate sale retries, and receipt-line mapping/warnings. The new pure unit tests cover stable order keys, tenant/table/check key isolation, direct-product/recipe/unlinked mapping and invalid identifiers.

These tests exercise client logic and committed SQL/source contracts; they are **not** a substitute for executing the database functions. The two-property, role-separated PostgreSQL runtime fixture was not available for this work. In particular, exact partial returned quantities, post-fire wastage, movement source-key uniqueness, location projection correctness and database action-role denial remain unverified. The old disposable Supabase project is documented as non-equivalent to current production signatures; do not use it as proof.

## Migration and rollout gate

No database migration was authored or applied. The repository’s `docs/PHASE2_FORWARD_MIGRATION_REVIEW_PLAN.md`, `docs/PHASE2_INVENTORY_EVENT_AND_ROLE_MATRIX.md`, `docs/PHASE2_INVENTORY_SECURITY_AUDIT.md` and `docs/PHASE2_MIGRATION_PROVENANCE_RECONCILIATION.md` explicitly leave exact source/live SQL provenance, role/cost boundaries, location balance ownership and production-equivalent runtime tests open. Before any migration:

1. Reconcile each relevant live migration/function signature, body, ACL, trigger, RLS policy and constraint to committed source; preserve historical migration history.
2. Establish the aggregate-versus-location balance invariant and one movement owner; verify two-property default and non-default locations.
3. Add runtime tests for sale, recipe, duplicate retry, sent-item void/waste, full void, line-quantity refund, split tender, negative-stock block, GRN retry, transfer, count/adjustment, role denial and cross-tenant denial.
4. Run security/performance advisors on an authorized production-equivalent disposable database; obtain a second review and documented forward recovery plan.
5. Apply only a new additive migration after those gates pass. Never run these mutation tests against production.

## References

[1]: https://support.toasttab.com/en/article/Toast-IQ-Inventory-Overview "Toast IQ Inventory Overview"
[2]: https://developer.squareup.com/docs/inventory-api/how-it-works "Square Inventory API Process Flow"
[3]: https://raw.githubusercontent.com/odoo/odoo/19.0/addons/point_of_sale/models/pos_order.py "Odoo 19 POS order source"
[4]: https://docs.frappe.io/erpnext/pos-workflows "ERPNext POS Workflows"
[5]: https://www.dr-group.it/inglese/net_restaurant.htm "Net Restaurant official brochure"
[6]: https://help.loyverse.com/help/make-sales "Loyverse How to Make Sales"
[7]: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517617611-Stock-levels "Lightspeed K-Series Stock Levels"
[8]: https://www.dr-group.it/inglese/net_store.htm "Net-Store official brochure"
[9]: https://help.loyverse.com/help/how-create-composite-item "Loyverse Composite Items"
[10]: https://help.loyverse.com/help/how-issue-refund-loyverse-pos "Loyverse POS Refunds"
[11]: https://help.loyverse.com/help/negative-stock-alerts "Loyverse Negative Stock Alerts"
[12]: https://help.loyverse.com/help/offline-work-of-pos "Loyverse Offline POS"
[13]: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4406100346267-Understanding-stock-locations "Lightspeed K-Series Stock Locations"
[14]: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4406100365851-About-stock-movements "Lightspeed K-Series Stock Movements"
[15]: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804657449-Understanding-void-reasons "Lightspeed K-Series Void Reasons"
[16]: https://support.toasttab.com/en/article/Toast-IQ-Inventory-FAQ "Toast IQ Inventory FAQ"
[17]: https://squareup.com/help/us/en/article/8629-beta-track-ingredient-costs-with-square-recipes "Square Recipes"
[18]: https://developer.squareup.com/reference/square/inventory-api/batch-change-inventory "Square BatchChangeInventory API"
[19]: https://raw.githubusercontent.com/odoo/odoo/19.0/addons/point_of_sale/models/pos_session.py "Odoo 19 POS session source"
[20]: https://raw.githubusercontent.com/odoo/odoo/19.0/addons/pos_mrp/models/pos_order.py "Odoo 19 POS MRP source"
[21]: https://docs.frappe.io/erpnext/pos-invoice-consolidation "ERPNext POS Invoice Consolidation"
[22]: https://docs.frappe.io/erpnext/stock-ledger "ERPNext Stock Ledger"
[23]: https://squareup.com/help/us/en/article/7237-stock-conversion-sell-by "Square Stock Conversion"
[24]: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html "Odoo Units of Measure"
[25]: https://docs.frappe.io/erpnext/Selling-in-different-UOM "ERPNext Selling in Different UOMs"
