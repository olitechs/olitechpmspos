# Phase 0 — Route and Navigation Cross-Check

**Baseline commit:** `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a`  
**Source files inspected:** `src/App.jsx`, `src/data/modules/navArchitecture.js`, `src/data/modules/sidebarNavigation.js`, and the two corresponding navigation tests.  
**Purpose:** static route wiring inventory. This is not a browser test and does not assert that each rendered component's actions work.

## Confirmed route-to-component observations

| Navigation label / route | Registered target | Static observation | Verification still required |
|---|---|---|---|
| Access rights — `/backoffice/employees/access-rights` | `Roles` in `App.jsx` | Route exists, but `sidebarNavigation.js` links the label to `/backoffice/employees/list`, which renders `EmployeeListPage`. | Correct link, active state, and role/permission enforcement. |
| Stock adjustments — `/backoffice/inventory/stock-adjustments` | `InventoryOperations` | No explicit section prop. | Confirm component derives correct operation from route or change to explicit route context. |
| Inventory counts — `/backoffice/inventory/counts` | `InventoryOperations` | Same component and no explicit section prop. | Unique expected heading, data query, and actions. |
| Productions — `/backoffice/inventory/productions` | `InventoryOperations` | Same component and no explicit section prop. | Unique expected heading, data query, and actions. |
| Inventory history — `/backoffice/inventory/history` | `InventoryOperations` | Same component and no explicit section prop. | History-specific filters and read-only/ledger semantics. |
| Inventory valuation — `/backoffice/inventory/valuation` | `InventoryOperations` | Same component and no explicit section prop. | Valuation-specific calculations and source data. |
| Store overview — `/stores` | `StoresPage` | Uses default props. | Confirm overview tab/content is selected on direct load and navigation. |
| Store settings — `/stores/settings` | `StoresPage` | Same component and same default props as overview. | Confirm route-aware settings content; likely route-context defect unless inferred internally. |
| Front Office dashboard — `/frontoffice` | `POSApp initialModule="dashboard"` | Embedded workspace route. | One shell only, correct active nav, and direct-load behavior. |
| Room Planner — `/frontoffice/room-planner` | `POSApp initialModule="rooms"` | Embedded Front Office route with dedicated layout handling noted in the main audit. | Exactly one navigation shell at desktop/mobile widths; correct history/back behavior. |
| Rooms alias — `/frontoffice/rooms` | `POSApp initialModule="rooms"` | Shares the Room Planner module. | Decide/document whether this alias should remain and ensure nav uses canonical route. |
| Reservations — `/frontoffice/reservations` | `POSApp initialModule="reservations"` | Distinct initial module. | Direct route, active state, CRUD actions and persisted results. |
| Guest Folio — `/frontoffice/folio` | `POSApp initialModule="folio"` | Distinct initial module. | Financial invariants, payment/checkout flows and persisted results. |
| Housekeeping — `/frontoffice/housekeeping` | `POSApp initialModule="housekeeping"` | Distinct initial module. | Task/state transitions and property scoping. |
| Night Audit — `/frontoffice/night-audit` | `POSApp initialModule="night-audit"` | Distinct initial module. | Close/reconciliation permissions and idempotency. |
| POS Devices — `/stores/pos-devices` | `ModuleStatusPage` | Explicitly described as future Phase 6 functionality. | Ensure menu communicates planned status and does not imply a functioning device-management workflow. |
| Back Office Help — `/backoffice/help` | `ModuleStatusPage` | Explicit placeholder for operational help/support documentation. | Classify as planned and provide honest UI copy. |
| Settings slug fallback — `/backoffice/settings/:slug` | `ModuleStatusPage` for unknown slugs | Unknown paths can resolve to a generic status page rather than a 404. | Inventory all reachable settings links and distinguish intentionally planned pages from bad links. |
| Employee report — `/backoffice/reports/employees` | `TimecardsPage` | Employee report is wired to the timecards component. | Confirm the route provides report-specific content rather than timecard operations. |

## Navigation architecture mismatch

Two navigation definitions coexist:

- `navArchitecture.js`: workspace roles include `admin`, `owner`, `front_desk`, etc.; package module map contains `store` while the workspace ID is `stores`.
- `sidebarNavigation.js`: uses a separate role vocabulary including `hotel_admin` and `super_admin`, and the Access rights path mismatch documented above.

Existing tests assert uniqueness and metadata shape, and test some role/package normalization. They do **not** compare every navigation path against React Router's route registry or verify the expected component and rendered content for every destination.

## Required test matrix before any route refactor

1. Extract every sidebar item and top-level workspace item into a single test input.
2. Assert each non-external link resolves to a declared route or explicitly approved redirect.
3. Assert each route renders its expected page identity (heading/test ID) rather than only a shared generic component.
4. Assert one shell/navigation owner per route at desktop and mobile widths.
5. Test direct URL entry, in-app navigation, refresh, back/forward, and active-nav state.
6. Test role × package combinations for visibility **and** direct-route denial; UI filtering is not authorization.
7. Test data loading success, empty results, and failed requests separately.
8. Verify each mutation with persisted state and a negative authorization case.

## Scope / safety

No runtime code or production database was changed while preparing this inventory. Shared components are not presumed defective merely because multiple routes use them; each needs component inspection and route-level evidence before changing or removing it.
