# Stores Workflows — Phase 1 (Requisitions, Issue Notes, Cost Centres)

Status: implemented, pending deployment to a real Supabase project. All database work is **additive**; no existing table, column, policy or function is dropped.

## 1. Scope and decisions

Phase 1 covers cost centres, requisitions, issue notes, guarded lifecycle RPCs, segregation of duties, in-app notifications, Stores and Back Office screens, reports, dashboard/nav changes, tests and this document.

The approved defaults D1–D13 from `STORES-P1-AUDIT.md` are in force. The material ones:

| ID | Decision |
| --- | --- |
| D1 | Each cost centre has a default issuing store (`cost_centres.default_location_id`); Stores may override at issue time. |
| D2 | `consumes_on_issue = false` for Kitchen/Bar/Restaurant; `true` for Housekeeping/Laundry/Maintenance/Front Office/Spa/Admin. |
| D3 | Non-consuming issues move stock straight from source to the department location. The in-transit flag stays off in Phase 1. |
| D4 | The product picker offers only `track_stock = true` items, excluding `finished_good` and active recipe menu-item outputs. |
| D5 | Location-aware internal posting service added alongside the existing 5-argument `fn_apply_stock_movement` wrapper and default-location trigger. |
| D6 | Document numbers use `property_document_sequences` via `stock_internal.fn_stores_allocate_number`, padded to six digits. |
| D7 | Approval and segregation of duties on by default: requester != approver, Storekeeper template cannot approve, issuer != receiver. |
| D8 | No wastage approval workflow in Phase 1; `fn_post_wastage` remains post-only (see §14). |
| D9 | Direct issues are permissioned, require a cost centre and need no requisition. |
| D10 | `stores_document_audit` stores before/after JSON in columns named `before` and `after`. |
| D11 | One shared `/stores/request-stock` screen with shortcuts in POS & F&B and Front Office; one Stores nav entry per screen. |
| D12 | Saved par templates; soft reservation stays off. |
| D13 | Transfer statuses are added additively in Phase 2; `completed` stays valid. |

## 2. Core invariants

1. **Stock moves only when stock physically moves.** Saving, submitting, approving, rejecting, cancelling and confirming receipt do not touch stock. Only issue-note posting and voiding (a compensating posting) change balances.
2. **Every stock change goes through the ledger.** `stock_internal.fn_stores_post_movement` / `fn_stores_post_move` validate, convert units, snapshot weighted-average cost, write `stock_movements` with source metadata, an idempotency key and the acting user, and reconcile the aggregate ledger against the location projection. Reconciliation failure fails closed.
3. **Negative balances are blocked at the selected location**, even under `warn_allow`.
4. **`stock_movements.type` is only `in` / `out`.** A source-to-department move inserts a matched `out`/`in` pair; aggregate net change is zero.
5. **Server-side authority.** Subscription entitlement, permission codes, property RLS and segregation are checked in SECURITY DEFINER RPCs. Hiding a button is never the only control.
6. **Cost confidentiality.** `issue_note_lines` has no authenticated table read grant. Cost fields are returned by detail RPCs only when the caller holds `stores.costs.view`. Reports exclude costs entirely.
7. **Audit everything.** `stores_document_audit` records who, what, before/after, why and when for requisitions, issue notes, cost centres, settings and par templates.

## 3. Data model

| Table | Purpose |
| --- | --- |
| `public.stores_settings` | Per-property flags: SoD, approval requirement, direct issues, discrepancy window (48h), transfer overdue hours (24h). |
| `public.cost_centres` | Departments, default issuing store, `consumes_on_issue`, per-centre approval rule and limit. |
| `public.requisitions` | Header with `req_no`, status, priority, requester, idempotency key. |
| `public.requisition_lines` | Product, requested/approved/issued quantities, unit code. |
| `public.issue_notes` | `issue_no`, source/destination locations, issuer, receiver, void metadata, idempotency key. |
| `public.issue_note_lines` | Issued/received/discrepancy quantities, unit code, **cost snapshot columns** (RPC-gated). |
| `public.cost_centre_par_templates` / `cost_centre_par_lines` | Saved par templates per cost centre. |
| `public.stores_document_audit` | Before/after JSON audit trail. |
| `public.stores_notifications` | Per-recipient in-app inbox (no push/email subsystem exists). |

Statuses:

- Requisition: `draft`, `submitted`, `approved`, `rejected`, `partially_issued`, `issued`, `closed`, `cancelled`.
- Issue note: `draft`, `issued`, `in_transit` (reserved for Phase 2), `received`, `discrepancy`, `voided`.

Document numbers: `REQ-000001`, `ISS-000001` — atomic, gap-free per property, allocated inside the writing transaction.

## 4. Permissions and entitlement

Eight new permission codes are inserted into `employee_permission_codes` and resolved by `fn_employee_permission_codes`:

| Code | Use |
| --- | --- |
| `stores.requisition.create` | Save/submit requests; open the shared request screen. |
| `stores.requisition.view` | View requisition queues and requisition reports. |
| `stores.requisition.approve` | Approve/reject requisitions. |
| `stores.requisition.issue` | Post issue notes against requisitions or direct issues. |
| `stores.requisition.receive` | Confirm receipt; access issue notes. |
| `stores.issue.void` | Void posted issue notes. |
| `stores.costs.view` | Receive cost snapshot fields from detail RPCs. |
| `stores.costcentre.manage` | Manage cost centres and Stores settings. |

Every Stores RPC checks `fn_subscription_module_allowed(property_id, 'store')` and the relevant permission. Property isolation is enforced via RLS plus explicit `property_id` predicates. Path rules in `authService.js` gate routes client-side as a convenience; the RPCs are the authority. The Standard package cannot reach STORES routes or APIs.

Role templates are seeded/backfilled for existing system roles. Since Phase 3, `storekeeper` / `store_keeper` resolve to a distinct canonical `storekeeper` role rather than aliasing to `store_manager`. The `Storekeeper` template cannot approve, view costs, manage cost centres or view valuation (see §15).

## 5. Requisition lifecycle (no stock movement)

1. **Draft** — `fn_stores_save_requisition`. Creates or updates a `draft` requisition. Requires `stores.requisition.create`, an active cost centre and eligible lines. A repeated `idempotency_key` returns the existing document instead of creating a duplicate.
2. **Submit** — `fn_stores_submit_requisition`. `draft -> submitted`. Notifies approvers (`stores.requisition.approve`) and the requester.
3. **Decide** — `fn_stores_decide_requisition`. `submitted -> approved` or `rejected`. Lines can be partially approved (clamped to requested quantity). If `segregation_of_duties` is on, the requester cannot approve their own request. Notifies the requester and Stores issuers.
4. **Cancel** — `fn_stores_cancel_requisition`. Allowed from `draft`/`submitted` (and where no issue exists) with a mandatory reason.
5. **Issue** — see §6. Partial issues leave the requisition `partially_issued`; full issue leaves it `issued`. The requisition can be issued again up to the approved quantity.

`stores_notifications` rows are fanned out per active staff member with the target permission; `fn_stores_list_notifications` and `fn_stores_mark_notifications_read` power the inbox.

## 6. Issue-note posting (stock moves here)

`fn_stores_issue_requisition` and `fn_stores_direct_issue` require `stores.requisition.issue`.

- Validate quantity against approved/issued remaining and against on-hand at the selected source location.
- Resolve source: explicit override, else cost-centre default, else property default (`Main Store`).
- Resolve destination: consuming cost centre -> none (stock leaves the store); non-consuming cost centre -> the `inventory_locations` row named after the cost centre, created on first issue.
- For each line: convert the entered unit to the product base unit via `inventory_unit_conversions`; snapshot weighted-average cost; call `fn_stores_post_movement` (consuming) or `fn_stores_post_move` (two-location move).
- Allocate `ISS-######`, write the issue note and lines, record source metadata/idempotency key/user on each ledger row, write the audit trail, update requisition issued quantities, and notify the requester and receivers.
- Direct issues omit the requisition but still require a cost centre and the same posting service.

The client generates a UUID idempotency key per issue action; the unique index on `(property_id, idempotency_key)` plus the pre-write lookup prevents double posting on retry/replay.

## 7. Receipt and discrepancies (no stock movement)

`fn_stores_confirm_issue_receipt` requires `stores.requisition.receive`.

- Receiver records received quantity per line; shortages require a reason; over-receipt is rejected.
- `discrepancy_qty = issued - received` is stored; shorter receipts set the note to `discrepancy`, exact receipts to `received`.
- A receiver cannot be the issuer when SoD is on.
- **No ledger rows are written.** Discrepancies are recorded only and must be resolved manually (see §14).

## 8. Void (compensating stock movement)

`fn_stores_void_issue` requires `stores.issue.void` and a mandatory reason.

- Posts compensating `in`/`out` movements for each line with a distinct idempotency key.
- Decrements `requisition_lines.issued_qty`, reopening the requisition for reissue.
- Marks the note `voided` and audits the before/after state.
- A voided note cannot be voided again; already-voided notes are rejected.

## 9. Cost handling

- Weighted-average cost is snapshotted at issue time into `issue_note_lines.unit_cost` / `total_cost`.
- `stock_internal.fn_stores_can_view_costs` checks `stores.costs.view`; the issue list and detail payload builder conditionally include cost fields only when it returns true.
- The frontend renders cost columns/total only when `detail.can_view_costs` is true.
- `buildStoresIssueRegisterDefinition` explicitly excludes costs, so CSV/PDF exports never leak them.

## 10. Screens, routes and navigation

| Route | Screen | Gate |
| --- | --- | --- |
| `/stores/requisitions` | Requisition queue, detail, approve/reject/issue/cancel, `?focus=` deep link | `stores.requisition.view` |
| `/stores/request-stock` | Shared request form with par templates and product search | `stores.requisition.create` |
| `/stores/issue-notes` | Issue queue, cost-gated detail, receipt, void | `stores.requisition.receive` |
| `/stores/reports/requisitions` | Requisition and issue registers, CSV export | `stores.requisition.view` |
| `/backoffice/inventory/cost-centres` | Cost centre CRUD and Stores settings | `stores.costcentre.manage` |

- `STORES_NAV` has one entry per screen; `AppShell` maps each nav id to its permission code.
- Request-stock shortcuts are permission-gated in POS & F&B (`Dashboard.jsx`) and Front Office (`FrontOfficeDashboard.jsx`).
- Storekeeper Dashboard reads `fn_stores_dashboard` for real pending/approved/partly-issued counts and recent requisitions; the old "no requisition workflow" placeholder is gone. Transfer rows now resolve location names via a join in `storekeeperDashboardService`.

## 11. Migration order

Apply in this order; all timestamps are 2026-11-23:

1. `090000_phase1_stores_requisitions_schema.sql` — tables, indexes, RLS, grants, seed/audit helpers.
2. `091000_phase1_stores_posting_service.sql` — location resolution/projection, conversion, cost, ledger posting.
3. `092000_phase1_stores_settings_costcentres.sql` — guards, six-digit allocator, settings/cost-centre/par RPCs, notifications, location picker.
4. `092100_phase1_stores_requisition_functions.sql` — requisition lifecycle, lists, detail, product picker.
5. `092200_phase1_stores_issue_functions.sql` — issue/direct/receipt/void, cost-gated payloads.
6. `092300_phase1_stores_dashboard_notifications.sql` — dashboard counts and notification inbox.
7. `093000_phase1_stores_permissions_roles.sql` — permission codes, resolver, role templates, backfill.
8. `094000_phase1_stores_cost_centres_seed.sql` — settings/cost-centre backfill.

## 12. Frontend service

`src/services/storesService.js` is the only frontend entry point for Phase 1. Every method calls a `public.fn_stores_*` RPC; the service makes no direct table queries, so RLS bypass by the client is impossible.

## 13. Verification performed

- `node --test supabase/tests/phase1_stores_requisitions_contract.test.mjs src/data/modules/navigationRouting.test.js` — **31/31 pass**.
- `npm run build` — pass (only the pre-existing large-chunk warnings).
- `npm run lint` — pass (brand system, colour tokens, links and audit-links all pass).
- `npm run typecheck` — pass.
- `npm run test:reports` — existing report definitions still pass (unchanged behaviour).

The contract tests are source-contract tests: they assert table structure, posting paths, permission/SoD checks, idempotency, RPC wrappers, routes, navigation and cost gating. They do **not** execute SQL against a database.

## 14. Known gaps and carry-over

- No migration has been applied to a live/local Postgres; no runtime SQL verification has been performed. Apply to a staging project and run the manual acceptance checklist before production.
- **Wastage** (D8): `fn_post_wastage` remains post-only with no approval workflow. Out of Phase 1 scope.
- **Transfers** (D13): Phase 2 adds `draft/pending/dispatched/received/partially_received/cancelled` additively and keeps `completed` valid. The issue-note `in_transit` status is reserved, not used yet.
- **Discrepancy resolution** is manual; Phase 1 records the shortage but does not auto-adjust stock.
- **Roles** (Phase 3): `storekeeper` / `store_keeper` are now canonical and no longer inherit Store Manager approvals. Existing staff are not reassigned automatically; see §15.
- **Notifications** are in-app only; there is no push/email subsystem.
- Cost fields are unprotected at the database-column level but are unreachable through table grants and all RPC payloads without `stores.costs.view`.
- Existing uncommitted print-agent/installer changes were left untouched. Nothing has been pushed.

---

# Phase 2 Addendum — In-Transit Stock Transfers

Status: implemented on `phase2/stores-transfers`, pending verification/deployment. Phase 1 remains the approved baseline.

## P2.1 Decisions D14–D21

| ID | Decision |
| --- | --- |
| D14 | A dedicated per-property `In Transit` inventory location holds stock between dispatch and receipt. |
| D15 | `stock_transfer_lines` gives each line a stable UUID and line number; the legacy `lines` JSONB is kept populated for compatibility. |
| D16 | Canonical statuses are `pending`, `in_transit`, `completed`, `discrepancy`, `cancelled`; `dispatched`/`received` are accepted aliases and `completed` stays valid. |
| D17 | Creating or cancelling a transfer never changes stock. Dispatch and receipt are the only stock postings. |
| D18 | A short receipt leaves the undelivered quantity in transit and records a discrepancy; no silent adjustment is posted. |
| D19 | When `segregation_of_duties` is enabled, the dispatcher and receiver staff IDs must differ. Platform owners remain exempt through the existing guard pattern. |
| D20 | Overdue is derived from `expected_at` and `transfer_overdue_hours`; an idempotent marker records the notification once. |
| D21 | Legacy `fn_create_stock_transfer` and `fn_complete_stock_transfer` signatures delegate to the guarded, ledger-backed lifecycle. |

## P2.2 New migrations

Apply after all Phase 1 migrations:

1. `20261124100000_phase2_stores_transfers_schema.sql` — transfer columns, stable line table, RLS, audit/notification vocabulary, transit helper and `TRF` backfill.
2. `20261124101000_phase2_stores_transfer_functions.sql` — guarded list/detail/product/lifecycle RPCs, widened read-only settings and location picker.
3. `20261124102000_phase2_stores_transfer_legacy_compat.sql` — legacy transfer RPC compatibility.

Document numbers remain atomic, gap-free and per-property: `TRF-000001`, allocated through `stock_internal.fn_stores_allocate_number`.

## P2.3 Lifecycle

1. **Create** — `fn_stores_create_transfer` requires `stores.stock.transfer`, validates both locations and lines, allocates `TRF-######`, stores stable line identities and audits the creation. No stock is touched.
2. **Dispatch** — `fn_stores_dispatch_transfer` requires `stores.stock.transfer`, locks the document, posts source → `In Transit` through `stock_internal.fn_stores_post_move`, sets `expected_at`, and audits/notifies. This is the first physical stock movement.
3. **Receive** — `fn_stores_receive_transfer` requires `stores.stock.receive`, enforces staff-ID segregation, posts accepted quantities from `In Transit` → destination through the same ledger service, records per-line discrepancies, and sets `completed` or `discrepancy`.
4. **Cancel** — `fn_stores_cancel_transfer` is only valid for pending documents and never posts stock.
5. **Overdue** — `fn_stores_mark_transfers_overdue` flags expired in-transit documents once and notifies receivers.

Every ledger row carries source type `stock_transfer`, source document id, stable `dispatch:<line-id>` / `receive:<line-id>` idempotency keys, quantity, unit cost and actor. Replays are rejected by document status and idempotency uniqueness.

## P2.4 Screens, reports and dashboard

| Route | Screen | Gate |
| --- | --- | --- |
| `/stores/transfers` | Shared transfer workspace: create, filter, detail, dispatch, receive, cancel, printable note | `stores.stock.transfer` |
| `/backoffice/inventory/transfer-orders` | Same shared workspace in Back Office | `stores.stock.transfer` |
| `/stores/reports/transfers` | Transfer register with dispatch/receipt, overdue and discrepancy columns | `stores.stock.transfer` |

`src/components/modules/Transfers.jsx` calls only `storesService` RPCs; the browser never writes transfer, stock or ledger rows directly. The transfer note uses `DocumentExportMenu` and `buildStoresTransferNoteDefinition`; the register uses `buildStoresTransferRegisterDefinition`. Both registers exclude costs.

The Storekeeper dashboard now filters canonical `pending`/`in_transit`/`dispatched` transfer states, shows `TRF` document numbers, overdue and discrepancy badges, and displays ledger location snapshots. Navigation has one entry per transfer screen, and `AppShell` maps transfer nav ids to `stores.stock.transfer`.

## P2.5 Verification

Source-contract tests cover schema columns, line identity, posting paths, permissions/SoD, idempotency, legacy compatibility, RPC wrappers, routes, navigation and report definitions. Build, lint, typecheck, route/navigation and report suites must pass before hand-off. No live Postgres migration has been applied; staging verification is still required.

---

# Phase 3 Addendum — Role and authorization cleanup

## P3.1 Canonical role split

`storekeeper` and `store_keeper` normalize to canonical `storekeeper` in both client authorization (`src/services/authService.js`) and app navigation (`src/data/modules/navArchitecture.js`). `store_manager` remains valid and compatible. No employee row is silently reassigned by the migration.

Approved matrix:

| Role | Stores access |
| --- | --- |
| Storekeeper | `stores.access`, `stores.inventory.view`, `stores.stock.receive`, `stores.stock.issue`, `stores.stock.transfer`, `stores.stock.adjust`, `stores.suppliers.manage`, `stores.production.post`, `stores.requisition.view`, `stores.requisition.issue`, `stores.requisition.receive`, `stores.stock.wastage.submit` |
| Store Manager | All Storekeeper codes plus `stores.requisition.create`, `stores.requisition.approve`, `stores.issue.void`, `stores.costs.view`, `stores.costcentre.manage`, `stores.inventory.valuation.view`, `stores.stock.wastage.approve` |
| Department Requester | `stores.access`, `stores.requisition.create`, `stores.requisition.view`, `stores.requisition.receive` |
| Accountant | `back_office.access`, `back_office.reports.view`, `back_office.billing.manage`, `stores.access`, `stores.inventory.view`, `stores.costs.view`, `stores.inventory.valuation.view` |
| Auditor | `back_office.access`, `back_office.reports.view`, `stores.access`, `stores.inventory.view`, `stores.costs.view`, `stores.inventory.valuation.view` |

`stores.stock.wastage.submit` is preserved because it is an existing operational grant from the wastage workflow. It is not an approval control. Manager-only approval, costs, cost-centre management and valuation are excluded from Storekeeper.

## P3.2 Dry-run review

`public.fn_refresh_stores_role_split_review(p_property_id uuid)` refreshes `public.stores_role_split_review` for active Storekeeper/Store Manager staff. It records current role, `role_id`, assigned modules, effective permission codes, proposed canonical role and a required-action note. The function is admin/platform-owner only and performs **no** `UPDATE` or `DELETE` on `public.staff`.

Administrators review the rows first. Any reassignment requires an explicit admin action through the existing employee role update flow.

## P3.3 Templates and admin surface

Forward-only migration `20261125111000_phase3_stores_role_templates.sql` reconciles built-in templates from one function, `fn_phase3_stores_role_codes(text)`, and seeds Accountant/Auditor templates. Built-in templates can be edited in `Roles & templates`, but deletion remains blocked. Editing a built-in template requires an explicit impact confirmation and writes `employee_system_role_updated` with old/new permission codes and affected staff count.

The legacy `/backoffice/employees/access-rights` surface is preserved as a `Staff & access rights` tab inside `EmployeeConsole`. Staff creation, module assignment, PIN management and access history behavior are unchanged.

## P3.4 Package hints

The role editor displays UI-only hints when a workspace is disabled by the property package (`PACKAGE_MODULES` mapped through `WORKSPACE_TO_APP`). Hints never grant or withhold permissions; RLS and server RPCs remain the authority.

## P3.5 Verification status

Phase 3 source-contract tests cover the migration, template mirror, dry-run review, role matrix, built-in edit audit, package hints, navigation split and unified route. Live Postgres verification remains pending. No Phase 3 push, merge, tag or release is authorized without separate approval.
