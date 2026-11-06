# Phase 1 — Live schema export review

Date: 2026-11-06  
Source artifact: `olitechs-public-schema-42188290626.zip`  
Exported file: `olitechs-public-schema.sql`  
Supabase CLI: `3.0.0`  
SQL size: `535,116` bytes  
SHA-256: `931fb562085fd50c95aebb6c7d079336a3cc8a1174016dee4d4324ae3f300cba`

## Scope and handling

The uploaded artifact was extracted and its SHA-256 was verified against the accompanying `olitechs-public-schema.sha256` file. The export contains the SQL schema, checksum, and CLI version. It contains no `COPY` data blocks; INSERT statements found in the SQL are statements inside stored function definitions, not exported table-row payloads.

This was an offline inspection of the supplied schema artifact. No SQL was executed against Supabase. No production database writes, DDL, grants, policies, triggers, data changes, migrations, tests, or builds were performed.

The connected free-tier Supabase project remains read-only. No paid branch/project was created. Printer service/configuration, device routing, paper feed, margins, cutter commands, order-ticket templates/printing, unsettled/paid receipts, and cashier/payment printing remain protected and out of scope.

## Snapshot inventory

The export contains 80 public table definitions, 138 public function definitions, 219 RLS policy definitions, and 153 index definitions.

Relevant objects present:

- `products`
- `product_stock_locations`
- `stock_movements`
- `stock_adjustments`
- `inventory_counts` and `inventory_count_lines`
- `stock_transfers`
- `goods_receipts` and `goods_receipt_lines`
- `pos_receipts`

These counts are counts of declarations in the supplied SQL file, not live row counts.

## Important reconciliation: no trigger DDL in this export

The exported SQL contains **zero `CREATE TRIGGER` statements** and no trigger enable/disable statements.

This means the previously documented `0064_sync_store_location_stock.sql` / `products_sync_default_location` trigger, which was reported in an earlier historical forensic snapshot, is **not verified by this export**. Do not treat it as a currently installed trigger based only on the old snapshot. Conversely, do not conclude that the trigger was definitely dropped until the export procedure and a fresh read-only catalog query of `pg_trigger` are reconciled.

**Gate:** before any migration or implementation relies on trigger behavior, verify the current production trigger catalog read-only and reconcile it with this export and the deployed migration ledger. Until then, trigger-dependent conclusions are unresolved.

## Current function bodies confirmed by the supplied snapshot

### Shared movement writer

The exported `fn_apply_stock_movement(uuid,numeric,text,text,uuid)`:

- Locks the product row.
- Checks platform-owner/property membership.
- Rejects a negative aggregate stock result.
- Updates `products.current_stock`.
- Inserts a `stock_movements` row with `source_type` and `source_id` parameters.

The function is SECURITY DEFINER with a fixed `public` search path. Its exported grants show execution for `service_role`, not `authenticated`; the wrapper `fn_adjust_product_stock` is granted to authenticated and service roles. Review all callers and wrappers individually rather than broadening grants.

### Manual adjustment

The exported `fn_post_stock_adjustment` directly mutates `product_stock_locations` for the requested location and then calls `fn_apply_stock_movement` with `source_type = 'adjustment'` and a NULL source ID.

This confirms the dual-write pattern in the exported function body. Whether an aggregate-to-location trigger also fires is unresolved because this export contains no trigger DDL.

### Inventory count approval

The exported `fn_approve_inventory_count` sets the selected location's quantity to the counted quantity, then calls `fn_apply_stock_movement` with the variance and `source_type = 'count'`, passing the count ID as source ID.

The direct location assignment and aggregate writer are both present. Their interaction must be tested only after the current trigger catalog is established.

### POS sale and recipe consumption

The exported `fn_record_pos_sale` has a 16-argument signature and:

- Checks for an existing receipt using the property/idempotency key.
- Calls `fn_consume_recipe_stock`.
- Uses `fn_apply_stock_movement` for tracked non-recipe products.
- Passes NULL source IDs for both the `pos_recipe` and `pos_sale` movements.
- Inserts the POS receipt after the inventory posting calls in the same function body.

The receipt table has a unique partial index on `(property_id, idempotency_key)`, but `stock_movements` has only a non-unique source lookup index on `(property_id, source_type, source_id)`. Receipt-level idempotency therefore does not itself give each movement a stable source/line identity.

The exported `fn_consume_recipe_stock` also passes NULL source IDs. The reversal function uses `pos_reversal` with NULL source IDs.

### Goods receiving

The exported `fn_receive_purchase_order(uuid,jsonb)` creates a fresh GRN number on each call, locks the purchase order, checks outstanding quantities, and calls the shared writer with the new GRN ID. It does not accept a stable client request key.

A repeated partial-receipt request can be treated as a new GRN while outstanding quantity remains. A stable request identity and receipt-line idempotency contract are still required.

### Transfers

The exported `fn_complete_stock_transfer` directly decrements the source location, increments the destination location, and inserts paired out/in `stock_movements` rows. Those inserts omit `source_type` and `source_id`.

The transfer is marked completed after processing its lines. Preserve its paired, aggregate-neutral semantics; do not model it as two unrelated aggregate stock adjustments.

## Access-control findings from exported grants and RLS

### Location balances

The export grants ALL table privileges on `product_stock_locations` to `authenticated` (and also lists `anon` and `service_role`). RLS is enabled. Its authenticated policies allow property members/platform owners to SELECT, INSERT, UPDATE, and DELETE location rows.

Therefore authenticated property members have direct location-balance DML through the exported table grants and policies. This can bypass a movement-ledger-only posting contract. The anon role has no corresponding location policies in this export, so its table grant alone does not establish anon access under RLS.

### Movement ledger

The export grants authenticated and anon roles SELECT-level table privileges on `stock_movements`, not direct INSERT/UPDATE/DELETE. The `stock_movements_source_idx` is non-unique; there is no exported uniqueness constraint enforcing one posting per source event/line.

### Product cost visibility

The export grants ALL table privileges on `products` to `authenticated` and `anon`, with row-level product policies but no column-specific revocation for `cost_price` found in the export. RLS controls row visibility, not individual columns. Treat cost-price confidentiality as a database/API boundary issue; browser-side masking is insufficient.

### Function authorization

The export includes many SECURITY DEFINER functions. Their grants and bodies must be reviewed one by one for property scope, caller authorization, fixed search paths, and minimum EXECUTE permissions. Do not respond to advisor warnings with blanket revocations.

## Additional schema consistency note

The exported `fn_record_pos_sale` accepts `split` as a payment method, while the exported `pos_receipts_payment_method_check` constraint lists only `cash`, `card`, `mpesa`, `bank`, and `room`. This may cause split-payment receipt insertion to fail. It is a separate POS schema consistency issue, not authorization to modify POS payment or printing flows in this inventory workstream. Track and review separately.

## Updated implementation gates

1. Reconcile this export with the exact production migration ledger and main-branch migration failure.
2. Obtain a fresh read-only catalog result for `pg_trigger`; resolve the discrepancy between this export and the historical trigger snapshot.
3. Reconcile all deployed function overloads and grants against the exported definitions.
4. Build a reproducible local/free isolated schema fixture from reconciled source; do not use the connected production/free-tier project for writes or runtime tests.
5. Design one location-aware posting owner and stable event/line idempotency for adjustment, count, POS, recipe, GRN, transfer, and import.
6. Close authenticated direct DML on location balances only in a reviewed, narrowly scoped forward migration after application callers have been migrated.
7. Enforce cost visibility at the database/API layer using explicit safe projections and separately authorized cost access.
8. Run catalog and multi-property runtime regressions, build/lint/type checks, and a second migration review before proposing rollout.

## Current decision

The export materially improves the baseline and confirms several function-body and privilege risks. It also introduces an unresolved discrepancy about trigger presence. Continue read-only reconciliation and isolated-fixture preparation. Do not write to the connected Supabase project, alter historical migrations, or propose a production migration until the trigger catalog and migration provenance are resolved.

No application code, SQL migration, database object, printer, paper-feed, ticket, receipt, unsettled-bill, cashier-printing, or payment-printing file was changed for this review.


## Live trigger catalogue verification — 6 November 2026

After detecting that the supplied SQL file contained no trigger DDL, a separate read-only query against the connected Supabase project's `pg_trigger` catalogue was run. It returned 12 non-internal triggers in `public`, including:

- `products_sync_default_location` on `products`, AFTER UPDATE OF `current_stock`.
- `products_touch` on `products`, BEFORE UPDATE.
- Other maintenance, POS modifier/device/discount, room, staff, and store triggers.

The current trigger catalogue therefore confirms that `products_sync_default_location` **is installed now**. The discrepancy is in the exported SQL artifact: it omitted all 12 trigger definitions, not in the live trigger state.

A second read-only query retrieved the live `fn_sync_product_default_location()` body. It computes the aggregate stock delta, ensures the product's default-named inventory location exists, then:
- creates a `product_stock_locations` row with the new aggregate stock if no matching row exists; or
- adds the aggregate delta to the existing default-location quantity.

This confirms the trigger's active default-location synchronization behavior. Combined with the live function bodies for `fn_post_stock_adjustment` and `fn_approve_inventory_count`, which independently mutate a selected location and then call `fn_apply_stock_movement`, the dual-write/double-delta risk is confirmed for the current live definitions, not merely historical source.

**Updated gate:** the trigger-presence question is resolved by the live catalogue query. However, the schema-only artifact is incomplete for replay purposes because it omitted trigger DDL. Obtain a corrected export that includes triggers or otherwise generate a complete, reproducible schema fixture before local replay. Keep the connected free-tier database read-only.

The live catalog and function-body checks were SELECT-only. No SQL writes, DDL, migrations, data changes, tests, or builds were performed.
