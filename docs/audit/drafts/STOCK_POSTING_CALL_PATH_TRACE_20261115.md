# Stock Posting Call-Path Trace — 2026-11-15

Status: source inspection only; no runtime or production changes.

Repository: `olitechs/olitechpmspos`, default branch `main`.

## Scope and method

Inspected active `src/` service/component paths and the corresponding committed SQL candidates. Searched for the live stock RPC names, Supabase table writes, and legacy stock helper call sites. Production function definitions for the core writers were separately inspected read-only from the live catalog on 2026-11-15.

The repository also contains a `v6/` tree. It is not treated as the active app path unless referenced by the active `src/` application. A legacy POS stock-deduction flow exists in `v6/`; it must not be copied into the active POS flow.

## Verified active application paths

| Workflow | Active UI/service entry | Database operation | Posting observation |
|---|---|---|---|
| POS sale settlement | `src/components/pos/BillPayment.jsx` → `pmsService.recordPosSale` in `src/services/pmsService.js` | `fn_record_pos_sale_with_vat_snapshot` | The active POS commits sale, receipt and tenders through one RPC. Do not add a second client-side deduction. Existing SQL path calls recipe consumption once and handles direct tracked product lines separately. |
| Stock adjustment | `src/services/inventoryService.js` → `postAdjustment` | `fn_post_stock_adjustment` | Live function writes selected location and then calls aggregate writer; trigger applies aggregate delta to default location. |
| Count creation / approval | `inventoryService.createInventoryCount` / `approveInventoryCount` | `fn_create_inventory_count` / `fn_approve_inventory_count` | Approval currently sets selected location quantity and posts variance through aggregate writer; trigger also syncs default location. |
| Wastage | `inventoryService.postWastage` | `fn_post_wastage` | Live function decrements selected location and then calls aggregate writer; trigger also syncs default location. |
| Production | `inventoryService.postProduction` | `fn_post_production` | Inputs and output call aggregate writer without explicit location; one-level recipe consumption in current live body. |
| Manual usage | `inventoryService.recordUsage` | `fn_record_stock_usage` | Calls aggregate writer and inserts a usage/audit row. Usage row is not a second quantity ledger. |
| Purchase order receipt | `inventoryService.receivePurchaseOrder` and `createPurchase` | `fn_receive_purchase_order` / `fn_create_and_receive_purchase` | GRN path calls aggregate writer. Retry identity per receipt line remains unproven; repeated partial-receipt calls may create another GRN. |
| Stock transfer | `src/components/modules/Transfers.jsx` → `pmsService.createStockTransfer` / `completeStockTransfer` | `fn_create_stock_transfer` / `fn_complete_stock_transfer` | Completion is a separate atomic path with paired direct location updates and out/in movements. It must preserve aggregate quantity and add movement source/location linkage. |
| Folio charge | `pmsService.addFolioCharge` and `postFolioCharge` | `fn_add_folio_charge` / `fn_post_folio_charge` | Generic folio charge functions are financial only in inspected source. No product/stock link is present in the observed active service payload; direct stock folio issue remains a separate unimplemented integration requirement. |
| POS void/refund | cashier adjustment flow and SQL refund/void RPCs | `fn_reverse_pos_stock` called by approved cashier adjustment/void logic | Current reversal helper recalculates from current recipe state per previous audit; it must be redesigned to reverse original movement rows and distinguish physical return from money-only refund. |

## Important active-path findings

### 1. Product creation/import is not the same as a stock movement

- Active Store UI calls `inventoryService.createProduct`, `updateProduct`, and `bulkUpsertProducts`.
- `bulkUpsertProducts` calls `fn_bulk_upsert_store_products`, passing `current_stock` in imported/product payloads.
- Store add/edit forms also pass `current_stock`.
- This means product initialization/import and later edits need a carefully separated rule: initial opening stock may be posted once as an opening movement, but editing product metadata must never silently overwrite quantity. The live body of `fn_bulk_upsert_store_products` and all form semantics must be reconciled before changing this path.
- Do not simply remove `current_stock` from the payload: that could break initial stock setup. Do not continue allowing metadata edits to reset on-hand quantity.

### 2. Legacy helper methods remain in active service but are not the active POS sale flow

`inventoryService.js` still defines:
- `adjustProductStock` → `fn_adjust_product_stock`;
- `deductStock` → `adjustProductStock`;
- `deductStockForOrder`;
- `deductRoomAmenities`;
- `deductHousekeepingUsage`;
- `deductLaundryUsage`.

Repository search did not find active `src/` component callers for the amenity/housekeeping/laundry helpers. The active POS component calls `pmsService.recordPosSale`, not `deductStockForOrder`. The old `v6/` POS component did call the legacy helper, but `v6/` is a separate historical tree. Before removal or redirect, verify the production route/build entry and all dynamic imports; do not delete on search evidence alone.

### 3. Direct product stock writes remain a migration concern

- Active product writes use the bulk-upsert RPC, not a direct `product_stock_locations` write.
- Active visual-only POS updates write tile fields to `products`, not stock.
- The bulk-upsert RPC receives stock quantity in its payload and therefore needs a distinct opening-balance/adjustment policy.
- The active inventory service still has broad product reads (`select('*')`) and masks cost in JavaScript for some roles. This is a separate column-confidentiality issue; browser masking is not a database security boundary.

### 4. Transfers are deliberately not routed through the same signed aggregate helper

A transfer has two location movements but zero aggregate movement. It needs one atomic transfer-specific owner, paired movement rows with the same transfer-line identity, and idempotent completion. Calling the aggregate posting helper twice would be wrong unless the helper explicitly supports a no-aggregate transfer mode.

## Source-to-database migration sequence

1. Define opening stock semantics for new products, imports, and metadata edits; inspect `fn_bulk_upsert_store_products` live definition and active UI payloads.
2. Introduce the internal location-aware movement writer with explicit location, source line key, idempotency, and balance mode (aggregate-changing vs paired transfer).
3. Refactor adjustment, wastage and count approval so none writes location rows independently.
4. Refactor usage, production and receiving to supply stable source IDs/line keys and an explicit location policy.
5. Preserve transfer as one atomic paired movement owner; add source/location keys and retry protection.
6. Refactor POS recipe/direct product issue to post exactly once per receipt line; bind original receipt movements for void/refund reversal.
7. Add direct stock-linked folio issue only after a product-aware folio line model and physical-return/refund semantics are specified.
8. Verify and retire legacy helper methods only after full active route/call-site analysis.
9. Retire the default-location trigger only after every current_stock writer and product initialization path has migrated.
10. Harden DML grants/policies after every screen is confirmed to use the authorized RPC path.

## Validation status

- Source search and live function-definition inspection: completed for the paths listed above.
- App build/lint/tests: not run in this turn.
- Runtime database regression: not run.
- Production schema/data/security changes: none.
- Do not treat this source trace as migration approval. Follow `docs/audit/PHASE2_FORWARD_MIGRATION_REVIEW_PLAN.md` before executable migration work.
