# Reports, Night Audit and Advanced Features — Phase 4 Audit

**Branch:** `audit/phase4-reports-night-audit`

**Baseline:** `main` at `e0aa0c217704d4ca4ba749dd8c6f3915eac35b09`

**Date:** 2026-11-27

**Status:** DRAFT — awaiting owner decisions D31–D38. No implementation is authorized by this document.

## 1. Scope and naming

This audit covers the roadmap Phase 4 in `Phases.md:160-199`:

- operational and financial reporting;
- Night Audit as a financial boundary;
- advanced inventory/purchasing/recipes/laundry/maintenance/distribution surfaces;
- package entitlements, RBAC, property scoping and audit logging for those areas.

Naming note: `Memory.md` sections 17–18 call an earlier design-token/link cleanup and architecture hygiene workstream “Phase 4/5”. Those are separate historical labels. This document refers only to the `Phases.md` roadmap phase.

The audit is read-only. No application code, workflow, package manifest, lockfile, environment file or database migration was changed.

## 2. Current baseline

The application is still hybrid. Supabase is the intended source of truth, but several Phase 4 surfaces mix live RPCs, client-derived KPIs, direct Supabase reads and configuration-only placeholders.

Good foundations already exist:

- Live reporting RPCs: `fn_management_report`, `fn_management_sales_detail`, `fn_daily_pos_summary`, `fn_recent_dashboard_activity`.
- Voided POS receipts are excluded from posted revenue in `0035_exclude_voided_pos_reporting.sql` and `0060_pos_phase4b_reporting.sql`.
- `fn_shift_report` already computes split tenders, VAT, discounts, voids, refunds and cash drawer from server data (`20261117140000_gate_folio_reversal_and_shift_report_permissions.sql:25-98`).
- Night Audit uses a single RPC set through `pmsService.js:655-677`: `fn_get_business_date`, `fn_night_audit_precheck`, `fn_run_night_audit`, `fn_night_audit_history`.
- The document export engine writes XLSX/PDF from report definitions and records an audited export (`src/components/shared/DocumentExportMenu.jsx:31-72`).
- Stores Phase 1–3 and wastage have dedicated contracts; Phase 3 role split is live in `main` and PR #244 corrected the wastage runtime fixture scope.

The problem is not a total absence of backend code. It is inconsistent definitions, incomplete adoption of authoritative endpoints, and missing verification at the financial boundary.

## 3. Findings

Severity key: **Critical** = do not rely on the path until state is verified; **High** = blocks Phase 4 Definition of Done; **Medium** = correctness/UX risk; **Low** = documentation or consistency.

### F4-01 — Critical — historical channel migration is not applyable as committed

`supabase/migrations/0031_booking_engine_channel_connectivity.sql:225` contains a literal `=======` conflict marker. The pre-marker branch also contains:

- unsupported `create policy if not exists` at `:144-151` and `:191-193`;
- an unguarded `fn_receive_channel_reservation` at `:204-212`;
- a grant of that function to `anon,authenticated` at `:222`.

A later migration, `20261115044500_restore_channel_sync_rpc_functions.sql:50-100`, replaces it with a service-role or member + connection-ownership check. Applied database state must be inventoried before assuming the safe definition is live.

**Rule:** never edit or renumber the applied `0031` file. Add a forward-only governance/correction migration only after the applied-state inventory.

### F4-02 — Critical — `0032_property_paywall.sql` has static applyability defects

`supabase/migrations/0032_property_paywall.sql:10-15` uses invalid dollar quoting, `:9,49` use unsupported `CREATE POLICY IF NOT EXISTS`, and `:32` references `s.id` although the table key is `property_id`. Entitlement authority appears to come from `0032_property_subscriptions.sql` and later engines, but this must be verified against the applied database before relying on it.

### F4-03 — High — management reporting exposes valuation without the valuation permission

`Reports.jsx:133` renders the management report, and `src/services/reportDefinitions.js:745,766` always includes inventory valuation. The route gate in `src/services/authService.js:158` requires `back_office.reports.view`, not `stores.inventory.valuation.view`.

By contrast, `InventoryReports.jsx:9,14,16` and `StorekeeperDashboard.jsx:141,252,254,260` do gate valuation. The management report/export path is therefore inconsistent with the approved Stores permission matrix.

### F4-04 — High — revenue metrics are not reconciled to posted financial transactions

The same KPI names have different definitions across migrations:

- `0060_pos_phase4b_reporting.sql:24-29` correctly filters `status='posted'` for POS revenue and excludes voids.
- `20261008170000_phase8_daily_hotel_metrics.sql:11-12` derives room revenue from reservation `rate × nights`.
- `20261008190000_phase8_reporting_management.sql:72` and `20261008200000_phase8_reporting_accuracy.sql:26` compute `pos_net = pos_gross - refunds`, omitting discounts, tax semantics and split tender allocations.
- `src/services/reportDefinitions.js:304-312,331-345` documents that item-line revenue excludes receipt-level tax/discount.

No SQL-level test proves room revenue reconciles to posted folio/payment lines, or POS net to tender settlements. This blocks Phases.md DoD “Revenue metrics reconcile to posted financial transactions”.

### F4-05 — High — Night Audit is not yet a complete hotel financial close

`fn_run_night_audit` derives `room_revenue` from `pos_receipts.payment_method='room'` (`0026_night_audit.sql:150-160`, latest gated override `20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql:951-961`). That is POS room-charge revenue, not accommodation folio revenue.

Additional gaps:

- no tax/VAT column in the `night_audits` insert (`20261117133000...:978-985`);
- split tenders live in `pos_receipt_payments` but dashboard/night-audit totals use receipt-level `payment_method`;
- revenue is attributed by receipt `created_at`, refunds/voids by adjustment `created_at`, cashier variance by shift `closed_at` (`20261117133000...:963-974`) — inconsistent business-date attribution;
- the posted accommodation RPC exists separately at `20261119120000_phase2_folio_room_charge_control.sql:15-55,429-465,489-494` and uses `nightaudit.run`, while night audit uses `back_office.reports.view` (`20261117133000...:925-931`);
- `night_audits.status` includes `failed`, but the RPC always inserts `closed`;
- no `audit_logs` row or request/idempotency key for the close.

The transaction itself is structurally atomic: `property_business_dates` is locked, blockers are rechecked, and audit insert/date advance occur in one function. The weakness is financial definition, observability and retry correlation, not a missing `BEGIN/COMMIT`.

### F4-06 — High — shift-open and variance controls diverge by code path

Two `fn_open_cashier_shift` signatures coexist:

- `20261114100000_pos_shift_opening_notes.sql:19-59`: 3-arg with notes, member-only check, one open shift per user, no audit row.
- `20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql:526-568`: 2-arg with `pos.open_shift`, one open shift per property, audit row.

`src/services/shiftService.js:50-55` sends `p_notes` only when nonblank, so note-free opens and note-bearing opens can resolve to different functions with different permissions and duplicate-shift rules.

The property cash variance threshold exists (`20261115120000_pos_cash_variance_threshold.sql:10-18`) and is loaded by `CloseShiftModal.jsx:66-68,117`, but the server hardcodes 500 (`20261117134500_enforce_shift_and_pos_action_permissions.sql:163-178`). The modal’s PIN/manager approval (`CloseShiftModal.jsx:75-105,121`) sets only local `managerApproved`; `shiftService.closeShift` sends no approval evidence (`src/services/shiftService.js:64-75`). Client approval theatre must not be treated as authority.

### F4-07 — Medium — two shift-report engines coexist and the authoritative one is unused

`fn_shift_report` is the server-authoritative report (`20261117140000...:25-98`) but no `src/` caller was found. The UI builds its report from direct Supabase reads plus `fn_cashier_shift_summary` (`shiftService.js:85-169`), and `CloseShiftModal.jsx:83-90` can substitute a locally reconstructed report for printing after a refresh failure. Treat that fallback as non-authoritative; the actual close amount still comes from the server.

### F4-08 — High — legacy `Inventory.jsx` calls methods that do not exist

`src/components/modules/Inventory.jsx:25,41,51` calls `inventoryService.listItems`, `createItem` and `adjustStock`. None exist in `src/services/inventoryService.js`. The real inventory backing is in `InventoryOperations.jsx`, `Store.jsx`, the stock ledger and the Phase 1–3 Stores migrations. The legacy screen should be repaired additively through compatibility service methods or repointed to authoritative methods; do not delete it without an approved deletion proof.

### F4-09 — High — Front Office Laundry calls a missing RPC

`src/pages/FrontOfficeLaundry.jsx:32` calls `fn_create_laundry_order_with_folio`. The only other references are `docs/adr/ADR-0004-services-only-data-access.md:47` and a source-string assertion in `supabase/tests/front_office_workspace_contract.test.mjs:31`. No migration defines it. The current string-only test gives false confidence.

### F4-10 — High — advanced direct routes bypass package gates

`POSApp.jsx:151-174` applies `RouteGuard` + `PaywallGuard`, but direct routes in `src/routes/AppRoutes.jsx:169,174,188-189,193` render advanced modules outside that shell. `src/lib/entitlements.js:45-58,77-90,112-124` has feature keys only for `inventory` and `maintenance`; there are no keys for purchasing, recipes, laundry, booking-engine or channels. `/frontoffice/channels` also resolves as the `frontoffice` workspace rather than `store` (`navArchitecture.js:62-69`).

Server-side subscription write guards cover blocked subscription states (`20261117182000_subscription_operational_write_guards.sql:72-81`) but do not enforce per-screen package or role access. Feature gates remain UX controls; database/RPC authorization stays authoritative.

### F4-11 — Medium — channel permissions are membership-only

Channel profile/mapping/queue functions in `0031` and the restored functions in `20261115044500...` check property membership or connection ownership, but no employee permission code. Inbound reservation ingestion must remain service-role-only; browser callers must not be able to fabricate channel reservations.

### F4-12 — Medium — export auditing is inconsistent and some lookups are ID-only

- Definition PDF/XLSX/print exports audit first and block download on audit failure (`DocumentExportMenu.jsx:31-72`).
- Pack formula workbooks launched by `PackExcelExportButton.jsx:17-29` and Stores CSV export (`StoresReportsPage.jsx:56-66,122-129`) do not use that audit wrapper.
- `packExportDataService.fetchByIds` filters by IDs only (`src/services/packExportDataService.js:55-84`); `getShiftReport` selects by shift ID only (`shiftService.js:85-99`). These rely entirely on RLS.
- Stores reports fetch 500 rows then filter dates client-side (`StoresReportsPage.jsx:83-107`), so older matching rows can be silently omitted.

Cost/PII handling is mostly good: report definitions include cost columns only with `showCost` (`reportDefinitions.js:360-398`), and sales workbooks omit guest phone/notes (`salesWorkbook.js:457-467`). F4-03 is the exception that must be fixed.

### F4-13 — Medium — recipe identity and maintenance transitions are split

Recipes are still created by menu-item name (`Recipes.jsx:6-8`), while authoritative composite POS consumption prefers `menu_product_id` and treats name matching as legacy fallback (`20261120090000_phase4_atomic_composite_pos_sales.sql:50-59,73-107`).

Maintenance allows any valid status, not a legal transition order (`0028_maintenance_2.sql:97-123`), and `FrontOfficeMaintenance.jsx:50` exposes all statuses directly.

### F4-14 — High — verification coverage does not match the financial boundary

- `npm run test:reports` runs only `reportDefinitions.test.mjs` and `reportDocumentEngine.test.mjs` (`package.json:16`).
- `npm run test:architecture` registers `phase1_stores_requisitions_contract.test.mjs` but omits `phase2_stores_transfers_contract.test.mjs` and `phase3_stores_role_authorization_contract.test.mjs`.
- No runtime SQL workflow was found for night audit, cashier close, void-safe reporting, revenue reconciliation, channel authorization or migration applyability.
- Runtime workflows do exist for other domains (for example `inventory-phase7-1-runtime.yml`, `phase2-folio-regression.yml`, `pos-menu-rpc-authorization.yml`), so the pattern is available to follow.

Existing store/document tests cover posted-only aggregation, cost gating, PII omission, PDF pagination, XLSX formula escaping, split tenders, voids and refunds. Those are useful but do not prove database authority.

### F4-15 — Medium — migration supersession and duplicate prefixes require governance

Function definitions are redefined several times: `fn_daily_pos_summary` (`0024` → `0035` → `0060`), `fn_management_report` (`20261008190000` → `20261008200000`), `fn_employee_permission_codes` (many times, latest `20261125111000`), and channel RPCs (`0031` → `20261115044500`). Duplicate numeric prefixes remain: `0016`, `0028`, `0032`–`0035`, `0037`, plus later timestamp duplicates.

No applied migration may be renamed or edited to make history look clean. Phase 4 needs an applied-state inventory and forward-only correction notes before any deployment claim.

### F4-16 — Low — dashboard/front-office KPI wiring is incomplete

`design-system/olitechs-pms-pos/pages/dashboard.md:6-14` requires occupancy, arrivals, departures, in-house, revenue and ADR/RevPAR in priority order, with POS secondary. `Dashboard.jsx` follows that layout using live PMS data and POS RPCs, but `src/pages/FrontOfficeDashboard.jsx:22-41,58-71` still says revenue/ADR/RevPAR feeds are not connected. Add cards only after F4-04 defines authoritative metrics.

## 4. Required decisions

| ID | Decision | Recommended answer |
|---|---|---|
| D31 | Phase 4 order | Approve 4A governance → 4B reporting → 4C night audit/shift → 4D advanced modules → 4E verification. One slice at a time. |
| D32 | Revenue definition | Room revenue comes from posted folio/payment lines; POS net comes from posted receipts with explicit tax, discount, refund, void and tender allocation handling. Report variance explicitly; never silently substitute rate × nights. |
| D33 | Night Audit authority | Treat it as a financial boundary. Gate completion on reconciliation, align `nightaudit.run` vs `back_office.reports.view`, add audit row + request key, and require authorized/audited override for blocking variance. |
| D34 | Shift approval | Server-authoritative manager approval evidence and property threshold. Remove or make clearly non-authoritative any client-only PIN screen that does not reach the RPC. Restore one canonical `fn_open_cashier_shift` signature. |
| D35 | Advanced module priority | Repair Inventory service compatibility and Laundry folio RPC first; then channel authorization/governance; then recipe linkage and maintenance transitions. BookingEngine/ChannelManager remain config-only unless separately approved. |
| D36 | Export policy | All report exports, including CSV/workbook, use one audited wrapper; explicit truncation banner when caps apply; no cost/PII unless permission permits. |
| D37 | Migration governance | Inventory applied DB state first. Never edit or renumber applied migrations. Use forward-only correction migrations and explicit deployment notes. |
| D38 | Verification | Add runtime SQL tests for night audit, reconciliation, void exclusion, channel auth, and migration applyability; register the omitted Stores contract tests in `test:architecture`. |

## 5. Proposed slices

### 4A — Governance and baseline

- Read-only applied-migration/function inventory for `0031`, `0032`, reporting, cashier, night audit, channel and stores migrations.
- Governance note: `docs/audit/PHASE4_GOVERNANCE_BASELINE.md` records duplicate prefixes, static applyability blockers, function supersession chains, and staging/production preflight SQL.
- No destructive migration edits.

### 4B — Reporting correctness and permission parity

- Permission-aware management report/export variant that withholds valuation without `stores.inventory.valuation.view`.
- Read-only reconciliation RPC returning posted receipts, folio/payment lines, refunds, voids, split allocations and variance fields.
- Shared audited export wrapper for definition PDF/XLSX, formula workbooks and CSV.
- Server-side date filtering and explicit cap banners.
- Property-scoped loaders for shift report and pack export ID lookups.

### 4C — Night Audit and shift boundary

- Define/implement the authoritative close semantics from D32/D33.
- One canonical shift-open signature; property threshold read server-side; real approval evidence passed to the close RPC.
- Audit rows for close and override; request key for ambiguous retries; `failed` status used where appropriate.
- Adopt `fn_shift_report` for display while keeping the existing print path.

### 4D — Advanced module restoration

- Add compatibility methods or repoint `Inventory.jsx` to authoritative inventory services.
- Add the missing atomic Laundry folio RPC and service call with idempotency, property scope and audit logging.
- Add feature keys/guards for direct advanced routes and correct `/frontoffice/channels` workspace mapping.
- Forward-only channel permission correction; preserve service_role webhook path and revoke browser anon access.
- Link recipes to `menu_product_id`; enforce maintenance transition order server-side.

### 4E — Verification and CI

- Runtime SQL fixtures/workflows following `inventory-phase7-1-runtime.yml`.
- Register omitted Stores tests in `test:architecture`.
- Route/permission/export tests for F4-03, F4-10 and F4-12.
- Full required verification: `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:reports`, `npm run test:architecture`.

## 6. Files expected to be touched after approval

No file is changed by this audit. Likely implementation areas:

- `src/components/modules/Reports.jsx`
- `src/components/modules/Dashboard.jsx`
- `src/components/modules/NightAudit.jsx`
- `src/components/pos/CloseShiftModal.jsx`
- `src/services/reportDefinitions.js`
- `src/services/reportingService.js`
- `src/services/shiftService.js`
- `src/services/pmsService.js`
- `src/services/inventoryService.js`
- `src/pages/FrontOfficeLaundry.jsx`
- `src/pages/FrontOfficeMaintenance.jsx`
- `src/routes/AppRoutes.jsx`
- `src/lib/entitlements.js`
- `src/data/modules/navArchitecture.js`
- new forward-only migrations under `supabase/migrations/`
- new runtime tests/fixtures under `supabase/tests/` and workflows under `.github/workflows/`

Protected files and workflows (`PmsStore.jsx`, `AppStore.jsx`, `RoomPlanner.jsx`, POS components, printer/receipt/payment flows, `AuthContext.jsx`, `AdminRoute.jsx`, `v6/`) remain out of scope unless a later approved slice proves a necessary change with regression coverage.

## 7. Risks

- Re-defining reporting/night-audit functions without reconciling live applied state can drift production further from `main`.
- A “financial close” that still uses reservation rates or receipt-level payment method would be misleading.
- Adding client approval UI without server evidence creates false authority.
- Route paywall fixes could block legitimate workspaces if workspace mapping is wrong; verify route/role matrices first.
- Runtime SQL fixtures need realistic posted receipts, folio transactions, split tenders, voids, refunds and cross-property rows.
- Any migration added here must be idempotent, additive and deployed database-before-frontend.

## 8. Approval record

This document is a read-only audit and plan. It does **not** authorize implementation, push, PR, merge, tag, release, migration execution or production deployment.

Owner approval is required for D31–D38 and for each individual slice before code changes. The required cycle remains:

**AUDIT → BACKUP/BASELINE → IMPLEMENT → BUILD → TEST → FIX → VERIFY EXISTING FEATURES → COMMIT → NEXT PHASE**
