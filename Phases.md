# OliTechs PMS + POS — Implementation Roadmap

## Governing workflow

**AUDIT → BACKUP/BASELINE → IMPLEMENT → BUILD → TEST → FIX → VERIFY EXISTING FEATURES → COMMIT → NEXT PHASE**

Phase 0 is documentation only. No application code is authorized until all seven Phase 0 documents are approved.

---

## Phase 1 — Foundation

### Goals

- Establish Supabase as the authoritative backend for core hotel data.
- Harden authentication/session authority.
- Establish property-scoped RLS.
- Introduce a clean service/query boundary.
- Establish the approved design-system implementation contract.
- Prepare a safe migration path away from `PmsStore.jsx` and `AppStore.jsx` without breaking screens.

### Files to inspect/touch

**Authentication / security**
- `src/services/authService.js`
- `src/lib/AuthContext.jsx`
- `src/lib/AdminRoute.jsx`
- `src/lib/FeatureGate.jsx`
- `src/lib/entitlements.js`
- `src/lib/supabaseClient.js`

**Data/service**
- `src/data/PmsStore.jsx`
- `src/data/AppStore.jsx`
- `src/services/pmsService.js`
- `src/services/posService.js`
- `src/services/platformService.js`
- `src/lib/query-client.js`

**App shell/design**
- `src/App.jsx`
- `src/components/shell/Sidebar.jsx`
- `src/components/shell/TopBar.jsx`
- `src/components/shell/POSTabs.jsx`
- `src/index.css`
- `tailwind.config.js`
- `src/data/palette.js`
- `src/data/themePalette.js`

**Database**
- `supabase/migrations/0018_workspace_rls.sql`
- `supabase/migrations/0019_pms_pos_security.sql`
- `supabase/migrations/0021_effective_staff_rls.sql`
- later migrations as required by the audited dependency graph

### Definition of Done

- [ ] Auth authority comes from Supabase Auth.
- [ ] Hotel membership and role are server-authorized.
- [ ] Tenant-sensitive reads/writes pass RLS tests.
- [ ] Core services have no component-level Supabase calls.
- [ ] Query/mutation boundaries are documented.
- [ ] Existing POS/PMS UI remains functional.
- [ ] Build/lint/typecheck pass.
- [ ] No migration is renamed solely to “make numbering look clean”.

### Risks

- RLS can expose latent assumptions in existing services.
- Existing local stores contain UI behavior that can be lost in a premature rewrite.
- Duplicate migration prefixes make deployment order ambiguous.
- Existing yellow/black UI tokens differ from the proposed target design palette.

---

## Phase 2 — Core PMS

### Goals

- Make rooms, availability, reservations, check-in/out and folios database-first.
- Deliver a professional Room Rack/Planner.
- Preserve current reservation functionality while replacing the source of truth.

### Primary files

- `src/data/PmsStore.jsx`
- `src/services/pmsService.js`
- `src/components/modules/Reservations.jsx`
- `src/components/pms/RoomPlanner.jsx`
- `src/components/pms/RoomManagement.jsx`
- `src/components/pms/RoomPanel.jsx`
- `src/components/pms/Rooms.jsx`
- `src/components/modules/Folio.jsx`
- `src/components/modules/GuestList.jsx`
- `src/components/modules/Cashier.jsx`
- related `supabase/migrations/0012*` through `0016*`

### Definition of Done

- [ ] Reservation availability is server-authoritative.
- [ ] Concurrent room assignment cannot double-book.
- [ ] Check-in/out updates the correct reservation/room/folio state.
- [ ] Refresh does not erase committed reservations.
- [ ] Guest profile history is persisted.
- [ ] Folio transactions reconcile with reservation state.

### Risks

- Breaking the large `RoomPlanner.jsx`.
- Inconsistent legacy/local reservation shapes.
- Financial rounding differences between old and new code.

---

## Phase 3 — POS + Housekeeping Integration

### Goals

- Connect POS orders, payments, room charges and KDS to PMS guest/folio state.
- Make housekeeping status operationally authoritative.
- Preserve printers and persistent POS table sessions.

### Primary files

- `src/components/pos/POSContainer.jsx`
- `src/components/pos/FloorPlan.jsx`
- `src/components/pos/OrderTaking.jsx`
- `src/components/pos/BillPayment.jsx`
- `src/components/modules/KitchenDisplay.jsx`
- `src/components/modules/Housekeeping.jsx`
- `src/components/admin/Printers.jsx`
- `src/services/posService.js`
- `src/services/printerService.js`
- `supabase/migrations/0023_pos_receipts.sql`
- `0025_cashier_controls.sql`
- `0027_housekeeping_2.sql`
- `0033_pos_table_sessions.sql`
- `0036_persistent_kitchen_orders.sql`
- `0037_persistent_printer_config.sql`

### Definition of Done

- [ ] POS table sessions survive refresh.
- [ ] Orders persist before/independently of printer success.
- [ ] Room charges create traceable folio transactions.
- [ ] KDS recovers active tickets.
- [ ] Housekeeping sees authoritative room status.
- [ ] Printer failure never masquerades as transaction failure.
- [ ] Cashier reconciliation includes POS totals.

### Risks

- Duplicate charges during retries.
- Device-specific printer connectivity.
- Offline replay/idempotency.
- Cross-module status synchronization.

---

## Phase 4 — Reports, Night Audit and Advanced Features

### Goals

- Complete operational and financial reporting.
- Make Night Audit atomic and auditable.
- Expand distribution, purchasing, inventory, maintenance, guest experience and enterprise capabilities.

### Primary files

- `src/components/modules/Dashboard.jsx`
- `src/components/modules/Reports.jsx`
- `src/components/modules/NightAudit.jsx`
- `src/components/modules/Inventory.jsx`
- `src/components/modules/Purchasing.jsx`
- `src/components/modules/Recipes.jsx`
- `src/components/modules/Laundry.jsx`
- `src/components/modules/Maintenance.jsx`
- `src/components/modules/BookingEngine.jsx`
- `src/components/modules/ChannelManager.jsx`
- `src/services/inventoryService.js`
- relevant migrations from `0024*` through `0039*`

### Definition of Done

- [ ] Revenue metrics reconcile to posted financial transactions.
- [ ] Voided POS receipts are excluded from revenue.
- [ ] Night Audit cannot partially close the business date.
- [ ] Reports are property-scoped.
- [ ] Exports use authoritative data.
- [ ] Advanced features respect package entitlements and RBAC.
- [ ] Audit logs cover sensitive actions.

### Risks

- Report calculations drifting from transactional definitions.
- Legacy static data in `src/data/platformData.js`.
- Complex package/subscription rules.
- Channel/integration failures.

---

## Phase Gates

### Gate 0 — Documentation approval

- [ ] `PRD.md`
- [ ] `Architecture.md`
- [ ] `Rules.md`
- [ ] `Phases.md`
- [ ] `Design.md`
- [ ] `Memory.md`
- [ ] `AGENTS.md`

**No Phase 1 coding before all seven are approved.**

### Gate 1 — Foundation

Security and data boundaries must pass before feature refactors.

### Gate 2 — PMS

Reservation/room/folio integrity must pass before POS-to-folio integration.

### Gate 3 — Integrated Operations

PMS/POS/housekeeping/cashier workflows must pass before advanced reporting.

### Gate 4 — Production

Security, performance, accessibility, offline behavior, financial reconciliation and regression testing must pass.


### Phase 1F — Authorization boundary hardening

- Centralized route authorization predicates in `src/lib/authorization.js`.
- `/admin/*` is now strictly reserved for the OliTechs platform owner; hotel administrator/staff roles cannot enter the platform-admin surface.
- Protected hotel access now uses the centralized active-property predicate instead of duplicating status/package logic in `App.jsx`.
- Preserved the existing hotel workspace routes and existing POS/KDS/printer/Cashier/Night Audit functionality.
- Server enforcement remains authoritative through Supabase Auth, RLS and platform-owner RPC checks; these client guards are UX/routing boundaries, not security substitutes.

### Phase 1F Definition of Done

- [ ] Platform owner can reach `/admin/*`.
- [ ] Hotel administrator/staff is redirected to `/backoffice` when attempting `/admin/*`.
- [ ] Unauthenticated users are redirected to `/admin/login` for `/admin/*`.
- [ ] Active hotel users retain `/backoffice`, `/pos`, `/store`, and `/rooms` access according to existing application rules.
- [ ] No POS/KDS/printer/Cashier/Night Audit code path is rewritten.
- [ ] Build/lint/typecheck pass locally.
- [ ] Manual authorization regression is completed before Gate 1 approval.

**Status: DRAFT - Awaiting Approval**
