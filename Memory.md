# OliTechs PMS + POS — Long-Term Memory & Decisions

## 1. Project Identity

**Repository:** `olitechs/olitechpmspos`

OliTechs PMS + POS is now a standalone hotel PMS/POS product. The repository retains historical scaffolding and a `v6/` duplicate tree, but the root Vite application is the active architecture.

## 2. Historical Context

The project was originally scaffolded around Base44 concepts. The current `README.md` explicitly describes the application as standalone and notes that no external platform is required for development/build.

The current application must not reintroduce Base44 dependencies.

## 3. Why Supabase

Supabase is the target backend because the repository already has:

- `src/lib/supabaseClient.js`
- `src/services/pmsService.js`
- `src/services/posService.js`
- `src/services/platformService.js`
- extensive `supabase/migrations/`
- Auth/RLS/property-management logic

The decision is therefore evolutionary: consolidate the existing Supabase work into a coherent backend-first architecture instead of replacing it with a new backend platform.

## 4. Why Keep Vite

The active application is a Vite + React application.

Evidence:

- `package.json`: Vite scripts/dependency
- `vite.config.js`
- `src/main.jsx`
- `src/App.jsx`

Vite should remain the build/runtime foundation. A framework migration is not justified as part of the PMS restructure.

## 5. Why Offline-First

Hotel operations cannot assume uninterrupted connectivity.

The repository already demonstrates this need:

- POS table/session recovery
- persistent kitchen orders
- printer device-state handling
- local UI state
- existing standalone development mode

The target is **offline-aware**, not “localStorage as database”.

Critical transactions need explicit queue/idempotency/reconciliation semantics.

## 6. Known Gotchas

### Data resets on reload

Historically, `PmsStore.jsx` and portions of `AppStore.jsx` held browser/local React state. The root `README.md` explicitly documents that PMS rooms/reservations and some POS state can reset on page reload.

This is a migration target, not a behavior to preserve.

### Auth is not yet a clean security boundary

`src/services/authService.js` contains legacy/browser compatibility logic and Supabase Auth operations. The repository README explicitly warns that the local account storage approach is not production-grade security.

Never use a localStorage flag as proof of permission.

### Platform admin dependency

The repository documentation notes that the platform dashboard/property count path uses the `admin_list_properties()` RPC.

Relevant files:

- `src/services/platformService.js`
- `src/pages/admin/AdminDashboard.jsx`
- `src/pages/admin/AdminProperties.jsx`
- `supabase/migrations/0006_admin_reporting.sql`
- `0007_admin_dashboard.sql`
- `0010_complete_registration_approval.sql`
- later platform-management migrations

Do not remove or rename the RPC without tracing all consumers.

### Migration numbering collisions

The repository contains duplicate numeric migration prefixes, including 0016, 0028, 0032, 0033, 0034, 0035 and 0037.

Do not rename applied migrations just for cosmetic ordering.

### Room Planner is high-risk

`src/components/pms/RoomPlanner.jsx` is large and operationally significant. A backup file `RoomPlanner.jsx.bak` is also present.

Do not rewrite it blindly.

### POS persistence is already partially implemented

`src/data/AppStore.jsx` loads persisted active sessions and kitchen orders through `posService`.

Migrations include:

- `0033_pos_table_sessions.sql`
- `0036_persistent_kitchen_orders.sql`
- `0037_persistent_printer_config.sql`

The architecture migration must preserve this behavior.

### Receipt persistence

The repository has:

- `supabase/migrations/0023_pos_receipts.sql`
- `src/components/modules/Receipts.jsx`
- `src/components/pms/ReceiptDetailModal.jsx`
- POS service receipt methods

Receipts must remain server-authoritative.

## 7. Important File Map

| Path | Purpose | Protect? |
|---|---|---|
| `src/App.jsx` | Application routes/providers | Yes |
| `src/main.jsx` | Vite entry | Yes |
| `src/pages/POSApp.jsx` | Protected hotel application shell/module composition | Yes |
| `src/components/shell/Sidebar.jsx` | Main navigation | Yes |
| `src/components/shell/TopBar.jsx` | Main top navigation/context | Yes |
| `src/components/shell/POSTabs.jsx` | POS navigation tabs | Yes |
| `src/data/AppStore.jsx` | POS/local orchestration and persistence hydration | Yes during migration |
| `src/data/PmsStore.jsx` | PMS/local state provider | Yes during migration |
| `src/services/authService.js` | Auth service | Yes |
| `src/services/pmsService.js` | PMS data operations | Yes |
| `src/services/posService.js` | POS data operations | Yes |
| `src/services/platformService.js` | Platform administration | Yes |
| `src/services/inventoryService.js` | Inventory operations | Yes |
| `src/services/printerService.js` | Printer connectivity/printing | Yes |
| `src/lib/AuthContext.jsx` | Auth state/redirect orchestration | Yes |
| `src/lib/AdminRoute.jsx` | Platform admin route guard | Yes |
| `src/lib/FeatureGate.jsx` | Feature entitlement gate | Yes |
| `src/lib/entitlements.js` | Package/feature entitlement logic | Yes |
| `src/lib/query-client.js` | React Query client | Yes |
| `src/lib/supabaseClient.js` | Supabase client/config | Yes |
| `src/components/modules/Reservations.jsx` | Reservation UI | Yes |
| `src/components/pms/RoomPlanner.jsx` | Room inventory/planner | High risk |
| `src/components/modules/Folio.jsx` | Billing/folio UI | Yes |
| `src/components/modules/Cashier.jsx` | Cashier operations | Yes |
| `src/components/modules/NightAudit.jsx` | Night audit | Yes |
| `src/components/pos/*` | POS screens | Yes |
| `src/components/modules/KitchenDisplay.jsx` | KDS | Yes |
| `src/components/modules/Housekeeping.jsx` | Housekeeping | Yes |
| `src/components/modules/Reports.jsx` | Reporting | Yes |
| `src/data/platformData.js` | Static/sample operational data | Migrate gradually |
| `src/data/palette.js` | Current visual tokens | Do not blindly overwrite |
| `src/data/themePalette.js` | Theme palette | Do not blindly overwrite |
| `tailwind.config.js` | Tailwind theme/config | Controlled migration |
| `design-system/olitechs-pms-pos/*` | Design documentation | Reference source |
| `supabase/migrations/*` | Database evolution | Never casually rename applied files |
| `v6/*` | Historical duplicate application tree | Do not delete in Phase 1 |

## 8. Things That Must Not Be Deleted During Restructure

- `src/data/AppStore.jsx`
- `src/data/PmsStore.jsx`
- `src/components/pms/RoomPlanner.jsx`
- POS components under `src/components/pos/`
- printer service/configuration
- receipt/payment functionality
- existing Supabase migration history
- platform-admin routes
- `v6/` before a separately approved cleanup phase

## 9. Decision Log

| Decision | Rationale |
|---|---|
| Keep Vite + React | Active stable runtime/build architecture. |
| Use Supabase | Already integrated and backed by extensive migrations/RLS/Auth. |
| Use TanStack Query for server state | Already installed and wired through `src/lib/query-client.js`. |
| Use Zustand for future client UI state | Avoid expanding React Context into another global data layer. |
| Keep stores temporarily | Prevent breaking existing screens during incremental migration. |
| Database enforces reservation conflicts | UI checks cannot safely protect against concurrent writes. |
| Integer minor-unit money | Avoid floating-point financial corruption. |
| Preserve migration history | Applied migration filenames are deployment history, not disposable source files. |
| Separate platform admin from hotel admin | Existing route/security model already distinguishes them. |

## 10. Phase 0 Memory Rule

The seven foundation documents are the decision baseline. If a later agent proposes a change that conflicts with them, it must explicitly identify the conflict and obtain an updated decision rather than silently changing architecture.

**Status: APPROVED FOR SCOPED PHASE 1 ONLY — 2026-10-09**

## 11. Owner Authorization — 2026-10-09

The owner has authorized the scoped Phase 1 implementation described in the implementation brief supplied for this task. This authorization covers the design-token/shared-shell foundation only, must be delivered on a dedicated feature branch and pull request, and does not authorize merging the existing open Phase 1 foundation PR, changing the Room Planner behavior, or advancing to a later phase without a separate approval.

The implementation brief's approved yellow/charcoal palette supersedes the older blue/slate target palette in the previous draft of `Design.md` and `design-system/olitechs-pms-pos/MASTER.md`. Record the corresponding ADR in `Architecture.md` and keep the docs and implementation aligned.

The current repository already has an open PR #10 named `feat: Phase 1 foundation architecture and security`. This UI/design-system work is isolated on `feature/phase-1-design-system-shell`; do not alter or close PR #10.

**Authorization status: APPROVED FOR SCOPED PHASE 1 ONLY — 2026-10-09.**
