# Storekeeper Workspace — Phase 2 Audit and Implementation Plan

**Date:** 2026-11-25  
**Branch:** `phase2/stores-transfers`  
**Baseline:** `main` at `91377a65`  
**Status:** implementation baseline. Phase 1 is committed and pushed; Phase 2 work starts from a clean worktree.

## 1. Scope

Phase 2 covers in-transit stock transfers only:

- Draft transfer notes with `TRF-000001` style atomic, gap-free per-property numbering.
- Dispatch confirmation as the first physical stock movement.
- Receive confirmation as the second physical stock movement.
- Line identity, short and long receipt discrepancies, overdue tracking.
- Printable transfer note and transfer register.
- Dashboard status/filter correction and one navigation entry per screen.
- Server-side STORES entitlement, role permission, property isolation, segregation of duties and audit.

No other phase is opened. No destructive refactor is authorized. `completed` remains a valid status for legacy rows.

## 2. Baseline findings

### 2.1 Current transfer schema and RPCs

`stock_transfers` was created in `0028_inventory_recipe_laundry_transfers.sql` with:

- `id`, `property_id`, `from_location_id`, `to_location_id`
- `status` limited to `pending`, `completed`, `cancelled`
- `reference`, `lines jsonb`
- `created_by`, `completed_by`, `created_at`, `completed_at`

There is no document number, expected receipt time, line table, dispatch/receive actor, discrepancy record, overdue flag or audit trail.

The live in-repo functions are in `20261123154837_storekeeper_full_stores_workspace_access.sql`:

- `fn_create_stock_transfer(uuid, uuid, uuid, jsonb, text)` checks property membership and `stores.stock.transfer`, reads source stock, then inserts a `pending` row. It changes no stock.
- `fn_complete_stock_transfer(uuid)` directly decrements `product_stock_locations`, increments the destination and inserts bare `stock_movements` rows. This bypasses the Phase 1 ledger service and must be replaced.

`src/services/pmsService.js` still calls these legacy RPCs from the browser.

### 2.2 Current transfer screen

`src/components/modules/Transfers.jsx` is a single compact component. Both routes currently render it through `POSApp`:

- `/stores/transfers`
- `/backoffice/inventory/transfer-orders`

The screen has one product line, no status filter, no line identity, no print action, no dispatch/receive separation, no discrepancy entry and no overdue view. It calls `pmsService` directly from the component tree.

### 2.3 Phase 1 primitives available for reuse

- `stock_internal.fn_stores_allocate_number(property_id, book, prefix)` allocates padded document numbers from `property_document_sequences`.
- `stock_internal.fn_stores_post_move(...)` is the canonical two-location ledger posting service. It enforces product/location property scope, quantity precision, stable source metadata and idempotency keys, and writes `stock_movements` with user, source type, source id, source line key, location names, unit code and cost.
- `stock_internal.fn_stores_assert` and `fn_stores_assert_any` enforce property membership, `store` subscription entitlement and employee permissions.
- `stock_internal.fn_stores_settings_row` exposes `stores_settings.segregation_of_duties` and `transfer_overdue_hours`.
- `stock_internal.fn_stores_notify_staff` and `fn_stores_notify_permission` write the Stores notification inbox.
- `public.stores_document_audit` provides who/what/before/after/when audit records.
- Phase 1 report definitions, `DocumentExportMenu`, `StoresReportsPage`, `StoresStatusBadge` and `StoresLayout` provide the UI/reporting patterns to follow.

### 2.4 Dashboard, navigation and permissions

- `src/services/storekeeperDashboardService.js` already joins `from_location` and `to_location` names for `stock_transfers`.
- `src/pages/StorekeeperDashboard.jsx` filters `pending`, `in_transit`, `awaiting_confirmation`, `sent` and `submitted`. The canonical new statuses will be `pending` and `in_transit`; `dispatched`, `awaiting_confirmation`, `sent` and `submitted` are not written by this phase. The filter and KPI detail need alignment, plus overdue visibility.
- `src/data/modules/navArchitecture.js` has one Stores transfer entry and one Back Office transfer entry. `PACKAGE_MODULES` correctly excludes `stores` from `standard`.
- `src/routes/AppRoutes.jsx` registers both transfer routes as `POSApp` embedded modules.
- `src/services/authService.js` has `/stores/transfers` guarded by `stores.stock.transfer`, but `/backoffice/inventory/transfer-orders` falls through to the broad `back_office.items.manage` rule. Add an explicit transfer rule before the broad one.
- `src/components/layout/AppShell.jsx` already maps `transfers` to `stores.stock.transfer`.
- `src/lib/permissions.js` does not mirror the eight Phase 1 Stores permission codes even though the database seeds them. Add the UI catalog mirror without treating it as authority.

### 2.5 Tests

- `supabase/tests/phase1_stores_requisitions_contract.test.mjs` is the source-contract test pattern.
- `src/data/modules/navigationRouting.test.js` asserts the current `POSApp` transfer route strings and will be updated deliberately.
- No migration has been applied to a live or local Postgres. Phase 2 tests are source-contract tests unless a database is explicitly provided.

## 3. Design decisions for Phase 2

| ID | Decision |
|---|---|
| D14 | A dedicated per-property `In Transit` inventory location represents stock between dispatch and receipt. Dispatch posts source → transit; receipt posts transit → destination through `fn_stores_post_move`. |
| D15 | `stock_transfer_lines` gives every line a stable UUID and line number. Legacy `lines` JSONB is kept populated with `line_id`, `product_id` and `qty` for compatibility. |
| D16 | Canonical statuses are `pending`, `in_transit`, `completed`, `discrepancy`, `cancelled`. `received` and `dispatched` remain accepted aliases; `completed` remains valid for legacy data. |
| D17 | Creation and cancellation never change stock. Dispatch and receipt are the only stock postings. |
| D18 | When receipt quantity is lower than dispatched quantity, the difference stays in the transit location and is recorded as a discrepancy for investigation. The system does not silently write an adjustment. |
| D19 | Segregation of duties compares dispatcher and receiver staff IDs when `stores_settings.segregation_of_duties` is true. Platform owners remain exempt through the existing guard pattern. |
| D20 | Overdue is derived from `expected_at` against Nairobi business time using `stores_settings.transfer_overdue_hours`; an idempotent marker RPC records notifications. |
| D21 | Legacy `fn_create_stock_transfer` and `fn_complete_stock_transfer` signatures are preserved but delegate to the new guarded ledger-backed functions. |

## 4. Files expected to change

**Migrations**

- `20261124100000_phase2_stores_transfers_schema.sql`
- `20261124101000_phase2_stores_transfer_functions.sql`
- `20261124102000_phase2_stores_transfer_legacy_compat.sql`

**Services**

- `src/services/storesService.js`
- `src/services/pmsService.js`
- `src/services/reportDefinitions.js`
- `src/services/storekeeperDashboardService.js`

**UI and routing**

- `src/components/modules/Transfers.jsx`
- `src/components/stores/StoresStatusBadge.jsx`
- `src/components/stores/StoresReportsPage.jsx`
- `src/pages/StorekeeperDashboard.jsx`
- `src/routes/AppRoutes.jsx`
- `src/data/modules/navArchitecture.js`
- `src/services/authService.js`
- `src/components/layout/AppShell.jsx`
- `src/lib/permissions.js`

**Tests and docs**

- `supabase/tests/phase2_stores_transfers_contract.test.mjs`
- `src/data/modules/navigationRouting.test.js`
- `docs/STORES-WORKFLOWS.md`

## 5. Exit checks

1. `npm run build`
2. `npm run lint`
3. `npm run typecheck`
4. `node --test supabase/tests/phase2_stores_transfers_contract.test.mjs`
5. Existing Stores, navigation and report test suites remain green.
6. Room Planner, Floor, payment colour legends and print-agent work are untouched.
7. No Phase 2 push occurs without explicit user approval.
