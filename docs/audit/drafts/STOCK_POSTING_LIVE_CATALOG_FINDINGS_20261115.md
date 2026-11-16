# Stock Posting Trace — Additional Live Database Findings
Date: 2026-11-15
Status: read-only production catalog confirmation; design evidence only.

This addendum supplements `STOCK_POSTING_CALL_PATH_TRACE_20261115.md`. No production schema, permissions, or stock quantities were changed.

## 1. Product import/edit is a stock writer and has a location overwrite defect

Live `public.fn_bulk_upsert_store_products(uuid,jsonb)` was inspected using `pg_get_functiondef`.

For a new product:
1. inserts the product with `current_stock = 0`;
2. if requested opening stock is positive, calls `fn_apply_stock_movement(product_id, opening_qty, ...)`;
3. after that, creates/resolves the requested location and upserts `product_stock_locations.qty = v_stock`.

For an existing product:
1. reads old aggregate stock;
2. updates product metadata (but not `current_stock`);
3. computes `v_change = requested_stock - old_stock`;
4. if nonzero, calls `fn_apply_stock_movement` for the aggregate delta;
5. after that, upserts the selected location to the entire requested aggregate `v_stock`, not the delta and not a location-scoped balance.

Consequences:
- The shared writer's aggregate update fires `products_sync_default_location` and adjusts the default location.
- The function then sets the selected location row to the full aggregate stock, which can overwrite a location balance and create a mismatch with the sum of all locations.
- If the product's location field changes, the old location row is not explicitly migrated/cleared by this function.
- This means the product import/edit function must be migrated in the same release as the writer and trigger. Fixing only adjustment/count/wastage is insufficient.

Required target behavior:
- Product metadata update must not implicitly overwrite quantity.
- New product opening stock must create one explicit opening movement at a chosen location.
- Existing product stock corrections must be explicit adjustment events with stable source identity, not an implicit import overwrite.
- Changing a product's default/display location must not move quantity; an explicit transfer is required to move stock between locations.
- Reconcile aggregate and all location projections before and after migration.

## 2. Live POS sale function confirms one recipe owner, but movement source IDs are NULL

Live `fn_record_pos_sale(...)` was inspected.

- It calls `fn_consume_recipe_stock(property_id, items, order_number)` once.
- It then loops direct product items and skips any item whose name matches an active recipe.
- For direct tracked products it calls `fn_apply_stock_movement(..., 'pos_sale', NULL)`.
- It creates the POS receipt after the stock deductions, all within the same database transaction.
- Receipt-level idempotency lookup occurs before posting, and unique violation recovery returns the prior receipt.

Target rule:
- Preserve the one-owner split: recipe ingredients are consumed by the recipe helper; directly tracked menu products are consumed by the direct-item loop. Never add a second recipe deduction.
- Introduce a stable receipt/event key before posting (or a stable client idempotency key plus line identity) and attach it to every direct and recipe movement. Movement source IDs are currently NULL, so reversing stock from receipt-linked original movements is not currently possible.
- Keep all posting inside the receipt transaction.

## 3. POS reversal recomputes current recipes and does not distinguish physical returns

Live `fn_reverse_pos_stock(uuid,jsonb,numeric,text)` was inspected.

- It iterates receipt item JSON.
- For an item that matches a currently active recipe, it reads the current recipe ingredients and posts positive movements for those current ingredients.
- Otherwise it posts positive stock to the product ID in the receipt item.
- It passes NULL source IDs to the movement helper.
- The function has no physical-return flag or per-line return decision.

Risk:
- If recipe ingredients change after the original sale, reversal may restore different items or quantities than were consumed.
- A money-only refund may restore stock even when goods were not physically returned.
- Without movement linkage, the system cannot prove which exact original deductions were reversed or prevent cumulative over-restock reliably.

Target rule:
- Reverse original receipt movement rows by reference, not today's recipe definition.
- Use an approved refund/void ID and original movement ID as the reversal identity.
- Record whether returned goods were physically received back into stock; a financial refund alone must not imply restock.
- Partial returns must identify returned receipt lines/quantities, not infer physical returns from the money ratio alone.

## 4. Purchase receiving retry identity remains incomplete

Live `fn_receive_purchase_order(uuid,jsonb)`:
- locks the PO;
- inserts a new GRN for each call;
- checks remaining ordered quantity by summing previous GRN lines;
- posts each received quantity through `fn_apply_stock_movement` using the GRN header ID;
- then inserts each GRN line.

The PO row lock and remaining-quantity check prevent over-receiving beyond the ordered quantity, but the API has no stable request idempotency key. If the client loses the successful response and retries with the same partial quantity, it may create a second GRN and a second valid receipt, provided quantity remains. A GRN header ID is not a retry key because it is newly generated per call.

Target rule:
- Require a stable receipt-request idempotency key and unique line identity; retries must return the original GRN/result.
- Keep actual subsequent partial receipts as separate, intentional receipt events.

## 5. Immediate implementation ordering update

The location-aware migration must include, in one coordinated release:
1. a revised `fn_bulk_upsert_store_products` contract (opening balance only for new products; explicit stock adjustment for existing quantities; no direct location overwrite);
2. the common writer and refactored adjustment/wastage/count/usage/production/GRN paths;
3. a paired transfer writer that does not change aggregate stock;
4. POS receipt movement source linkage and original-movement-based reversal;
5. only then retirement of the default-location trigger and direct client stock DML.

Do not ship the trigger removal or direct-write revokes before these callers are migrated and regression-tested.
