# Unfinished Navigation and Workflow Completion Roadmap

**Baseline reviewed:** `main` at the time of this audit  
**Scope:** destinations and screens that still show a phase/status placeholder, or whose navigation label promises more than the rendered workflow provides.

This is a source-code audit and phased delivery plan. It is not a claim that every button has been browser-tested. Do not replace honest status screens with fake counts, sample records, or non-persisted actions.

## Audit findings

### Confirmed unfinished workflows

| Priority | Destination | Current behaviour | Completion target |
|---|---|---|---|
| P1 | Back Office → Reports → Employee Report (`/backoffice/reports/employees`) | Renders `ModuleStatusPage`; explicitly says the dedicated report is not implemented and points users to Timecards. | Dedicated, read-only employee attendance and labour report with date/staff/department filters, trustworthy totals, drill-down to timecards, and export. |
| P1 | Stores → Pending Requisitions (`/stores/requisitions`) | Storekeeper dashboard links to a status page. The dashboard explicitly says there is no requisition entity/workflow in the current schema. | Complete property-scoped requisition lifecycle, approval, stock issue/transfer linkage, audit trail and reporting. |
| P2 | Help Centre support escalation | `/backoffice/help` and Front Office manuals render `HelpCentre` with searchable guides. The help-centre brief says persistent support tickets, admin inbox, storage and Realtime are not implemented. | Optional persistent support request workflow, only after support ownership, notification channel and service-level expectations are confirmed. The guide library itself is already implemented. |
| P2 | Unknown Back Office settings slugs | `/backoffice/settings/:slug` falls back to generic `ModuleStatusPage`. | Known settings routes remain; unknown slugs return a proper not-found page. Do not treat arbitrary URLs as planned features. |

### Existing functionality that must be verified, not rebuilt as a placeholder

| Destination | Current source evidence | Required work |
|---|---|---|
| Back Office → POS Devices (`/backoffice/pos-devices`) | Route renders `POSDevicesPage`; component contains device listing and create/edit state. The Stores alias redirects to the Back Office route. | Audit database persistence, property scoping, permissions, validation, device lifecycle and tests. Only implement missing pieces found by tests. |
| Front Office Statistics | Dedicated `FrontOfficeStatistics` report page with occupancy, ADR/RevPAR, revenue, channels, guest origin, cancellations and forecast views. | Validate metric definitions, date boundaries, currency, empty/error states and exports. |
| Front Office Minibar, Laundry, Maintenance, Guest Requests / Transfers & Tours, Configuration, Tags, Assistance | Dedicated pages exist; the repository's open-questions record says these were implemented and backed by migrations/tests. | Regression-test workflows and permissions; do not rebuild them merely because older audit notes call them placeholders. |

### Legacy or stale references

- The old `v6/` tree contains a legacy SettingsPanel with “Coming soon” labels. It is not evidence that the current routed application still displays those controls. Keep it out of the production scope unless an active import/route is proven.
- Older `AUDIT.md` and route-inventory notes disagree with current route wiring in places (for example, Help Centre and POS Devices). Reconcile those notes against `src/routes/AppRoutes.jsx` and current component sources before acting.
- Generic unknown-settings fallback is not a real feature button and should be fixed as routing hygiene, not implemented as a feature.

## Delivery phases

### Phase 0 — Complete inventory and baseline (no business behaviour changes)
1. Search active source (not just docs or legacy `v6/`) for placeholder copy, status components, disabled buttons, TODO actions and navigation links.
2. Map each visible item to its active route, component, service, table/RPC and permission.
3. Mark each item as: implemented, partially implemented, genuinely missing, stale/legacy, or broken link.
4. Add route/component contract tests and capture the current production schema before proposing migrations.
5. Keep this roadmap and update its status as each phase is verified.

**Exit gate:** every active placeholder-like destination has an owner, evidence, and a testable completion definition.

### Phase 1 — Employee Report
1. Inspect `TimecardsPage`, employee/staff records, shift records and the existing report document engine.
2. Agree metric definitions from persisted records only (hours, attendance status, missed/late punches only where source fields support them).
3. Implement date range, employee and department filters; summary cards; employee detail rows; drill-through to Timecards.
4. Add CSV and supported PDF/XLSX exports using existing report utilities.
5. Enforce property scoping and report permissions in the data layer/RPC, not only in UI.
6. Add tests for empty ranges, overnight shifts, missing clock-out, duplicate/replayed clock events, date boundaries, unauthorized users and cross-property access.

**Exit gate:** report totals reconcile with underlying timecards/shifts; no inferred or fabricated attendance values.

### Phase 2 — Store Requisitions
1. Define request statuses and transitions: draft, submitted, approved/rejected, partially issued, issued/fulfilled, cancelled.
2. Confirm whether a requisition is store-to-store, department-to-store, or both; model source and destination locations explicitly.
3. Add additive schema, property/branch/location foreign keys, RLS, audit events and guarded RPCs.
4. Approval must be role/permission controlled and separate from request creation.
5. Issuing stock must post through the existing location-aware inventory ledger/transfer workflow; never edit aggregate stock directly.
6. Add partial fulfilment, shortages, cancellation rules, printable/exportable slips, alerts and reporting.
7. Test idempotency, concurrent approvals, insufficient stock, location mismatch, unauthorized transitions and offline/retry behaviour.

**Exit gate:** every issued quantity is traceable to a stock movement; no silent stock mutation; all requests remain property-scoped.

### Phase 3 — POS Devices verification and completion
1. Trace `POSDevicesPage` through its service/data calls and the `pos_devices` schema.
2. Verify create, edit, deactivate/reactivate, device code uniqueness, terminal assignment and last-seen/status semantics.
3. Confirm each operation is permission-gated and property-scoped in the database.
4. Add tests for duplicate device codes, cross-property reads/writes, stale/offline devices and concurrent edits.
5. Implement only the missing lifecycle pieces. Do not replace the current page or assume it is a blank placeholder.

**Exit gate:** device records persist and cannot be read or modified across properties; UI status accurately reflects available telemetry.

### Phase 4 — Help Centre support escalation (decision-dependent)
1. Keep the existing searchable how-to guide library.
2. Confirm who receives support tickets, which channel is official, who can view/respond, and expected response times.
3. If confirmed, add property-scoped ticket records, attachments/storage with limits, status history, admin inbox, notifications and Realtime updates.
4. Enforce requester/admin access with RLS; protect attachments and avoid exposing staff/guest personal data.
5. If no staffed support process exists, keep guides and a clear contact route; do not ship a fake ticket submission form.

**Exit gate:** every submitted request reaches an accountable inbox and has a visible status/history.

### Phase 5 — Navigation and settings hygiene
1. Keep only settings slugs with implemented pages in the active settings navigation.
2. Replace unknown-slug status fallback with PageNotFound.
3. Check every internal link against the route table and expected page identity.
4. Test direct URL, refresh, back/forward, role/package access and desktop/mobile shell rendering.

**Exit gate:** no visible navigation item leads to a generic placeholder or dead route.

### Phase 6 — Release and regression
1. Run focused unit/contract tests and the full available test/build suite.
2. Review SQL migrations for additive safety, RLS, permissions, idempotency and rollback strategy.
3. Apply migrations only after review and with explicit production safeguards.
4. Verify POS checkout, shift open/close, receipts, printer routing, room/reservation/folio workflows and inventory posting remain intact.
5. Deploy and confirm the production deployment is READY before calling a phase complete.

## Global implementation constraints

- Preserve working workflows; prefer additive, narrowly scoped changes.
- Keep `business_id`, `branch_id`, `property_id` and stock-location scoping consistent with the existing data model.
- Use existing service/report/print abstractions where suitable; do not introduce a second data-access pattern.
- Never manufacture metrics, inventory, employee activity or device status.
- Do not remove the default inventory-location trigger until every stock writer has been migrated and regression-tested.
- Do not create paid infrastructure or a new Supabase project/branch without checking cost and obtaining approval.
- A phase is complete only after source, tests, database/security behaviour and deployment have been verified.
