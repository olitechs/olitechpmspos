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


## Phase 2A — Core PMS transaction foundation

Implemented incrementally without replacing the operational Room Planner:

- Database-authoritative reservation overlap protection with per-property/room transaction locks.
- Server-side date-range available-room query for Room Rack/Planner consumers.
- Folio charge/payment writes moved behind server-side RPC validation.
- Initial reservation deposits are reconciled into the payment ledger.
- Check-in and check-out are atomic and property-scoped; check-out leaves the room dirty for housekeeping.
- Folio payments can be linked to the active cashier shift and update reservation payment status.
- Folio reads and PMS reservation reads use the TanStack Query cache instead of component-owned server collections.
- Existing joint reservations, Room Planner drag/move/group behavior, POS/KDS/printers, Cashier and Night Audit are preserved.

### Phase 2A Definition of Done

- [x] Reservation writes have database-level concurrency protection.
- [x] Room availability is date-range based using `[arrival, departure)` semantics.
- [x] Folio charge/payment mutations are property-scoped and server-validated.
- [x] Check-in/out mutations are server-authoritative.
- [x] Folio UI consumes property-scoped query state.
- [ ] Supabase migrations executed against the deployment database.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Manual Room Rack → Reservation → Check-in → Folio → Payment → Check-out regression completed.


## Phase 2B — Front Desk + Room Rack

Implemented as an additive operational layer on top of the existing PMS:

- Added `src/components/pms/RoomRack.jsx` with date-based room availability, room-type filtering, search, operational status and active guest/reservation context.
- Room Rack availability is sourced from the server-authoritative `fn_get_available_rooms` RPC; the UI does not use client-side overlap checks to declare a room bookable.
- Added direct Front Desk check-in from the Room Rack while continuing to use the existing server-authoritative check-in RPC.
- Added refresh/re-fetch behavior after check-in so room state and date availability reconcile immediately.
- Preserved Room Planner, joint reservations, Reservations, Room Management, RoomPanel, POS/KDS/printers, Cashier and Night Audit.
- No component-level Supabase calls were introduced.

### Phase 2B Definition of Done

- [x] Dedicated Front Desk Room Rack view exists.
- [x] Date-based availability comes from the database RPC.
- [x] Room operational status and active reservation context are shown together.
- [x] Check-in can be initiated from the Rack.
- [x] Existing Room Planner and reservation workflows remain available.
- [ ] Supabase migrations executed against the deployment database.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Manual Rack → reservation → check-in → folio → payment → check-out regression completed.


## Phase 2C — Front Desk reservation workflow hardening

Implemented an additive hardening pass across reservation creation and editing:

- New reservations now use database-authoritative room availability for the selected arrival/departure dates before submission.
- The Front Desk availability KPI now uses the same server availability RPC instead of client-side overlap calculations.
- Reservation edit room moves use `fn_check_room_availability` with the current reservation excluded, preventing false conflicts while still blocking real conflicts and closures.
- Reservation form channel values now match the database contract (`booking_com`, not the display label `booking.com`).
- Reservation defaults now use a valid one-night stay instead of identical arrival/departure dates.
- Payment amounts are displayed in the reservation drawer but are no longer edited directly there; payment changes remain in the Folio/Cashier ledger workflow.
- Added migration 0043 to harden server-side reservation edits and prevent `amount_paid` from drifting away from recorded payment ledger totals.
- Existing Room Planner, joint/group reservation operations, check-in/out, Folio, POS/KDS, Cashier and Night Audit are preserved.

### Phase 2C Definition of Done

- [x] Create-reservation room selection is server-authoritative.
- [x] Invalid room/date combinations are blocked before submission and still protected by the database.
- [x] Reservation room moves are server-verified before execution.
- [x] Booking.com channel value matches the database enum/validation contract.
- [x] New reservation default stay is valid.
- [x] Reservation payment ledger is protected from direct amount-paid drift during edits.
- [ ] Supabase migration 0043 executed against the deployment database.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Manual Front Desk regression completed.


## Phase 2D — Guest profile history and PMS reconciliation

Implemented additively:

- Added a property-scoped guest stay-history query so reception can inspect persisted reservation history without reconstructing it from local store state.
- Upgraded Guest List's existing View action into a profile drawer showing visit count, spend, contact/country data and reservation history.
- Kept the existing guest summary/list query and property-scoped architecture intact.
- Corrected the Front Desk meal-plan option so Bed & breakfast submits the database value bb.
- No reservation, Room Planner, POS, KDS, printer, Cashier or Night Audit workflow was removed or rewritten.

### Phase 2D Definition of Done

- [x] Guest profile history is persisted and queryable by guest/property.
- [x] Guest List can open an operational guest profile/history view.
- [x] Reservation meal-plan UI value matches the server contract.
- [ ] Supabase migrations 0041–0043 executed against the deployment database.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Full Room Rack → Reservation → Check-in → Folio → Payment → Check-out regression completed.


## Phase 2E — Running table checks / open-order lifecycle

Research-backed POS behavior applied from Loyverse, Toast, Lightspeed and hotel POS patterns:

- A table remains an **open check** across multiple ordering rounds until settlement.
- Previously fired items remain visible as historical/locked lines; later additions become a new round rather than re-firing the entire check.
- Opening a table shows recent kitchen rounds plus the complete running bill.
- The running total is calculated from the complete table order, while kitchen firing sends only newly added quantities.
- Fired quantities cannot be accidentally reduced from the active check; additional quantities can still be added.
- The existing kitchen printer/KDS workflow remains the operational source for each fired round.
- Existing settlement flow remains available for Cash, Card, M-Pesa and Room Charge; room charge continues through PMS folio validation.
- Existing persistent POS table sessions are extended with sent-line state so refreshes do not lose which items have already been fired.

Research references: Loyverse open tickets, bill printing and synchronization; Toast open/paid/closed checks; Lightspeed additional-item firing; hotel POS room-charge patterns. citeturn1search1turn1search2turn1search0turn2search11turn1search13

### Phase 2E Definition of Done

- [x] Existing table session survives reopening and displays persisted order lines.
- [x] Fired quantities are tracked separately from the live running check.
- [x] Additional rounds fire only newly added quantities.
- [x] Previously fired quantities are protected from accidental reduction.
- [x] Recent KOT rounds are visible when the table is opened.
- [x] Running bill remains visible with the complete order total.
- [x] Existing payment and room-folio settlement path preserved.
- [ ] Migration 0044 executed against deployment Supabase.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Manual multi-round table regression completed.


## Phase 2F — Open-check settlement integrity

Implemented additively on top of Phase 2E:

- Settlement is now an atomic database transaction against the persistent table session; the same open check cannot be successfully settled twice.
- POS receipts are linked to the exact table-session record, giving Cashier/Night Audit a durable check-to-receipt relationship.
- Payment allocations are persisted independently for Cash, Card, M-Pesa and Room Charge, allowing one check to be settled with multiple methods.
- Allocation totals must equal the final amount due; overpayment, underpayment and zero-value allocations are rejected server-side.
- Room Charge allocations require an authorised cashier/manager and a real active checked-in reservation in the same property; the room folio receives only the room allocation amount.
- Bill/proforma printing remains non-final; the final receipt is created only after successful settlement.
- Settlement audit events record the table session, receipt, total, allocation methods/amounts and actor.
- Existing KDS/printer, inventory deduction, Cashier shift and receipt-print retry behavior remain downstream of the authoritative settlement write.

### Phase 2F Definition of Done

- [x] Atomic open-check settlement RPC added.
- [x] Duplicate settlement protection added through table-session locking and unique receipt linkage.
- [x] Persisted multi-method payment allocations added.
- [x] Room-folio settlement remains property-scoped and checked-in-stay validated.
- [x] Split Cash/Card/M-Pesa/Room Charge allocation UI added.
- [x] Settlement audit event persisted.
- [ ] Migration 0045 executed against deployment Supabase.
- [ ] npm build/lint/typecheck pass locally.
- [ ] Manual settlement regression completed across single payment, split payment, room charge, failed print and refresh/reopen cases.
