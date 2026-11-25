# Storekeeper Workspace — Phase 0 Audit

**Date:** 2026-11-23
**Repository:** `olitechpmspos/olitechpmspos-main`
**Scope:** Phase 0 inspection for requisitions, issue notes, cost centres, in-transit transfers and storekeeper roles.
**Status:** READ-ONLY. No product code, schema, route or test was changed. This is the only file created.
**Method:** repository migrations, services, routes, navigation registry, tests and the committed live-catalog forensics under `docs/audit/`. No live database was queried.

---

## 1. Executive summary

1. **No requisition, issue-note or cost-centre object exists.** `/stores/requisitions` is a `ModuleStatusPage`; the dashboard KPI says “Not configured” and the panel says the schema has no requisition entity. There is no table, RPC, service, report or queue.
2. **The wastage approval workflow named in the brief does not exist.** `fn_submit_inventory_wastage` / `fn_decide_inventory_wastage` are absent from the repository and from the live RPC snapshot. `fn_post_wastage` is post-only, and `inventory_wastage` has no status/approval columns. It cannot be reused as an approval model without first being built.
3. **Transfers are single-step and lose in-transit meaning.** `stock_transfers.status` allows only `pending/completed/cancelled`; lines are an unversioned `jsonb` array; there is no `TRF` number, dispatch step, receiver confirmation, discrepancy or overdue state.
4. **`fn_complete_stock_transfer` bypasses the shared ledger.** The live body updates `product_stock_locations` directly and inserts paired `stock_movements` with no `location_id`, `source_type`, `source_id`, `source_line_key` or idempotency key. It is idempotent only because the status moves out of `pending`.
5. **`fn_create_stock_transfer` exists live but not in the repository.** It appears in the live RPC inventory and is called by `pmsService`, but its body is not in any migration. A new migration that replaces it must reproduce or deliberately replace behaviour that is only known from the live catalog.
6. **The ledger schema is ready; the ledger *function* is not location-aware.** `stock_movements` already has `location_id`, `source_line_key`, `idempotency_key`, `unit_cost`, `reversal_of_id` and two unique indexes. But `fn_apply_stock_movement` only changes `products.current_stock` and inserts an aggregate movement. Location moves are still done by ad-hoc writers.
7. **Location posting has a double-count hazard.** The `products_sync_default_location` trigger applies every aggregate `current_stock` delta to the product’s default location. Existing adjustment/wastage/count functions write a selected location *and* call `fn_apply_stock_movement`, so the selected and default locations can both move. The committed blueprint (`docs/audit/drafts/LOCATION_AWARE_STOCK_POSTING_IMPLEMENTATION_BLUEPRINT.md`) records this and is design-only.
8. **Permissions and entitlement can be enforced server-side, but the new codes do not exist.** `fn_employee_has_permission`, `fn_employee_permission_codes`, `fn_subscription_module_allowed`, `fn_subscription_access`, `fn_property_entitlement` and `fn_assert_property_operational` are all present and already used by RPC guards. The catalog has only the seven current `stores.*` codes.
9. **The dashboard and navigation are honest but hard-coded.** The dashboard counts transfer statuses that cannot exist, reads transfers without location joins (so the list shows “Source”), and the navigation/tests assert the placeholder requisition copy.
10. **Existing transfers and store_manager users are low-risk to preserve** if the migration is additive and the aliases stay until Phase 3. The main risks are the live-only transfer creator, membership-only RLS on `stock_transfers`, and the default-location trigger.

---

## 2. Transfer flow today (end to end)

### 2.1 Routes and screens

| Surface | Route | Renderer |
|---|---|---|
| Stores | `/stores/transfers` | `POSApp initialModule="transfers" embedded workspaceModule="stores"` → `Transfers.jsx` |
| Back Office | `/backoffice/inventory/transfer-orders` | `POSApp initialModule="transfers" embedded workspaceModule="backoffice"` → the same `Transfers.jsx` |

- There is **no** `/backoffice/inventory/transfers` route. The brief’s path does not exist.
- Both routes share one component, so Phase 2 must extend that component rather than add a second screen.
- `Transfers.jsx` is a minimal single-line form: from location, to location, one product, quantity, reference; “Create Transfer”; pending rows get “Complete”.
- `pmsService.listInventoryLocations` calls `fn_ensure_inventory_locations`, which seeds `Main Store`, `Kitchen`, `Bar`, `Laundry`, `Housekeeping` and copies aggregate stock into `Main Store`.
- `pmsService.listStockTransfers` selects `stock_transfers` plus `from_location` / `to_location` names from `inventory_locations`.
- `pmsService.createStockTransfer` calls `fn_create_stock_transfer(p_property_id, p_from, p_to, p_lines, p_reference)`.
- `pmsService.completeStockTransfer` calls `fn_complete_stock_transfer(p_transfer_id)`.

### 2.2 Schema

`stock_transfers` (from `0028` / `0030`):

```sql
id uuid pk
property_id uuid
from_location_id uuid references inventory_locations
to_location_id uuid references inventory_locations
status text check (status in ('pending','completed','cancelled'))
reference text
lines jsonb not null default '[]'
created_by uuid
completed_by uuid
created_at timestamptz
completed_at timestamptz
```

Missing for Phase 2: `transfer_no`, `idempotency_key`, `dispatched_at/by`, `received_at/by`, per-line identity, dispatched/received/discrepancy quantities, discrepancy reason, and an in-transit position.

### 2.3 Live `fn_complete_stock_transfer` behaviour

From `docs/audit/PHASE2_LIVE_INVENTORY_RPC_SNAPSHOT_20261018.sql`:

- Locks the transfer row, requires platform owner or property member.
- Requires `status = 'pending'` and different source/destination.
- For each JSON line: locks `product_stock_locations` at the source, rejects if source quantity is short, decrements source, upserts destination, then inserts two `stock_movements` rows (`out` / `in`) with only `reason`, `user_id`.
- Sets `completed` / `completed_by` / `completed_at`.
- It does **not** check a Stores permission code, a dispatch/receive separation, the module entitlement, a `TRF` number, a per-line key, a cost snapshot or `fn_apply_stock_movement`.
- `stock_transfers` RLS is membership-only for select/insert/update/delete, so an authenticated property member can mutate the row directly instead of calling the RPC. This must be tightened for Phase 2.

### 2.4 Where else transfers appear

- `StorekeeperDashboard.jsx`: “Transfers in transit” KPI filters `pending`, `in_transit`, `awaiting_confirmation`, `sent`, `submitted`; “Transfers awaiting confirmation” list reads `transfer.from_location_name` / `to_location_name`.
- `storekeeperDashboardService.js`: reads `stock_transfers` with `select('*')` and **no** location join, so the two `*_location_name` fields are always undefined and the list falls back to “Source → Destination”. The KPI can only ever count `pending`.
- Tests: `src/data/modules/navigationRouting.test.js` asserts the dashboard text “Open requisitions”, “Transfers awaiting confirmation”, the placeholder copy “No requisition entity/workflow”, and the `/stores/requisitions` route.
- `docs/UNFINISHED_WORKFLOWS_ROADMAP.md` records Stores → Pending Requisitions as P1 unfinished.
- `v6/` contains a duplicate historical tree; it is not the runtime and must not be edited.

---

## 3. Ledger and location model

### 3.1 Current ledger function

Latest repository definition (`20261115055500_phase1_stock_control_foundation.sql`):

```sql
fn_apply_stock_movement(
  p_product_id uuid,
  p_change numeric,
  p_reason text,
  p_source_type text default null,
  p_source_id uuid default null
) returns products
```

Behaviour:

- Locks the product row.
- Rejects non-members.
- Returns unchanged when `track_stock = false` or `p_change = 0`.
- Applies `property_settings.negative_stock_policy` (`warn_allow` default, or `block`) against **aggregate** stock.
- Updates `products.current_stock`.
- Inserts one `stock_movements` row with `type`, `qty`, `reason`, `user_id`, `source_type`, `source_id`.

It does **not** take a location, line key, idempotency key, unit, unit cost, recipe or reversal id, and it does **not** check the Stores entitlement or a permission code (membership only).

### 3.2 Ledger columns that already exist

`20261115055500` added to `stock_movements`:

- `location_id`, `location_name_snapshot`
- `source_line_key`, `idempotency_key`
- `unit_code`, `base_qty`, `unit_cost`
- `recipe_id`, `recipe_version`, `reversal_of_id`

Unique indexes:

- `(property_id, idempotency_key)` where non-null
- `(property_id, source_type, source_id, source_line_key, product_id, type)` where source and line key are non-null

So replay protection and line identity can be enforced by the database. The posting function does not use them yet.

### 3.3 Location tables

- `inventory_locations(id, property_id, name, created_at, unique(property_id,name))`.
- `product_stock_locations(id, property_id, product_id, location_id, qty numeric check (qty >= 0), unique(product_id,location_id))`.
- `fn_ensure_inventory_locations` seeds five names and puts existing aggregate stock into `Main Store`.
- `products.location` is a text default location; the trigger `products_sync_default_location` (after update of `current_stock`) inserts/updates the matching location row by name and applies the aggregate delta.

### 3.4 The double-count hazard

Existing writers such as `fn_post_stock_adjustment`, `fn_post_wastage` and `fn_approve_inventory_count`:

1. change the selected `product_stock_locations` row directly, and
2. call `fn_apply_stock_movement`, which changes the aggregate and fires the default-location trigger.

The result can be that the selected location moves twice and/or the default location moves when it should not. The committed blueprint documents this and recommends a single location-aware posting service, a database-enforced ownership contract between the writer and the trigger, and staged retirement of the trigger. It is explicitly **design only, not executable**.

### 3.5 Consequence for Phase 1

Issue notes must post out of a source location and, for non-consuming cost centres, into a department location. That cannot be done safely by calling today’s 5-argument `fn_apply_stock_movement` alone. Phase 1 needs one of:

- **Recommended:** add an additive internal posting service that accepts location, signed quantity, source/line, idempotency and cost, and proves “selected location moves exactly once, aggregate moves once, default location net zero”. Keep the 5-argument function as a compatibility wrapper for legacy writers.
- **Fallback:** post Phase 1 issue notes aggregate-only and defer true location moves to Phase 2, which fails the stated “out of source, into department location” Phase 1 rule.

This is decision **D5** below.

---

## 4. Requisitions, issue notes and cost centres — current state

| Object | Exists? | Evidence |
|---|---|---|
| `cost_centres` | No | No table, service, screen or RPC. `stores` is an outlet/address table, not a cost centre. |
| `requisitions` / `requisition_lines` | No | No table or RPC. `/stores/requisitions` is a status page. |
| `issue_notes` / `issue_note_lines` | No | No table or RPC. |
| Approval queue | No | Dashboard says “Not configured”; no notification counters. |
| Stock consumption on issue | No | Only purchases, POS recipes, usage, wastage, adjustments, counts, production and transfers write stock. |
| Requisition-linked expense | No | No cost-centre expense tag on movements. |
| Department request screen | No | No chef/bar/housekeeping request screen. |

`inventory_locations` is the only department-like location concept. `property_settings.negative_stock_policy` is the only relevant policy switch.

---

## 5. Product eligibility, units and recipes

### 5.1 Products

`products` has (from `20261115055500`):

- `track_stock boolean not null default true`
- `stock_item_type text` nullable, constrained to `raw_ingredient`, `sub_recipe`, `finished_good`, `retail`, `consumable`
- `base_unit text not null default 'pcs'` with an FK to `inventory_units`
- existing `unit`, `current_stock`, `min_stock`, `max_stock`, `cost_price`, `location`, POS fields

There is **no** `is_composite` flag. The product UI (`Store.jsx`, `ProductTable`) does not expose `track_stock`, `stock_item_type` or `base_unit`.

### 5.2 Recipes / composite items

- Composite/“sold” items are recipes: `recipes(menu_item_name, yield_qty, active)` + `recipe_ingredients(product_id, qty)`.
- POS consumption (`fn_consume_recipe_stock`) matches the sold item by lower-cased `menu_item_name`, not by a product FK.
- Therefore “composite items” cannot be excluded by a single product column. A request-eligibility rule must combine `track_stock`, `stock_item_type`, and “not a recipe output name”.

### 5.3 Units

- `inventory_units(code, label, dimension, allows_fraction)` seeded with g/kg/mg/ml/l/each/pcs/bottle/glass.
- `inventory_unit_conversions(property_id nullable, from_unit, to_unit, factor)` seeded globally (kg↔g, l↔ml, etc.).
- No client references to the conversion table were found; no conversion UI exists.
- Quantity entry in a purchase/issue unit is technically supported by the table but needs a service/UI and base-unit conversion in the posting function.

### 5.4 Phase 1 implication

Eligibility should default to `track_stock = true` and `stock_item_type in ('raw_ingredient','sub_recipe','retail','consumable')` (including null), excluding `finished_good` and any product whose name matches an active recipe `menu_item_name`. This is decision **D4**.

---

## 6. Wastage “approval workflow” — not present

- `inventory_wastage` columns: `id, property_id, product_id, location_id, quantity, reason, expiry_date, created_by, created_at`. No status, approver, decided_at or decision note.
- `fn_post_wastage` (live snapshot) directly decrements the selected location, calls `fn_apply_stock_movement`, and inserts the wastage row as posted.
- `fn_submit_inventory_wastage` and `fn_decide_inventory_wastage` do not exist in the repository, in the live snapshot, or in any service.
- `InventoryOperations.jsx` exposes a direct “post wastage” action.

So the brief’s “reuse the wastage approval workflow as the model” cannot be followed literally. Options are decision **D8**.

---

## 7. Permissions, roles and segregation of duties

### 7.1 Server catalog and helpers

- `employee_permission_codes(code, workspace, label, sensitive, sort_order)`.
- Stores codes today: `stores.access`, `stores.inventory.view`, `stores.stock.receive`, `stores.stock.issue`, `stores.stock.transfer`, `stores.stock.adjust`, `stores.suppliers.manage`.
- Missing for this work: requisition create/view/approve/issue/receive, issue void, costs view, cost-centre manage.
- `fn_employee_permission_codes(property_id, staff_id default null)` returns all codes for owners/admins and the resolved role + grant codes for employees.
- `fn_employee_has_permission(property_id, code, staff_id default null)` is the canonical boolean guard.
- `fn_employee_workspaces` and `fn_employee_permission_summary` drive the client.
- `can_store_read` / `can_store_write` were re-pointed in `20261117130500` to package + permission codes. `can_store_write` maps categories `receive/grn/issue/transfer/adjust/adjustment/purchasing/supplier`; anything else falls back to `stores.stock.issue`. New action codes need explicit mapping or direct `fn_employee_has_permission` use.

### 7.2 Client mirror and role editor

- `src/lib/permissions.js` mirrors the catalog; `permissionsByWorkspace()` feeds the role editor.
- `src/components/employees/RolesPermissionsPanel.jsx` creates/updates `employee_roles` with permission-code arrays. New store codes appear automatically once added to both the server catalog and the mirror.
- `src/pages/Admin/Roles.jsx` (`/backoffice/employees/access-rights`) is a separate **legacy staff** surface using `STAFF_ROLES` + `assigned_modules`, not permission codes. Phase 3 should unify; Phase 1 should not silently change its semantics.
- No package-disabled permission hint exists today (a Phase 3 requirement).

### 7.3 Seeded roles

`fn_seed_employee_roles` seeds, among others:

- `Storekeeper` (workspace `store`): `stores.access, stores.inventory.view, stores.stock.receive, stores.stock.issue, stores.stock.transfer` — no costs, no approvals, no adjustments, no purchasing.
- `Store Manager` mapping is not a seeded template name in the visible block; store-manager access today largely comes from `authService` role aliases and legacy helpers.

### 7.4 Role aliases

- `src/data/modules/navArchitecture.js`: `ROLE_ALIASES` maps `store_keeper` and `storekeeper` → `store_manager`.
- `src/services/authService.js`: `normalizeStaffRole` maps both to `store_manager`, and `getDefaultModulesForRole` gives `store_manager` → `['store']`.
- Tests assert both aliases. Phase 1 must keep them; Phase 3 is where the split happens.

### 7.5 Segregation of duties

No SoD table, helper or check exists. There is no property-level toggle for “requester cannot approve”, “issuer cannot receive” or “PO creator cannot receive”. Phase 1 must add the checks in the RPCs and persist the toggle; Phase 3 generalises role templates.

---

## 8. Subscription entitlement and RLS

### 8.1 Package matrix

- `platform_package_modules`: `standard → {frontoffice,pos}`; `premium/professional → {frontoffice,pos,backoffice,store}`; `none → {}`.
- Client mirror `PACKAGE_MODULES` in `navArchitecture.js` matches.
- `getSubscriptionEntitlement` maps Stores screens to the `store` key.

### 8.2 Server evaluators

- `fn_property_entitlement(property_id)` — single evaluator.
- `fn_subscription_access(property_id, module)` → jsonb `{allowed, reason, ...}`.
- `fn_subscription_module_allowed(property_id, module)` → boolean.
- `fn_assert_property_operational(property_id)` — raises when the property may not operate.
- `fn_assert_property_row_operational` trigger is attached to a list that already includes `suppliers, products, stock_movements, stock_usage, stock_adjustments, stock_transfers, purchase_orders, goods_receipts, inventory_counts, inventory_movements, inventory_wastage, inventory_productions`.
- New requisition/issue/cost-centre tables must be added to that trigger list and must check `fn_subscription_module_allowed(...,'store')` inside their RPCs.

### 8.3 Route and API blocking for Standard

- `ProtectedRoute` uses `canUseApp` and `canAccessPath`; `canAccessApp('store_manager','stores','standard')` is false.
- `POSApp` wraps embedded modules in `PaywallGuard` with the `store` entitlement.
- `can_store_read/write` include the package check, so direct table access is blocked for Standard as well, provided new tables/RPCs follow the same pattern.

### 8.4 RLS pattern

- Existing inventory tables use membership-only policies (`is_platform_owner() OR is_member_of_property(property_id)`), not permission codes.
- New tables should either be RPC-only (revoke direct DML) or use permission-aware policies plus a property scope. Membership-only is not enough for approvals, costs and SoD.

---

## 9. Audit logging

Existing patterns:

- `audit_logs` — platform/property audit.
- `employee_access_audit` — access decisions and grants.
- `staff_logs` — module entry/PIN events.
- `pos_order_audit` — POS order changes.

There is no inventory-document audit table with before/after payloads. Recommended: a dedicated `stores_document_audit(property_id, document_type, document_id, action, actor_user_id, actor_staff_id, before jsonb, after jsonb, reason, created_at)` written by every lifecycle RPC, plus reuse of `stock_movements` for quantity history. This is decision **D10**.

---

## 10. Document numbering

An existing reusable primitive was found in `20261118120000_phase1_master_data_and_receipt_integrity.sql`:

- Table `property_document_sequences(property_id, book, prefix, next_number, updated_at)`, PK `(property_id, book)`.
- `fn_allocate_document_number(property_id, book, prefix)` inserts the row if missing, then `UPDATE ... SET next_number = next_number + 1 RETURNING next_number - 1` (row lock serialises concurrent callers) and returns `prefix || '-' || number`.

It does **not** zero-pad. Receipts rely on their existing `13-3951` style, so changing the shared formatter would alter receipt numbering. Recommended: add a Stores-specific allocator that reuses the same table but returns `PREFIX-000001` (six-digit pad), leaving `fn_allocate_document_number` untouched. Each document table still needs a unique `(property_id, <no>)` constraint. This is decision **D6**.

Gap-free guarantee: the counter increments inside the caller’s transaction, so a rollback restores it; concurrency serialises on the row. This is stricter than a PostgreSQL sequence and must be covered by a concurrency test.

---

## 11. Reports and export

- `src/services/reportDefinitions.js` defines report schemas; `stock-control` already exists.
- `src/services/reportDocumentEngine.js` renders PDF (jsPDF + autoTable) and Excel (exceljs), with audit events via `reportExportAuditCore`.
- `src/components/shared/DocumentExportMenu` / `PackExcelExportButton` are the existing export entry points.
- `inventoryService` already imports `xlsx` for product/menu exports.
- Phase 1 can add requisition-register, issues-by-cost-centre and fill-rate definitions without a new export stack.

---

## 12. UI, navigation and tests that will change

| File / area | Current state | Phase 1 impact |
|---|---|---|
| `src/routes/AppRoutes.jsx` | `/stores/requisitions` is `ModuleStatusPage`; no issue-notes or cost-centre routes | Replace placeholder; add queue/detail/issue-note/cost-centre routes |
| `src/data/modules/navArchitecture.js` | `STORES_NAV` has 7 entries, no Requisitions / Issue notes | Add one registry entry each; add Back Office cost-centre entry |
| `src/components/layout/AppShell.jsx` | Maps Stores nav ids to permission codes | Map new ids to `stores.requisition.view` etc. |
| `src/lib/permissions.js` | Seven store codes | Add the eight new codes |
| `src/components/employees/RolesPermissionsPanel.jsx` | Renders store group from mirror | New codes appear; package hint deferred to Phase 3 |
| `src/pages/StorekeeperDashboard.jsx` | “Not configured”, empty panel, transfer bug | Real counts/list/link; fix transfer location names |
| `src/services/storekeeperDashboardService.js` | `stock_transfers` `select('*')`, no joins; status filter mismatch | Join locations; add requisition counts |
| `src/services/storekeeperDashboardCore.js` | No requisition aggregation | Add count helpers |
| `src/data/modules/navigationRouting.test.js` | Asserts placeholder copy and existing routes | Update assertions; add nav uniqueness for new entries |
| `src/data/modules/navArchitecture.test.js`, `navigationSingleSource.test.mjs` | Assert storekeeper alias → store_manager | Must keep passing in Phase 1; change in Phase 3 |
| `src/pages/Store.jsx` / `ProductTable` | No `track_stock` / `stock_item_type` UI | Eligibility filter server-side first; expose flags only if approved |
| `src/components/modules/Transfers.jsx` | Single-line create/complete | Phase 2 only |
| `docs/UNFINISHED_WORKFLOWS_ROADMAP.md` | Lists requisitions as unfinished | Update when Phase 1 ships |
| `docs/STORES-WORKFLOWS.md` | Does not exist | Create with flows and permission matrix |

Also relevant: `tools/design-system/touch-targets.test.mjs` (44px targets), `design-system/.../system-ui.test.mjs` (token/contrast), and the navigation duplicate-guard tests. New screens must be tablet-first, use `--primary` `#285FE7`, and never place dark text on blue.

---

## 13. Migration and behaviour risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | `fn_create_stock_transfer` is live-only; a repo migration can silently diverge | High | Capture the live body before writing the replacement; make the new function signature-compatible; add a contract test; do not renumber applied migrations |
| R2 | `fn_complete_stock_transfer` writes stock tables directly and records no source/location/idempotency | High | Replace with dispatch/receive RPCs that use the new posting service; keep the old RPC only as a compatibility path if needed |
| R3 | Default-location trigger can double-apply a location-aware movement | High | Implement the posting service with an explicit ownership contract; test selected/default/aggregate deltas; do not drop the trigger in Phase 1 |
| R4 | `stock_transfers.status` check rejects new statuses | Medium | Additive migration that drops/recreates the check with `draft/pending/dispatched/received/partially_received/cancelled/completed`; existing `completed` stays valid |
| R5 | Existing `storekeeper` / `store_manager` users could lose access | High | Keep aliases and legacy helpers in Phase 1; Phase 3 dry-run + explicit reassignment |
| R6 | Two transfer routes share one component | Medium | Extend the shared component; do not add a second screen; keep one nav entry |
| R7 | Tests hard-code the placeholder copy and transfer statuses | Medium | Update the tests with the behaviour, not around it; keep the duplicate-guard assertions |
| R8 | Cost exposure through `products.cost_price` and the client `canSeeCost` role list | High | Server-side cost gate; omit cost columns/fields from RPCs and selects for users without `stores.costs.view`; test the API response |
| R9 | New tables/RPCs accidentally reachable by Standard | High | Package check in every RPC; add tables to the operational write trigger list; RLS tests for a Standard property |
| R10 | `stock_transfers.lines` jsonb has no line identity | Medium | New `stock_transfer_lines` table (or versioned jsonb with stable `line_key`) + backfill; keep a compatibility read path |
| R11 | No live database was queried for this audit | Medium | Before applying, compare repository function bodies to the live catalog and run the contract tests on a disposable branch |
| R12 | `stock_transfers` RLS is membership-only; direct writes bypass RPC guards | High | Tighten RLS and/or revoke direct DML; all lifecycle writes through SECURITY DEFINER RPCs |
| R13 | `inventory_wastage` has no approval state, so “reuse the wastage approval pattern” is impossible as written | Medium | See D8 |

---

## 14. Proposed Phase 1 design (for approval, not implemented)

### 14.1 Schema (all additive, property-scoped, RLS)

**`cost_centres`**

- `id`, `property_id`, `code`, `name`
- `type` check in `kitchen, bar, restaurant, housekeeping, laundry, maintenance, front_office, spa, admin, other`
- `default_location_id` → `inventory_locations` (nullable)
- `consumes_on_issue boolean not null default false`
- `approval_required boolean not null default true`
- `approval_limit numeric(14,2) not null default 0`
- `active boolean not null default true`
- unique `(property_id, code)`, unique `(property_id, name)`

Seed defaults on first use: Kitchen, Bar, Restaurant, Housekeeping, Laundry, Maintenance, Front Office, Spa, Administration. Link to the seeded inventory locations by name where they exist.

**`requisitions`**

- `id`, `property_id`, `req_no`, `cost_centre_id`, `from_location_id`
- `needed_by date`, `priority` (`low/normal/urgent`), `status` (`draft/submitted/approved/rejected/partially_issued/issued/closed/cancelled`)
- `requested_by`, `submitted_at`, `approved_by/at`, `rejected_by/at/reason`, `notes`
- `idempotency_key`, timestamps
- unique `(property_id, req_no)`, unique `(property_id, idempotency_key)` where non-null

**`requisition_lines`**

- `id`, `requisition_id`, `product_id`, `requested_qty`, `approved_qty`, `issued_qty`, `received_qty`
- `unit_id`/`unit_code`, `base_qty` (converted), `note`
- check all quantities `>= 0`; `issued_qty <= approved_qty` enforced in the RPC (not only by check, because approved can change)
- unique `(requisition_id, product_id)` (one line per product per request) unless the decision says otherwise

**`issue_notes`**

- `id`, `property_id`, `issue_no`, `requisition_id` nullable, `cost_centre_id`
- `from_location_id`, `to_location_id` nullable
- `status` (`draft/issued/in_transit/received/discrepancy/voided`)
- `issued_by/at`, `received_by/at`, `voided_by/at/reason`
- `idempotency_key`, timestamps
- unique `(property_id, issue_no)`, unique `(property_id, idempotency_key)`

**`issue_note_lines`**

- `id`, `issue_note_id`, `requisition_line_id` nullable, `product_id`
- `qty`, `unit_code`, `base_qty`, `unit_cost` snapshot, `total_cost` generated or computed
- `discrepancy_qty`, `discrepancy_reason`
- unique `(issue_note_id, product_id)` (or line key if split lines are approved)

**`cost_centre_par_templates` / `cost_centre_par_lines`** (if par templates are approved)

**`stores_document_audit`**

- `id`, `property_id`, `document_type`, `document_id`, `action`, `actor_user_id`, `actor_staff_id`, `before jsonb`, `after jsonb`, `reason`, `created_at`
- select by property members with the relevant view permission; insert only by RPCs

**`stores_settings`** (or columns on `property_settings`)

- `segregation_of_duties boolean not null default true`
- `requisition_approval_required boolean not null default true`
- `direct_issue_enabled boolean not null default true`
- `issue_discrepancy_window_hours integer`
- `transfer_overdue_hours integer` (Phase 2)
- Negative stock stays on the existing `property_settings.negative_stock_policy`.

### 14.2 Posting and lifecycle functions

All are `SECURITY DEFINER`, `set search_path=public`, and begin with:

1. `fn_assert_property_operational(property_id)`
2. `fn_subscription_module_allowed(property_id,'store')`
3. `fn_employee_has_permission(property_id, <action code>)`
4. membership/ownership of the referenced rows

Lifecycle:

- `fn_submit_requisition(p_requisition_id)` — draft → submitted; no stock.
- `fn_decide_requisition(p_requisition_id, p_lines jsonb, p_decision text, p_reason text)` — approve with per-line `approved_qty` or reject with reason; no stock.
- `fn_issue_requisition(p_requisition_id, p_lines jsonb, p_idempotency_key text)` — full or partial; creates an issue note and posts stock; updates `issued_qty`; sets `partially_issued` or `issued`.
- `fn_direct_issue(p_property_id, p_cost_centre_id, p_from_location_id, p_lines jsonb, p_idempotency_key text)` — permissioned, no requisition.
- `fn_confirm_issue_receipt(p_issue_note_id, p_lines jsonb)` — receiver confirms or records shortfall; moves the confirmed quantity into the department location or finalises consumption.
- `fn_void_issue(p_issue_note_id, p_reason text)` — reversal movements only; never edits history.
- `fn_cancel_requisition(p_requisition_id, p_reason text)`.
- `fn_approve_cost_centre` is not needed; cost centres are CRUD in Back Office with `stores.costcentre.manage`.
- Phase 2 will add `fn_dispatch_stock_transfer`, `fn_receive_stock_transfer`, `fn_resolve_transfer_discrepancy`.

Every stock-affecting call passes a stable idempotency key and a source line key. Replays return the prior result without applying quantity again.

### 14.3 Stock-effect matrix

| Event | Aggregate stock | Source location | Department/default location | Ledger | Cost |
|---|---|---|---|---|---|
| Create/submit/approve/reject requisition | none | none | none | none | none |
| Issue, consuming cost centre | −qty | −qty | none (expense tag) | one out movement with cost centre | unit cost snapshot |
| Issue, non-consuming cost centre | 0 net (if immediate move) / −qty from source at dispatch | −qty | +qty at issue (Phase 1 immediate flag) | paired out/in with transfer source | unit cost snapshot |
| Confirm receipt | 0 | 0 | confirms or adjusts department qty | discrepancy movement only if short | cost from issue |
| Void issue | +qty | +qty | −qty if already moved | reversal movements | reverses the snapshot |
| Direct issue | same as issue | same | same | same | same |

For a non-consuming issue, aggregate stock must **not** change; only the location distribution changes. That is why the location-aware posting service is required (D5). If the decision is to defer the location move, the Phase 1 flag must be explicit in the UI and reports.

### 14.4 Segregation of duties

- Requester ≠ approver.
- Storekeeper (`stores.stock.issue`) ≠ approver (`stores.requisition.approve`); the seeded Storekeeper role does not hold approve.
- Issuer ≠ receiver when the property toggle is on.
- Approval limit: if the requisition value exceeds the cost centre limit, only a user with `stores.requisition.approve` **and** the higher limit may approve (or the owner/admin).
- All checks are server-side; the UI hides actions but is not the control.
- Corrections are reversal movements; documents are never deleted.

### 14.5 Numbering

- Reuse `property_document_sequences` with books `requisition`, `issue_note`, `stock_transfer`.
- Add `fn_allocate_stores_document_number(property_id, book, prefix)` returning `REQ-000001` / `ISS-000001` / `TRF-000001`.
- Unique constraints on each document table.
- Concurrency test: N parallel allocations produce N unique, consecutive numbers.

### 14.6 Permissions to add

Server catalog + client mirror:

- `stores.requisition.create`
- `stores.requisition.view`
- `stores.requisition.approve`
- `stores.requisition.issue`
- `stores.requisition.receive`
- `stores.issue.void`
- `stores.costs.view`
- `stores.costcentre.manage`

Wire into `can_store_write`/nav maps and the role templates. Seeded defaults:

- **Storekeeper:** access, inventory view, receive, issue, transfer, requisition.view.
- **Store Manager / Head of Stores:** all stores codes including approve, costs, cost-centre manage.
- **Department Requester:** `stores.access` (or cross-workspace access), `stores.requisition.create`, `stores.requisition.view`, `stores.requisition.receive` for their cost centres.
- **Accountant / Auditor:** read + costs + reports (Phase 3).
- Owners/admins implicitly hold all codes.

### 14.7 Screens and navigation

Stores workspace:

- `/stores/requisitions` — queue with tabs/filters: Pending approval, Approved – to issue, Partially issued, Awaiting confirmation, Closed; search by number, cost centre, requester.
- `/stores/requisitions/:id` — line table, approve/reject with per-line quantities, issue with availability, audit trail.
- `/stores/issue-notes` — list and detail; print/PDF/thermal in the company style; costs only with `stores.costs.view`.
- `/stores/request-stock` — department request screen with “copy previous” and par templates (if approved).
- One `STORES_NAV` entry each for Requisitions and Issue notes.
- Remove the placeholder route and its test assertions.

Back Office:

- Cost-centre management under Store administration (route + one nav entry).
- Reports: requisition register, issues by cost centre/department/period with value, unfulfilled/unconfirmed, fill rate; Excel/PDF export.

Dashboard:

- Replace “Not configured” with real counts (pending approval, to issue, awaiting confirmation, overdue).
- Replace the empty “Open requisitions” panel with the real list.
- Fix the transfer location join so the list shows names.
- Link each item exactly once.

Department request placement is decision **D11**.

### 14.8 Audit

Every lifecycle RPC writes `stores_document_audit` with actor, action, before/after JSON and when. Stock history remains in `stock_movements` (never edited). Prints/exports can use the existing report audit pattern.

### 14.9 Test plan (Phase 1 subset)

- RLS: another property cannot read/write requisitions, lines, issue notes, cost centres, audit.
- Package: Standard property cannot call any new RPC or read any new table.
- Permission: Storekeeper cannot approve; a user without `stores.costs.view` receives no cost fields.
- SoD: requester cannot approve own requisition; issuer cannot confirm when the toggle is on.
- Ledger: submit/approve/reject change no stock; a partial issue posts once and leaves a visible backorder; void restores exactly; replay with the same idempotency key does not double-post.
- Concurrency: two simultaneous issues cannot over-issue; numbering stays unique and consecutive.
- Insufficient stock: source availability is enforced under the property policy.
- Reports: register, issues by cost centre and fill rate reconcile to `stock_movements`.
- UI: 1536×730, 1280×600, 1024×768, 768×1024, 390×844; 44px targets; AA contrast; duplicate navigation guard.

---

## 15. Proposed Phase 1 file manifest (approval gate)

New:

- `supabase/migrations/20261123xxxxxx_phase1_stores_requisitions_schema.sql`
- `supabase/migrations/20261123xxxxxx_phase1_stores_posting_service.sql`
- `supabase/migrations/20261123xxxxxx_phase1_stores_lifecycle_functions.sql`
- `supabase/migrations/20261123xxxxxx_phase1_stores_permissions_roles.sql`
- `supabase/migrations/20261123xxxxxx_phase1_stores_cost_centres_seed.sql`
- `supabase/tests/stores_requisitions_contract.test.mjs` (and/or SQL RLS tests)
- `src/services/storesRequisitionService.js`
- `src/services/storesIssueService.js`
- `src/services/storesCostCentreService.js`
- `src/services/storesDocumentService.js`
- `src/components/stores/RequisitionsQueue.jsx`
- `src/components/stores/RequisitionDetail.jsx`
- `src/components/stores/IssueNotesList.jsx`
- `src/components/stores/IssueNoteDetail.jsx`
- `src/components/stores/RequestStock.jsx`
- `src/components/stores/CostCentresPage.jsx`
- `src/components/stores/StoresDocumentPrint.jsx`
- `docs/STORES-WORKFLOWS.md`

Modified:

- `src/routes/AppRoutes.jsx`
- `src/data/modules/navArchitecture.js`
- `src/components/layout/AppShell.jsx`
- `src/lib/permissions.js`
- `src/pages/StorekeeperDashboard.jsx`
- `src/services/storekeeperDashboardService.js`
- `src/services/storekeeperDashboardCore.js`
- `src/services/reportDefinitions.js`
- `src/data/modules/navigationRouting.test.js`
- `docs/UNFINISHED_WORKFLOWS_ROADMAP.md`

Not touched in Phase 1: `src/components/modules/Transfers.jsx` (Phase 2), `authService` role split (Phase 3), Room Planner / Floor / payment colour legends, print-agent installer changes.

---

## 16. Out of scope for Phase 1

- Transfer statuses, in-transit position, receiver confirmation, discrepancies, `TRF` numbering, overdue flag and the shared transfer component — **Phase 2**.
- Splitting `storekeeper` from `store_manager`, editable role templates and the dry-run migration — **Phase 3**.
- Wastage approval workflow, unless explicitly approved in D8.
- Soft reservation of stock (off unless approved).
- Composite/production-based requisitions (excluded unless approved in D4).
- External notifications (email/SMS/WhatsApp); in-app queue counts only.
- Live database changes; no migration is applied by this audit.

---

## 17. Decisions required before Phase 1

Recommended defaults are in **bold**. Reply “approve all defaults” or name the ones to change.

| # | Decision | Options / recommendation |
|---|---|---|
| D1 | Requisition source/destination model | **A: each cost centre has a default issuing store (`from_location_id`); the store may override at issue.** B: the store always chooses the source at issue. C: the requester chooses the source. |
| D2 | `consumes_on_issue` defaults | **A: `false` for Kitchen, Bar, Restaurant (stock moves to the department location); `true` for Housekeeping, Laundry, Maintenance, Front Office, Spa, Admin (expense).** B: all `true`. C: all `false`. |
| D3 | Department issues in Phase 1 | **A: immediate source→department move with an `in_transit` flag off; in Phase 2 the same issue notes reuse the transfer engine.** B: wait for the Phase 2 in-transit engine and keep Phase 1 issues consuming-only. |
| D4 | Composite/recipe eligibility | **A: request only `track_stock = true` and `stock_item_type in (raw_ingredient, sub_recipe, retail, consumable)` or null; exclude `finished_good` and active recipe `menu_item_name` outputs.** B: allow all stock-tracked products. C: add a production-request flow now. |
| D5 | Location-aware posting foundation | **A: add an additive internal posting service in Phase 1 (location, line key, idempotency, cost) and prove selected/default/aggregate deltas; keep the 5-arg wrapper.** B: Phase 1 aggregate-only; defer true location moves to Phase 2. |
| D6 | Numbering scope and format | **A: per property, books `requisition`/`issue_note`/`stock_transfer`, six-digit pad (`REQ-000001`), reuse `property_document_sequences` with a Stores allocator.** B: per property but unpadded. C: include a property prefix. |
| D7 | Approval limits and SoD defaults | **A: approval required by default; SoD on by default; requester ≠ approver; Storekeeper cannot approve; issuer ≠ receiver.** B: approval optional per cost centre; SoD off by default. C: approval only above the limit (0 = always). |
| D8 | Wastage approval pattern | **A: do not build it in Phase 1; reuse the post-only `fn_post_wastage` and document the gap.** B: build `fn_submit_inventory_wastage` / `fn_decide_inventory_wastage` now (scope increase). C: defer to Phase 3. |
| D9 | Direct issues | **A: allow a permissioned direct issue (`stores.requisition.issue`) with a mandatory cost centre, no requisition.** B: requisition-only in Phase 1. |
| D10 | Audit storage | **A: new `stores_document_audit` with before/after JSON, written by RPCs; stock history stays in `stock_movements`.** B: reuse `employee_access_audit`. C: reuse `audit_logs`. |
| D11 | Department “Request stock” placement | **A: one shared screen at `/stores/request-stock` plus a single shortcut button in POS & F&B (kitchen/bar) and Front Office (housekeeping/maintenance); one nav entry in Stores.** B: separate POS and Front Office nav entries pointing at the same screen. C: Stores-only. |
| D12 | Par templates / soft reservation | **A: build saved par templates per cost centre; soft reservation stays off.** B: no par templates in Phase 1. C: turn soft reservation on. |
| D13 | Transfer legacy behaviour (Phase 2 prep) | **A: keep `pending/completed/cancelled` rows valid, map `completed` as-is, add new statuses additively.** B: migrate `completed` to `received` and `pending` to `draft`. C: leave the status vocabulary alone until later. |

**Stop point:** no Phase 1 work starts until these decisions are answered and the Phase 1 file manifest is approved.
