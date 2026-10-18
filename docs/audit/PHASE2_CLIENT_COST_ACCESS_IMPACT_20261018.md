# Phase 2 — Client compatibility and source mapping addendum

**Snapshot:** 2026-10-18  
**Scope:** Read-only review of committed application source and live production inventory catalog. No database writes were performed.

## Confirmed application dependencies on product cost fields

The current service-side role mask is not a database security boundary. `src/services/inventoryService.js` calls `products.select('*, supplier:suppliers(id,name)')`, then masks `cost_price` to `null` for some staff roles in JavaScript. Direct Data API queries bypass that transformation.

| Caller / path | Current dependency | Consequence for a secure migration |
|---|---|---|
| `inventoryService.listProducts()` | Reads all product columns, then masks cost in the browser based on `getSessionStaff()`. | Must stop requesting unrestricted `*`; use a safe product projection and a separately authorized cost read. Client-side role checks remain presentation only. |
| `inventoryService.createProduct()` / `updateProduct()` | Uses bulk-upsert RPC, then reads the product again using `select('*')`. | Separate safe product fields from cost fields; keep writes server-authorized and preserve non-cost product editing. |
| `fn_bulk_upsert_store_products` | Accepts `cost_price` in import rows and calls `can_store_write(property, category)` before the row mutation. | Preserve the store/category entitlement rule and add an explicit cost-write authorization rule; do not rely on column grants alone for SECURITY DEFINER RPCs. |
| `Store.jsx` | Add/edit/import flows pass `cost_price` into the bulk upsert path. | Authorized purchasing/store roles must retain intended cost editing while restricted roles cannot set or infer cost through import/update responses. |
| `components/modules/Purchasing.jsx` | Prefills a purchase line's unit cost from `product.cost_price`. | The purchasing role needs an explicit authorized cost source; do not silently turn unavailable cost into a misleading zero. |
| `components/modules/InventoryReports.jsx` | Calls `fn_inventory_valuation(property)` and renders `cost_price` and `stock_value`. | The valuation RPC must enforce tenant and cost-role authorization inside the database and return only permitted results. |

### Required implementation order for cost confidentiality

1. Define a server-owned role/action matrix for product read, cost read, cost write, valuation, purchasing, and stock mutation. Verify role names against the live property/staff schema before encoding them.
2. Add a restricted product projection or authorized product-read RPC that never returns `cost_price`; add a separate authorized cost/valuation endpoint for roles that need it.
3. Refactor every `products.select('*')` consumer on the active app surface that can expose product costs. Keep `v6/` out of scope as requested, but verify active non-`v6` callers and test them.
4. Only after call-site compatibility is demonstrated, revoke broad authenticated table SELECT and grant the minimal required columns, or adopt an equivalent database-enforced design. Column-level grants do not override an existing table-level SELECT grant.
5. Add positive and negative tests for direct table reads, RPC reads, write payloads, imports, and report responses for at least two properties and restricted/authorized roles.

## Source/live migration reconciliation status

The current production migration ledger has 38 version/name entries, but no original SQL checksums. In particular:

- `20261008123000_phase4_inventory_operations.sql` creates inventory operation tables and read policies but explicitly says the RPC bodies were deployed live; it does not contain those bodies. The live definitions captured in `PHASE2_LIVE_INVENTORY_RPC_SNAPSHOT_20261018.sql` are now available for review, but the original deployed SQL artifact is still not identified.
- `20261008120000_phase4_authoritative_inventory_ledger.sql` defines `fn_inventory_valuation` as SECURITY INVOKER and exposes `cost_price`/`stock_value` without an explicit cost-role guard. The current live function matches that unsafe design. This is a defect to correct, not a reason to replay the source migration.
- The same committed migration includes direct location writes in bulk product import and recipe usage paths. Any change to revoke client DML on `product_stock_locations` must account for privileged writers that currently mutate location rows directly.
- `fn_complete_stock_transfer` directly writes paired location balances and movement rows; `fn_post_stock_adjustment`, `fn_approve_inventory_count`, and `fn_post_wastage` write a location balance before invoking the shared movement writer. The correction must assign one transaction owner to each event and preserve transfer source/destination accounting.
- The aggregate balance probe found no product-level differences beyond the 0.001 tolerance at the snapshot time. That does not validate a location-specific adjustment/count path that may double-apply a future delta.

## Execution gate

A local PostgreSQL/Supabase runtime was not available in the current execution environment (no Docker or `psql`, and external network access is unavailable), and the existing disposable Supabase project is known not to match production's current inventory RPC signatures. Therefore this addendum is source/catalog evidence only: it does not claim that database regression tests passed, and it does not authorize a migration.

Do not merge the corrective migration or proceed to movement-time costing/workbook work until a production-equivalent test database runs the two-property authorization, direct-DML, idempotency, default/non-default location, and app compatibility suites successfully.
