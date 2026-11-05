# OliTechs — End-to-End Workflow Catalogue

This catalogue describes the intended operational journeys and points to the current implementation. It is a product/workflow contract, not proof that every step is fully implemented in production. Use the feature-status audit and source code to verify exact coverage before modifying a workflow.

## 1. Actors and responsibility

| Actor | Main responsibilities |
|---|---|
| Guest / booker | Enquiry, booking details, arrival and payment communication |
| Receptionist | Guest lookup, reservations, room allocation, check-in/out, folio |
| Front-office supervisor | Overrides, room moves, rate/folio approvals and operational review |
| Housekeeper | Cleaning assignments, room status, inspection and discrepancy reporting |
| Waiter / POS operator | Tables, orders, KOT, guest bill and room-charge request |
| Kitchen / bar staff | Production ticket acknowledgement and preparation status |
| Cashier | Payment collection, receipt, cash shift and reconciliation |
| Storekeeper | Purchase receiving, transfers, counts and stock movements |
| Manager | Operational overview, approvals, audit and reporting |
| Property administrator | Property configuration, users, roles, rates, outlets and integrations |
| Platform operator | Property approval, package/entitlement and platform administration |

## 2. Platform and property onboarding

**Journey:** public website → registration → identity → property application → platform review → active property → owner workspace.

1. Visitor opens the public site and registers or signs in.
2. Supabase Auth establishes the user identity.
3. The onboarding service creates/links the profile and property application through the configured backend process.
4. The user sees pending approval if the property is not yet active or has no package.
5. A platform operator reviews the application and assigns the appropriate property status/package/owner.
6. The owner signs in again or refreshes the session context.
7. Route guards resolve property membership, role and package entitlements.
8. The owner enters only the permitted workspaces.

**Relevant code:** `src/App.jsx`, `src/lib/AuthContext.jsx`, `src/services/authService.js`, `src/services/platformService.js`, `src/lib/AdminRoute.jsx`, platform admin pages and Supabase platform migrations.

**Failure paths:** duplicate application, rejected/pending property, missing package, expired session, unauthorized platform route, RPC/RLS denial.

## 3. Staff access and workspace routing

1. A property administrator creates or invites a staff member using the supported staff workflow.
2. The staff identity is associated with the correct property.
3. An authorized role and workspace entitlements are assigned.
4. The staff member signs in.
5. The app loads identity, property membership and staff context.
6. The route/navigation layer presents allowed workspaces.
7. Sensitive actions are checked again by the backend/RPC, regardless of what the UI displays.

**Relevant code:** `src/services/authService.js`, `src/lib/AuthContext.jsx`, `src/data/modules/navArchitecture.js`, `src/lib/FeatureGate.jsx`, `src/lib/entitlements.js`, staff admin components and RLS/RPC migrations.

**Invariant:** a hidden navigation item is not security. The server must independently authorize every sensitive action.

## 4. Reservation lifecycle

1. Search existing guest by name, phone or booking reference.
2. Create or select the guest profile.
3. Enter arrival/departure dates, occupancy, room type/room, rate, channel, meal plan and notes.
4. Request availability for the requested stay.
5. Submit the reservation through the PMS service.
6. Database logic validates tenant scope, room/date overlap and business constraints atomically.
7. On success, return the persisted reservation and refresh the room planner/arrival list.
8. On conflict, display the conflict and reload availability; never silently assign the room.
9. Changes/cancellations are authorized and recorded according to the supported audit behavior.

**Relevant code:** `src/components/modules/Reservations.jsx`, `src/components/pms/RoomPlanner.jsx`, `src/data/PmsStore.jsx`, `src/services/pmsService.js`, room planner migrations and reservation concurrency tests.

**Invariant:** stay interval is `[arrival, departure)`; checkout date is not an occupied night. Database is the final double-booking protection.

## 5. Pre-arrival, check-in and in-house

1. Reception reviews arrivals and reservation status.
2. Verify guest details, dates, room assignment, occupancy and special requests.
3. Verify room readiness with housekeeping.
4. Complete the authorized check-in operation.
5. Persist the reservation/room state through the PMS service/database.
6. Refresh room rack and in-house list.
7. During stay, add permitted room/service/POS charges to the correct guest folio.
8. Room move/date/rate amendments must preserve the history and update related state safely.

**Relevant code:** PMS room planner, reservation and guest modules, `PmsStore.jsx`, `pmsService.js`, folio components and room planner migrations.

## 6. Housekeeping and maintenance

1. Housekeeping reviews room assignments/status.
2. Staff accept or begin cleaning task.
3. Room status is updated to the relevant cleaning state.
4. Staff complete cleaning and submit for inspection where required.
5. Supervisor inspects and approves readiness.
6. Room becomes eligible for assignment only when its status and maintenance constraints permit it.
7. Maintenance issue can mark a room unavailable/out-of-order until resolved.

**Relevant code:** `src/components/modules/Housekeeping.jsx`, `src/components/modules/Maintenance.jsx`, PMS state/service and housekeeping/maintenance migrations.

**Invariant:** booking occupancy and physical room readiness are separate dimensions. Never infer a clean room solely from an empty reservation slot.

## 7. Restaurant / bar POS and kitchen

1. POS operator selects outlet, service zone and table.
2. Open or resume the table session.
3. Add menu items, modifiers and quantities.
4. Validate prices, taxes and permissions using the configured rules.
5. Persist order/session through POS service.
6. Send production ticket to KDS and/or configured printer route.
7. Kitchen/bar acknowledges and updates preparation status.
8. Waiter serves items; more items may be added to the open session.
9. Request bill and verify order lines/totals.
10. Settle by supported method or request a guest folio room charge.
11. Persist receipt/payment/folio transaction and close the table session after successful authoritative settlement.
12. Update configured stock movements and reporting.

**Relevant code:** `src/components/pos/`, `src/data/AppStore.jsx`, `src/services/posService.js`, `src/components/modules/KitchenDisplay.jsx`, cashier/receipt modules and POS migrations.

**Invariants:** retries must not duplicate orders or charges; printing is not the payment authority; a printer failure must not cause the operator to repeat a committed sale blindly.

## 8. Folio, cashier and settlement

1. Retrieve the correct guest/reservation folio.
2. Review room charges, POS room charges, payments and adjustments.
3. Post charges/payments only through authorized operations.
4. Confirm payment status using trusted server/provider confirmation.
5. Preserve receipt and transaction identifiers.
6. Apply approved correction/reversal workflow if a posted transaction is wrong.
7. At checkout, reconcile the balance and record the final settlement.
8. Cashier reviews cash/card/mobile-money totals, expected cash and over/short differences.

**Relevant code:** `src/components/modules/Folio.jsx`, `Cashier.jsx`, `Receipts.jsx`, `src/services/posService.js`, `pmsService.js` and relevant folio/cashier/receipt migrations.

**Invariants:** immutable transaction history, idempotent payment processing, integer minor-unit money and no unverified offline payment success.

## 9. Night audit and business date

1. Authorized staff opens the audit for the active business date.
2. System checks unsettled cashier sessions and operational blockers.
3. Review room revenue, POS revenue, taxes, payments, voids and reconciliation totals.
4. Resolve discrepancies or request an authorized override with an audit trail.
5. Run the supported close/rollover operation.
6. Database commits the business-date transition atomically.
7. Reports and next-day operational lists use the new business date.

**Relevant code:** `src/components/modules/NightAudit.jsx`, cashier/reporting services and `supabase/migrations/0026_night_audit.sql`.

**Invariant:** never mark the audit complete if a blocking reconciliation step failed; never partially advance the business date.

## 10. Inventory and purchasing

1. Configure products, units, categories, suppliers and store locations.
2. Create purchase order with quantities and expected cost.
3. Receive goods and confirm actual delivered quantities.
4. Record receipt and stock movement.
5. Transfer/count/adjust stock through authorized actions.
6. POS sales or recipe production consume configured ingredients.
7. Review balances, movement history, stock valuation and reorder requirements.

**Relevant code:** `src/services/inventoryService.js`, inventory/purchasing/recipe modules, inventory migrations and `tools/inventory/` tests.

**Invariant:** stock movement is auditable and location-scoped. A browser-side balance edit is not a secure stock transaction.

## 11. Printing and device workflow

1. Configure a printer and its purpose (receipt, bill, order, kitchen, etc.).
2. For LAN printers, run the Print Agent on a workstation with access to the printer.
3. Verify the local agent health endpoint.
4. Test printer connectivity and print a test receipt.
5. Route the correct document/order to the assigned printer.
6. Record print result/error and allow a safe retry without duplicating the underlying financial transaction.

**Relevant code:** `src/services/printerService.js`, `src/services/printService.js`, `tools/print-agent/`, `docs/PRINT_AGENT_SETUP.md`.

**Invariant:** saved configuration is not proof of a connected printer. A socket accepting bytes is not proof paper physically printed.

## 12. Reporting and management review

1. Select property and reporting period under the current user's authorized scope.
2. Fetch authoritative persisted records through service/query boundaries.
3. Apply business-date, void/refund and tax rules consistently.
4. Present occupancy, arrivals/departures, sales, inventory, cashier and financial metrics.
5. Export only the authorized result set.
6. Reconcile summary totals to underlying transactions.

**Relevant code:** `src/components/modules/Dashboard.jsx`, `Reports.jsx`, `InventoryReports.jsx`, service modules and reporting migrations.

**Status caution:** some dashboards/reports may contain sample/static data. Confirm each data source before representing a metric as live.

## 13. Offline and recovery workflow — target design

This is a planned capability until the relevant code and tests are present.

1. User signs in online and the device receives a limited, device-bound offline capability.
2. PWA shell and permitted operational data are cached locally.
3. Structured data and queued operations are stored in IndexedDB, not localStorage.
4. User performs only explicitly supported offline operations.
5. Each queued mutation receives a stable operation ID and explicit pending status.
6. On reconnect, the sync worker sends operations with idempotency keys.
7. Server validates tenant, permissions, current state and business invariants.
8. Server acknowledges accepted operations; client marks them synced.
9. Conflicts are surfaced and resolved using domain rules.
10. Payments remain unconfirmed until trusted provider/server confirmation.

For multiple terminals sharing data while the internet is down, the future LAN Edge Server coordinates local clients and later reconciles with Supabase.

## 14. Workflow change checklist

When changing any workflow, record:
- actor and permission required;
- entry route and screens;
- service methods and data model;
- database tables, RLS, RPCs, triggers and migrations;
- success, validation, offline, retry and failure paths;
- audit events and financial side effects;
- tests and acceptance criteria;
- affected diagrams and README sections.
