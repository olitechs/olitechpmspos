# OliTechs PMS + POS — Product Requirements Document

> **Repository:** `olitechs/olitechpmspos`  
> **Baseline:** `main`  
> **Status:** DRAFT — Phase 0 documentation only. No application code is changed by this document.

## 1. Product Definition

OliTechs PMS + POS is a standalone hotel Property Management System and Point of Sale application. The repository is a Vite + React application with Supabase migrations and a growing service layer, but the core PMS state is still split between browser/local React stores and database-backed services.

### Vision

Build an Africa-first hotel operating platform with the operational depth expected from an enterprise PMS such as Opera Cloud while remaining practical for independent hotels, resorts, lodges and multi-department properties with unreliable connectivity, low-end hardware and local payment requirements.

The product must not become a visual-only dashboard. Reservation, room inventory, folio, cashier, POS, housekeeping, audit and reporting data must have authoritative domain rules and traceable transactions.

## 2. Current Product Baseline

| Area | Current repository evidence | Product implication |
|---|---|---|
| App entry/routing | `src/App.jsx` | Public routes, PMS/POS routes and separate platform-admin routes already coexist. |
| PMS shell | `src/pages/POSApp.jsx`, `src/components/shell/Sidebar.jsx`, `TopBar.jsx`, `POSTabs.jsx` | Navigation is centralized enough to evolve, but must preserve existing POS/PMS distinctions. |
| PMS state | `src/data/PmsStore.jsx` | Room/reservation UI currently depends on local store state and needs a database-backed repository boundary. |
| POS state | `src/data/AppStore.jsx` | POS sessions/printer state are partly persisted through services, but the store remains a major orchestration layer. |
| PMS service layer | `src/services/pmsService.js` | Existing Supabase access provides a migration path without rewriting screens first. |
| POS service layer | `src/services/posService.js` | Existing persistent POS sessions/receipts/KDS integrations must be preserved. |
| Authentication | `src/services/authService.js`, `src/lib/AuthContext.jsx` | Supabase Auth exists, but browser/session compatibility logic remains and needs hardening. |
| Authorization | `src/lib/AdminRoute.jsx`, `src/lib/FeatureGate.jsx`, `src/lib/entitlements.js` | Property/package access already exists and must be consolidated into explicit permissions. |
| Database | `supabase/migrations/` | Supabase schema, RPCs and RLS are already being developed; migration history contains duplicate numeric prefixes that require governance. |
| Design system | `design-system/olitechs-pms-pos/MASTER.md`, `pages/*.md`, `src/data/palette.js`, `src/data/themePalette.js`, `tailwind.config.js` | There is existing design documentation/tokens, but the current live palette is yellow/black rather than the proposed Phase 0 target palette. |
| Reporting | `src/components/modules/Reports.jsx`, `src/components/modules/Dashboard.jsx` | Reporting is currently a mixture of live service data and dashboard/sample data. |
| Operations | `Reservations.jsx`, `RoomPlanner.jsx`, `Housekeeping.jsx`, `Maintenance.jsx`, `Cashier.jsx`, `NightAudit.jsx` | Major hotel workflows already have UI surfaces and database migrations. |
| POS | `src/components/pos/POSContainer.jsx`, `FloorPlan.jsx`, `OrderTaking.jsx`, `BillPayment.jsx` | POS is a real subsystem, not a mock screen; changes must preserve table sessions, payments and printing. |

## 3. Target Users and Roles

| Role | Primary jobs | Critical outcomes |
|---|---|---|
| Receptionist / Front Desk | Search/create reservation, assign room, check in/out, collect payment, move rooms, print documents | Guest can be processed quickly with minimal navigation. |
| Hotel Manager | Monitor occupancy/revenue, approve sensitive actions, review audit, manage staff/rates | One operational view of the property. |
| Housekeeping | See assigned rooms, update cleaning/inspection status, report discrepancies | Room status is trustworthy in real time. |
| Restaurant POS / Cashier | Open tables, take orders, route to kitchen, settle bills, post room charges, reconcile cashier | Sales remain accurate even through interruptions. |
| Hotel Administrator | Configure property, rooms, rates, staff, permissions, taxes, integrations and settings | Property configuration is controlled and auditable. |
| Platform Owner | Manage properties, subscriptions/packages and platform-level access | Tenant administration remains separate from hotel operations. |

## 4. Core Modules

1. Reservation Management
2. Front Desk
3. Room Management / Room Rack
4. Folio & Billing
5. Restaurant POS
6. Housekeeping
7. Reports & Dashboard
8. Guest CRM
9. Inventory / Purchasing / Recipes
10. Maintenance
11. Cashiering
12. Night Audit
13. Booking Engine / Channel connectivity
14. Staff, Roles & Permissions
15. Property / Platform Administration
16. Printers and operational hardware

## 5. Representative User Stories

### Receptionist
- As a receptionist, I want to search an existing guest by name, phone or confirmation number so I do not create duplicate profiles.
- As a receptionist, I want to check in an already prepared arrival in two primary actions so the queue moves quickly.
- As a receptionist, I want the system to show only rooms that are sellable for the requested dates so I cannot accidentally double-book.
- As a receptionist, I want to move a guest to another room while preserving the reservation and folio history.
- As a receptionist, I want to collect cash, card, M-Pesa or room-charge payments and receive a traceable receipt.

### Manager
- As a manager, I want occupancy, ADR, RevPAR, arrivals, departures, in-house guests and outstanding balances on one dashboard.
- As a manager, I want discounts, refunds, voids and sensitive folio changes to require the correct approval.
- As a manager, I want an audit trail showing who changed a reservation, payment or room status.

### Housekeeping
- As a housekeeper, I want a room board showing Dirty, Cleaning, Inspection, Ready, DND, OOO and OOS states.
- As a supervisor, I want to assign rooms and record inspections without opening the reservation screen.
- As a housekeeper, I want room discrepancies and maintenance flags to be visible to the appropriate department.

### Restaurant POS
- As a POS operator, I want to open a table, add items and send the order to the correct kitchen/bar station.
- As a cashier, I want to split or settle a bill and record the payment method.
- As a POS operator, I want an active table/order to survive a page refresh or temporary network interruption.
- As a cashier, I want room-charge transactions linked to the correct guest folio.

### Administrator
- As an administrator, I want to configure rooms, room types, rates, taxes, staff, roles and operational settings for my property.
- As a platform owner, I want to activate/deactivate properties and assign packages without exposing platform controls inside a hotel's operational workspace.

## 6. MVP / V2 / Enterprise Scope

### MVP — production hotel core

- [ ] Supabase Auth with secure session handling
- [ ] Property isolation with RLS
- [ ] Staff roles and permissions
- [ ] Property, room types and rooms
- [ ] Guest profiles
- [ ] Reservation create/edit/cancel
- [ ] Database-backed availability and double-booking prevention
- [ ] Room Rack / Planner
- [ ] Check-in / check-out
- [ ] Folio and payments
- [ ] Cashier opening/closing and reconciliation
- [ ] Restaurant POS with persistent table sessions
- [ ] KDS persistence
- [ ] Housekeeping status/task workflow
- [ ] Audit logging
- [ ] Basic operational dashboard and reports
- [ ] Receipts/invoices with property identity
- [ ] M-Pesa/cash/card/bank/room-charge payment model
- [ ] Offline-aware POS transaction queue

### V2 — integrated hotel operations

- [ ] Advanced rate plans and restrictions
- [ ] Booking engine
- [ ] Channel manager
- [ ] Groups/events
- [ ] Company/travel-agent profiles
- [ ] Purchasing and supplier workflow
- [ ] Recipes and food-cost analysis
- [ ] Laundry
- [ ] Maintenance preventive schedules
- [ ] Advanced reports/exports
- [ ] Guest portal
- [ ] Email/SMS/WhatsApp operational messaging
- [ ] Loyalty
- [ ] Advanced notifications/task inbox

### Enterprise

- [ ] Multi-property portfolio
- [ ] Platform licensing/subscription entitlements
- [ ] Enterprise RBAC and approval workflows
- [ ] Cross-property reporting
- [ ] Accounting integrations
- [ ] Channel/OTA integrations
- [ ] Enterprise audit/observability
- [ ] Disaster recovery and backup procedures
- [ ] Device/printer fleet management
- [ ] API/webhook ecosystem
- [ ] Advanced revenue management

## 7. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Offline-first | POS and critical operational flows must tolerate temporary connectivity loss without silently losing transactions. |
| Performance | Common front-desk actions should remain responsive on low-end hotel PCs/tablets and modest networks. |
| Financial integrity | Monetary values are integer minor units (cents) at the persistence boundary; calculations must be deterministic. |
| Double booking | Reservation assignment must be validated atomically in the database, not only by a UI check. |
| Auditability | Sensitive changes must record actor, property, action, entity, time and relevant before/after context. |
| Security | Every tenant-sensitive query/write must be constrained by property membership and Supabase RLS. |
| KRA compliance | Invoice/receipt requirements for the Kenyan deployment must be designed as a compliance workstream and validated against current KRA/eTIMS requirements before production certification. |
| Accessibility | Keyboard navigation, visible focus, usable contrast, labels and error states are required. |
| Reliability | Refresh/reconnect must not destroy committed POS table sessions, receipts, KDS orders or PMS transactions. |

## 8. Success Metrics

- Front-desk check-in can be completed without navigating through unrelated modules.
- Zero confirmed double-bookings under concurrent reservation attempts.
- POS orders remain recoverable after refresh/network interruption.
- Every refund/void/discount/folio adjustment is attributable to an authenticated actor.
- Core hotel workflows work with the property database as the source of truth.
- Build, lint and typecheck remain green after every implementation phase.

## 9. Out of Scope for Phase 0

- No JSX/JS/TS/CSS restructuring.
- No schema migration execution.
- No deletion of `v6/`.
- No deletion of `AppStore.jsx` or `PmsStore.jsx`.
- No replacement of the current palette in code.
- No change to the existing PDF/printer/payment behavior.
- No implementation of the target architecture yet.

## 10. Traceability Checklist

- [x] References `src/App.jsx`
- [x] References `src/data/AppStore.jsx`
- [x] References `src/data/PmsStore.jsx`
- [x] References `src/services/authService.js`
- [x] References `src/services/pmsService.js`
- [x] References `src/services/posService.js`
- [x] References PMS/POS modules
- [x] References `supabase/migrations/`
- [x] References the existing design-system directory
- [x] Separates current state from target state

**Status: DRAFT - Awaiting Approval**
