# OliTechs PMS + POS — Architecture

> **Purpose:** Record the actual repository architecture before restructuring.  
> **Rule:** This document describes the target; it does not authorize implementation yet.

## 1. Current Architecture — As Found

### Runtime

The repository is a Vite + React 18 application. `package.json` confirms Vite, React, React Router, Tailwind, Supabase JS, TanStack React Query, React Hook Form, Zod, Framer Motion, Radix UI, Recharts and jsPDF.

The root application is wired in `src/App.jsx` and uses:

- `QueryClientProvider` from `@tanstack/react-query`
- React Router
- `AuthProvider` from `src/lib/AuthContext.jsx`
- Separate public, hotel/POS and platform-admin route trees
- `SupabaseSetupNotice` when Supabase configuration is missing

### Current route/security boundary

`src/App.jsx` contains:

- Public routes: `/`, `/home`, `/signin`, `/signup`, `/login`, `/register`
- Protected hotel workspace: `/backoffice`, `/pos`, `/store`, `/rooms`
- Platform admin: `/admin/login`, `/admin/*)
- `AdminRoute` and `AdminLayout` isolate platform-admin routes from normal hotel routes.

`src/lib/AuthContext.jsx` obtains the current user through `authService.getCurrentUser()`, maintains application auth state and redirects after login/logout.

### Current data flow

The application is hybrid rather than truly backend-first.

| Current source | Role |
|---|---|
| `src/data/PmsStore.jsx` | Local React context/state for PMS rooms/reservations and UI-facing mutations. |
| `src/data/AppStore.jsx` | POS application state, active sessions, kitchen orders, printers and orchestration around `posService` / `printerService`. |
| `src/data/platformData.js` | Static/sample dashboard, guest and operational data still used by parts of the UI. |
| `src/services/pmsService.js` | Supabase-backed PMS operations and RPC calls. |
| `src/services/posService.js` | Supabase-backed POS persistence including table sessions, receipts and KDS-related operations. |
| `src/services/inventoryService.js` | Inventory operations. |
| `src/services/platformService.js` | Platform/property administration operations. |
| `src/services/printerService.js` | Device connectivity and print-job handling. |
| `src/services/authService.js` | Authentication and account workflow, including Supabase Auth and compatibility/session logic. |
| `src/lib/query-client.js` | TanStack Query client exists but is not yet the single data-access pattern. |

### Important correction to the simplistic “no backend” description

The repository does have a Supabase backend integration and extensive migrations. The more accurate finding is:

> **There is no single authoritative backend-first data architecture yet.** Core UI state still flows through `PmsStore.jsx` and `AppStore.jsx`, while several services already call Supabase.

This distinction matters because Phase 1 should migrate the source of truth incrementally rather than replacing working screens.

## 2. Current Authentication Weakness

The repository documentation explicitly says `src/services/authService.js` historically stores/handles local browser account state and is not production-grade security. The current file also contains Supabase Auth operations and recovery flows.

Target rule:

- Supabase Auth is authoritative for authentication.
- Application authorization comes from property membership/profile/role/entitlement data.
- `localStorage` must not be treated as proof of authorization.
- `AdminRoute.jsx`, `FeatureGate.jsx`, `entitlements.js` and `AuthContext.jsx` should eventually converge on one authorization model.

## 3. Supabase Architecture

The migration directory is substantial and contains the operational evolution of the system.

Key migrations include:

- `0001_platform_admin.sql`
- `0002_pms_core.sql`
- `0003_housekeeping_maintenance_inventory.sql`
- `0004_claim_owner_property.sql`
- `0005_admin_property_approval.sql`
- `0006_admin_reporting.sql`
- `0007_admin_dashboard.sql`
- `0008_registration_pending_application.sql`
- `0009_repair_registration_applications.sql`
- `0010_complete_registration_approval.sql`
- `0011_fix_property_registration_rls.sql`
- `0012_hotel_operations_foundation.sql`
- `0013_room_planner_schema_repair.sql`
- `0014_room_planner_production.sql`
- `0015_room_planner_date_inventory.sql`
- `0016_fix_room_planner_raise.sql`
- `0016_store_controls_inventory.sql`
- `0017_staff_roles_pin_access.sql`
- `0018_workspace_rls.sql`
- `0019_pms_pos_security.sql`
- `0020_active_staff_server_session.sql`
- `0021_effective_staff_rls.sql`
- `0022_touch_staff_session.sql`
- `0023_pos_receipts.sql`
- `0024_live_daily_reporting.sql`
- `0025_cashier_controls.sql`
- `0026_night_audit.sql`
- `0027_housekeeping_2.sql`
- `0028_inventory_recipe_laundry_transfers.sql`
- `0028_maintenance_2.sql`
- `0029_purchasing_2.sql`
- `0030_recipes_laundry_transfers.sql`
- `0031_booking_engine_channel_connectivity.sql`
- `0032_property_paywall.sql`
- `0032_property_subscriptions.sql`
- `0033_platform_owner_controls.sql`
- `0033_pos_table_sessions.sql`
- `0034_live_dashboard_activity.sql`
- `0034_platform_owner_property_management.sql`
- `0035_exclude_voided_pos_reporting.sql`
- `0035_subscription_access_bootstrap.sql`
- `0036_persistent_kitchen_orders.sql`
- `0037_persistent_printer_config.sql`
- `0037_property_members_rpc_schema_cache_fix.sql`
- `0038_platform_update_subscription_schema_cache_fix.sql`
- `0039_platform_set_property_package_schema_cache_fix.sql`

### Migration governance finding

Numeric prefixes are reused (for example `0016`, `0028`, `0032`, `0033`, `0034`, `0035`, `0037`). Existing migration files must not be casually renamed if they have been applied to a live database. Phase 1 must establish migration-state documentation before any cleanup.

See `supabase/migrations/README.md` for the existing execution guidance and registration/approval sequence.

## 4. Target Architecture

### 4.1 Presentation

**React + React Router + Tailwind**

Existing pages/components remain the presentation layer.

Target boundary:

`src/pages` → feature components → query/mutation hooks → service/repository layer → Supabase.

Components must not own persistence rules.

### 4.2 Backend

**Supabase**

- PostgreSQL is the system of record.
- Supabase Auth is the identity provider.
- RLS is the tenant-security boundary.
- Database functions/RPCs handle operations that require atomicity, concurrency protection or elevated server-side logic.
- Realtime may be introduced selectively for operational boards; it must not become a substitute for transactional integrity.

### 4.3 Data fetching

**TanStack Query**

The repository already has `@tanstack/react-query` and `src/lib/query-client.js`.

Target responsibilities:

- Query caching
- Loading/error states
- Invalidations
- Mutation lifecycle
- Refetch/reconnect behavior
- Offline-aware query policies where appropriate

### 4.4 Client state

**Zustand**

Zustand becomes the target client-state layer for UI/session state that is not authoritative database data.

Examples:

- selected property
- active POS terminal
- open UI panels
- current POS draft
- filters
- modal state
- keyboard shortcut state
- offline queue metadata

Do not put authoritative reservations, guests, folios or room inventory into Zustand as a second database.

## 5. Proposed Database Domain Model

| Entity | Core fields / responsibility |
|---|---|
| `properties` | Property identity, status, package/subscription, currency, timezone, tax/business settings. |
| `profiles` | Auth-linked user identity and platform role. |
| `property_users` | User-to-property membership and hotel-level access. |
| `room_types` | Sellable room category, capacity, pricing defaults. |
| `rooms` | Individual physical rooms, room type, operational status. |
| `guests` | Guest identity, contact, preferences, profile history. |
| `reservations` | Stay dates, guest, room, status, rate, occupancy and booking metadata. |
| `folios` | Guest/company billing account and balance. |
| `folio_transactions` | Charges, payments, adjustments, refunds and tax lines. |
| `pos_orders` | POS order/session header and financial state. |
| `housekeeping_tasks` | Room cleaning/inspection work and assignments. |
| `audit_logs` | Immutable-ish audit event trail with actor/property/entity context. |

The actual repository already contains additional domain tables and functions. This proposal is the canonical conceptual model for the restructure, not an instruction to discard existing schema.

## 6. Tenant Security Model

Every tenant-sensitive record must be attributable to a `property_id`, directly or through a controlled relationship.

### Access layers

1. **Platform owner**
   - Platform administration only.
   - Can manage properties/packages/subscriptions through explicitly authorized RPCs.
2. **Hotel administrator**
   - Own property only.
   - Can manage property configuration/staff/operations according to permissions.
3. **Front desk**
   - Reservation/front-desk/guest/folio operations allowed by role.
4. **Housekeeping**
   - Room-status/task operations.
5. **POS**
   - POS/table/order/payment operations.

### RLS principle

Policies must derive access from authenticated identity and property membership, not from client-supplied IDs alone.

A query such as “give me property X” is never sufficient authorization. The database must verify that the current authenticated actor has access to X.

## 7. Migration Strategy from Stores to API

### Current

`Component → PmsStore/AppStore → service or local state → UI`

### Target

`Component → Query/Mutation Hook → Service → Supabase/RPC → Query Cache`

### Safe migration sequence

1. Freeze public component APIs.
2. Identify each store action used by each module.
3. Add service methods with equivalent inputs/outputs.
4. Add TanStack Query hooks around those service methods.
5. Keep store adapters temporarily where a screen cannot be migrated atomically.
6. Migrate one domain at a time: rooms → guests → reservations → folios → POS.
7. Remove duplicated local persistence only after the database path is proven.
8. Preserve UI component props during migration.
9. Test refresh, concurrent users, offline/reconnect and authorization at every domain boundary.
10. Delete store code only after no component imports it.

### Compatibility rule

Do not perform a “big bang” replacement of `PmsStore.jsx` and `AppStore.jsx`. The POS store contains real session, kitchen and printer orchestration that must remain functional while the source of truth moves.

## 8. Architecture Constraints

- No direct Supabase access from presentational components.
- No browser storage as an authorization mechanism.
- No client-only availability check for reservation conflicts.
- No floating-point persistence for money.
- No cross-property query without an RLS-backed authorization path.
- No destructive migration renumbering without database-state evidence.
- No architecture change that removes an existing working hotel workflow.



## 9. Architecture Decision Record — 2026-10-09

### ADR-001: Adopt the approved OliTechs yellow/charcoal semantic design tokens

**Status:** Accepted for scoped Phase 1 by owner authorization recorded in `Memory.md`.

**Decision:** The visual system uses charcoal/near-black for brand structure, `#FFC400` for primary actions with dark action text, neutral cool-gray surfaces, and semantic status tokens. This replaces the older blue/slate palette proposed in the draft design document. The source of truth is CSS custom properties in `src/index.css`; Tailwind and compatibility palette modules map to those tokens rather than defining competing hex values.

**Constraints:** Preserve existing application workflows and role/module navigation. Do not change Room Planner behavior. Keep table/room/stay/payment states distinguishable by text or icon as well as color. Keep POS/kitchen touch controls at least 48px high while standard controls remain compact. Do not merge or alter existing PR #10.

**Consequences:** Existing hard-coded palette references must be migrated incrementally. Any unmigrated component must continue to render using compatible semantic tokens. Contrast and responsive verification must be reported as completed only after measured/tested.


**Status: Approved for scoped Phase 1 implementation — 2026-10-09**