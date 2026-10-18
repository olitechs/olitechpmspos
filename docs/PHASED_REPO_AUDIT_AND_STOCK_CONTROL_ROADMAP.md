# Repository Audit and Hotel Stock-Control Roadmap

**Repository:** `olitechs/olitechpmspos`  
**Planning branch:** `phase-0-repo-audit-stock-control-roadmap`  
**Base:** `main` at `126e16d07b550ab83ec9f1bb50a2e1970d40839a`  
**Status:** Planning and evidence capture only — no application code, schema, production data, or deployment changed  
**Implementation:** Not started

## Purpose

Record an evidence-led plan to inspect the full PMS/POS repository, correct navigation and route mismatches, and improve hotel stores/warehouse controls. Do not begin implementation until this plan is reviewed. Keep existing PMS, POS, booking, room-planner, printer, subscription, and staff-PIN workflows working.

## Scope and repository baseline

The current GitHub recursive tree contains 574 paths and is not truncated. The active application is Vite + React 18 + React Router + Tailwind + Supabase. The repository also contains a legacy `v6/` tree; it is out of scope for changes unless a later, explicit instruction says otherwise. Existing tests include navigation architecture/routing and service/UI tests. Existing CI scripts cover lint, typecheck, architecture tests, contrast, and Vite build; these checks do not replace browser and database regression testing.

Primary areas for the audit:
- Routing and shell ownership: `src/App.jsx`, `src/components/layout/*`, `src/components/shell/*`, `src/data/modules/navArchitecture.js`, `src/data/modules/sidebarNavigation.js`.
- Stock UI and service: `src/pages/Store.jsx`, `src/components/store/*`, `src/components/modules/Inventory*.jsx`, `src/components/modules/Purchasing.jsx`, `src/components/modules/Transfers.jsx`, `src/services/inventoryService.js`, `src/services/pmsService.js`.
- Data integrity and permissions: `supabase/migrations/*inventory*`, `*goods_receiving*`, `*store*`, `*pos_inventory*`, plus stock-related RPCs, RLS policies, triggers, and tests.
- Product/package entitlements and staff roles: `src/lib/entitlements.js`, `src/lib/FeatureGate.jsx`, auth services, route guards, and both navigation definitions.

## Initial findings from static source inspection

These are source-level observations, not claims that a production user has reproduced every defect.

| Priority | Finding | Evidence / risk | Planned response |
|---|---|---|---|
| P1 | Two navigation definitions coexist. | `navArchitecture.js` powers the workspace shell while `sidebarNavigation.js` declares a second set of labels, roles, and destinations. They can drift and show different access or route behavior. | Build one route/role/entitlement inventory, identify the active owner for each workspace, then consolidate without removing valid destinations. |
| P1 | Inventory operation routes reuse one component without clearly passing route-specific tab context. | `App.jsx` maps stock adjustments, counts, production, history, and valuation to `InventoryOperations`; that component accepts `initialTab` and defaults to `locations`. Existing route-audit documentation already flags this. | Test direct loads and in-app navigation for each path; pass explicit route context and assert the correct heading/data/actions. |
| P1 | Store Settings route may render the same default view as All Stores. | `/stores` and `/stores/settings` both target `StoresPage`; static route audit notes that both use default props. | Verify route behavior; provide explicit settings context or remove/redirect a redundant destination only after confirming intent. |
| P1 | Current stock-usage department options are incomplete for hotel operations. | `UsageForm.jsx` only offers F&B, Housekeeping, Laundry, and Bar. Requested coverage includes kitchen, restaurant, reception/front office and other hotel departments. | Replace the hard-coded subset with property-configurable departments and a safe default set; retain historical department names on existing movements. |
| P1 | Existing Excel export is product-list oriented, not a period stock-control workbook. | `ImportExport.jsx` exports products. The stock movement table shows timestamp/product/type/quantity/reason/user but not opening/closing balances, movement value, cost of usage, or monthly/day/week report filters. | Add a separate ledger/report workbook with daily, weekly and month-by-month summaries; keep product export/import intact. |
| P1 | Cost visibility and role checks are split across UI and service code. | `inventoryService.listProducts` masks `cost_price` for a short role allow-list, while UI components independently compute `showCost`, `canWrite`, and `allowed`. This can lead to inconsistent UX; server/RLS/RPC enforcement must be verified independently. | Define role/action matrix and test cost reads, writes, approvals and exports on the server as well as in the UI. |
| P1 | Inventory already has multiple ledgers, workflows and migrations. | Existing code/migrations cover stock movements, valuation, counts, adjustments, production, wastage/expiry, goods receipts and POS stock authority. Replacing them or adding parallel stock tables risks double deduction and reconciliation drift. | Map current tables/RPCs/trigger paths first; extend the authoritative ledger only after proving which posting path owns each transaction. |
| P1 | Migration history needs a source-to-live reconciliation before any database change. | Repository migrations include overlapping numeric prefixes/timestamps and comments indicating some SQL was applied live before parity files were committed. Existing audit docs record prior release/security blockers. | Treat production DB changes as blocked until exact applied SQL, migration ledger, grants, RLS, tenant guards and idempotency are verified. No production DB action is authorized by this plan. |
| P2 | Static navigation tests do not prove real route content and actions. | Existing tests inspect source text and route declarations. They can pass even when a shared component opens the wrong tab or a workflow fails at runtime. | Add focused component/service tests and browser smoke checks at desktop/tablet/mobile widths. |

## Target navigation

Keep the global workspace switcher as the top-level navigation, with one authoritative role + subscription entitlement map:
1. **Back Office** — management, finance, reports, employees, settings and approvals.
2. **Front Office** — room planner, reservations, folio, housekeeping, night audit.
3. **POS & F&B** — POS, tables/orders, kitchen display, cashier/shift reconciliation.
4. **Stores** — warehouse and stock control.

Suggested **Stores** submenu (labels may be adjusted to match existing valid routes):
- Stock overview
- Warehouse / locations
- Products and categories
- Suppliers and purchase orders
- Goods received (GRN) / incoming stock
- Stock issue / department usage
- POS consumption and direct deductions
- Transfers between warehouse, kitchen, bar and departments
- Stock counts, adjustments, wastage and expiry
- Daily / weekly / monthly stock reports
- Inventory valuation and stock history
- Store settings / departments / units

Navigation acceptance rules:
- Every visible link must resolve to the intended page; no placeholder or unrelated page behind a live label.
- Each route must select its own tab/filter explicitly, including direct URL load, refresh, back/forward, and trailing-slash paths.
- Role access and subscription entitlements must match server-side permissions; hiding a link is not authorization.
- Do not duplicate a second generic sidebar inside POS or the dedicated Room Planner layout.
- Keep platform-admin routes separate from property-level hotel navigation.

## Required stock-control behavior

### Inventory transactions and valuation
- Maintain one auditable, property-scoped source of truth for all quantity and value changes.
- Capture transaction date/time, product/SKU, unit, quantity, warehouse/location, transaction type, reference/document, department or destination, actor, notes, unit buying cost, total cost, and source link.
- Support incoming receipts, returns, transfers in/out, POS/recipe consumption, direct department deductions, wastage/expiry, production, approved count variance, and opening balance.
- Every transaction must be atomic, permission-checked, tenant-scoped, and idempotent where triggered by POS/GRN workflows. Avoid duplicate deductions on retries, voids, refunds, partial receipts, or repeated clicks.
- Show buying cost and consumption value only to authorized roles. Preserve cost history; do not silently revalue historical transactions when product cost changes.
- Determine the costing method after reviewing current valuation logic and accounting requirements. Document it and apply consistently across valuation, usage, and exports; do not introduce a second incompatible calculation.

### Departments and F&B manager sheet
Provide a configurable department list with sensible hotel defaults such as:
- Kitchen
- Restaurant
- Bar
- Housekeeping
- Laundry
- Reception / Front Office
- Maintenance / Engineering
- Spa / Wellness (optional)
- Administration / General
- Other configurable departments

The F&B manager needs a stock sheet to:
- Record incoming stock into the warehouse/outlet, including supplier, GRN/invoice reference, quantity, buying cost and receiving date.
- Record outgoing stock issued to kitchen, restaurant and bar, including department, quantities, unit cost, total issue value and recipient/reference.
- Distinguish **POS-linked consumption** (derived from posted sales/recipes) from **direct deductions/issues** (manual use, complimentary items, breakage/waste, staff meals, transfers or approved corrections).
- Reconcile physical issue against POS-derived usage without posting the same stock reduction twice.
- Filter by day, week, month, product, location, department and movement type; show opening stock, incoming, outgoing by reason, closing stock, quantity variance and cost value.

### Daily, weekly, monthly reports and Excel
- **Daily:** one stock card per product/location with opening balance, each incoming/outgoing movement, unit cost, movement value and closing balance.
- **Weekly:** calendar-week summaries with configurable week start; include daily breakdown and weekly totals.
- **Monthly:** select any month and year, including every month independently; show opening balance, receipts, transfers, POS usage, direct issues, wastage/adjustments, closing balance and cost totals. Month boundaries must not leak movements from adjacent months.
- **Excel workbook:** export a real `.xlsx` workbook (not just CSV renamed) with separate sheets for Summary, Stock Ledger, Department Usage, POS Consumption, Warehouse/Location Balances, and Valuation/Reconciliation. Include date range, property, generated-at timestamp, filters, readable column names, numeric cells, totals and formulas/values consistent with the report. Respect role-based cost visibility in both UI and exported sheets.
- Print-friendly view may be added, but Excel export is the required deliverable. Existing product import/export must continue working.

## Implementation phases and acceptance gates

### Phase 0 — Repository audit and release baseline (this branch)
**No implementation.**
- Inventory routes, components, RPCs, triggers, tables, policies, migration lineage, role/entitlement checks, and current tests.
- Build a route-to-component matrix and a stock transaction-to-ledger matrix.
- Record reproducible failures separately from suspected gaps.
- Capture current CI and establish a safe test strategy that does not modify production Supabase.
**Exit gate:** reviewed findings, reproducible baseline, known database provenance, and prioritized tickets.

### Phase 1 — Navigation and route correctness
- Consolidate route metadata and role/entitlement rules; remove drift between the workspace nav and legacy sidebar where safe.
- Fix route-specific InventoryOperations tabs and Stores Settings routing.
- Ensure Stores submenu matches the intended daily work; keep POS and Room Planner shell exceptions intact.
- Add route-level tests and browser checks.
**Exit gate:** every visible nav link resolves correctly for allowed roles; denied roles cannot reach restricted routes.

### Phase 2 — Inventory ledger and permission contract
- Document transaction types, stock quantity/cost semantics, current RPC posting path and source-of-truth.
- Reconcile duplicate/overlapping migrations and current schema before proposing any migration.
- Add regression tests for tenant isolation, roles, cost access, atomicity, idempotency, void/refund behavior and stock never silently diverging from ledger.
**Exit gate:** ledger contract and costing method agreed; isolated test environment passes; production untouched.

### Phase 3 — Warehouse receiving and stock movement workflow
- Harden supplier purchase orders, GRN/partial receipt, incoming stock, locations and transfers.
- Capture buying cost per receipt and preserve cost history.
- Add validation for units, positive quantities, partial/over-receipt and duplicate submissions.
**Exit gate:** GRN and transfer quantities/value reconcile with the authoritative ledger.

### Phase 4 — Department issues and F&B stock sheet
- Add configurable hotel departments and authorized stock issue/deduction forms.
- Implement explicit transaction reasons: POS-linked consumption, direct issue, wastage, complimentary/staff use, transfer, return and adjustment.
- Connect POS consumption to recipe/stock logic once; do not double-deduct when manual F&B records and POS sales overlap.
- Add approval/audit fields where required.
**Exit gate:** representative restaurant/bar/kitchen/housekeeping/front-office transactions reconcile exactly.

### Phase 5 — Daily, weekly and monthly stock cards
- Add date-range/month selectors and daily/weekly/monthly summaries per product, location and department.
- Calculate opening/closing balances from the ledger and value incoming/outgoing at the documented cost method.
- Add variance/reconciliation flags and historical filters.
**Exit gate:** boundary tests cover month-end, year-end, timezone, returns, transfers and corrections.

### Phase 6 — Excel workbook and print-ready reporting
- Add multi-sheet `.xlsx` export for selected day/week/month, including warehouse values in/out, buying cost, POS usage, direct deductions, departmental usage and valuation.
- Apply permission-aware columns, totals, numeric types, clear formatting and metadata.
- Keep existing product import/export backward compatible.
**Exit gate:** exported workbook totals match the on-screen report and ledger for test fixtures.

### Phase 7 — End-to-end security and regression verification
- Test Back Office, Front Office, POS, Stores, property admin, store manager and F&B manager roles.
- Run lint, typecheck, architecture tests, contrast audit, production build and database/RPC tests in isolated infrastructure.
- Browser-test route and stock flows at desktop, tablet and mobile sizes; test retries, partial receipts, void/refund and reconnect behavior.
- Review Vercel status before any promotion; deploy only after approval.
**Exit gate:** CI green, browser evidence attached, no open critical/high stock or tenant-isolation defects, and explicit release approval.

## Safety constraints

- Do not edit or deploy to `main` as part of this planning phase.
- Do not change production Supabase schema, grants, RLS, data or functions.
- Do not replace the inventory ledger or introduce duplicate stock sources before Phase 2 is accepted.
- Do not alter the legacy `v6/` tree.
- Do not remove existing PMS/POS/booking/Room Planner/printer/PIN/subscription features while arranging navigation.
- A passing build or static route test alone is not evidence that a business workflow works.

## Next action

Review this plan and the Phase 0 evidence. Once accepted, implement **Phase 1 only** on a separate implementation branch, with focused tests and a PR. Do not start stock schema changes until Phase 2's ledger and migration provenance gates are cleared.
