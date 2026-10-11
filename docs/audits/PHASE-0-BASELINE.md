# Phase 0 — Baseline Audit and Defect Register

**Repository:** `olitechs/olitechpmspos`  
**Audit branch:** `audit/phase-0-baseline`  
**Audit snapshot:** 2026-10-11  
**Scope:** Static review of selected application entry points, navigation definitions/tests, route map, package scripts, Supabase config, and latest visible commit status.

## Evidence and limitations

This is an initial, file-backed static audit—not a claim that all repository files have been individually inspected. The connected GitHub file API was used to inspect the files cited below. A local clone could not be created in the current execution environment because outbound DNS/network access to GitHub is unavailable. Consequently, no local lint, typecheck, architecture test, contrast test, or production build result is claimed here. The latest visible commit's combined status reports a successful Vercel check, but that alone does not establish that all CI checks or end-to-end workflows pass.

The repository's `package.json` defines these validation commands:

- `npm run lint`
- `npm run typecheck`
- `npm run test:architecture`
- `npm run check:contrast`
- `npm run build`

These must be run against the exact audit commit in a checkout with dependencies installed before the baseline can be considered complete.

## Confirmed observations

| ID | Priority | Finding | Evidence | Status |
|---|---|---|---|---|
| NAV-001 | High | Navigation is defined in at least two separate architecture modules. Their roles and paths use different role vocabularies (for example, `admin/owner/front_desk` versus `hotel_admin/super_admin/receptionist`). This creates a synchronization risk; whether it causes a specific user-facing failure needs route/runtime tests. | `src/data/modules/navArchitecture.js`; `src/data/modules/sidebarNavigation.js` | Confirmed static risk |
| NAV-002 | High | `POSApp` imports and owns a legacy `Sidebar`, `POSTabs`, and `TopBar`, while the routed workspace layouts also mount `AppShell`. `FrontOfficeLayout` bypasses its shell for the exact room-planner path (including an optional trailing slash). This is an intentional special case, but every route must be tested to prove only one shell renders. | `src/pages/POSApp.jsx`; `src/components/layout/BackOfficeLayout.jsx`; `src/components/layout/FrontOfficeLayout.jsx` | Confirmed architecture risk |
| ROUTE-001 | High | The route map sends many Back Office destinations to shared generic components (for example, multiple inventory paths use `InventoryOperations`, and employee hours/timecards share `TimecardsPage`). Some routes explicitly render `ModuleStatusPage`. The route/component mapping should be classified as real workflow, intentionally shared view, or placeholder before any remapping. | `src/App.jsx` | Confirmed; business correctness not yet verified |
| ROUTE-002 | High | Front Office index, room planner, rooms, reservations, folio, housekeeping, and night-audit paths all route through `POSApp` with different initial modules. The active-module synchronization and embedded shell behavior need route-by-route tests, including direct URL and browser history navigation. | `src/App.jsx`; `src/pages/POSApp.jsx` | Confirmed test gap |
| AUTH-001 | High | Architecture tests cover canonical role normalization and package gating, but the inspected tests do not prove that UI navigation rules match route guards and Supabase RLS/RPC authorization. | `src/data/modules/navArchitecture.test.js`; `src/data/modules/sidebarNavigation.test.js`; `src/App.jsx` | Confirmed test coverage gap |
| TEST-001 | Medium | Existing architecture tests assert uniqueness and role metadata for navigation definitions, but do not establish that every path resolves to the intended route component or that exactly one shell is mounted. | `src/data/modules/navArchitecture.test.js`; `src/data/modules/sidebarNavigation.test.js` | Confirmed test coverage gap |
| DB-001 | High | Migration-prefix collisions (reported for `0016`, `0028`, and `0032`) remain unverified in this pass. The migration directory and deployed migration history must be enumerated before any migration is renamed, merged, or applied. | Needs complete migration-tree and deployed-history inspection | Open; not yet independently verified |
| CI-001 | Medium | The latest visible commit `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a` has a successful Vercel combined status. This does not prove the full local validation suite or production database workflows pass. | GitHub combined commit status for `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a` | Partial evidence only |
| EXEC-001 | High | Local validation commands were not executable from this environment because a Git clone failed with a network/DNS resolution error. No pass/fail result is inferred. | Audit execution log, 2026-10-11 | Blocking baseline completion |

## Required Phase 0 follow-up

1. Obtain a checkout of the exact audit commit and record the commit SHA and working-tree state.
2. Run and capture output for lint, typecheck, architecture tests, contrast checks, and production build independently.
3. Enumerate all tracked files and categorize source, tests, migrations, edge functions, workflows, and generated/vendor files.
4. Build a route inventory from `src/App.jsx` and compare every navigation path in both navigation definitions with route elements and intended page components.
5. Inspect shell ownership in `AppShell`, `POSApp`, `Sidebar`, `TopBar`, and mobile navigation components; add route tests for single-shell behavior, active state, direct URLs, trailing slashes, and back/forward.
6. Enumerate migration filenames and versions, compare repository migration history with the target database's migration history, and review RLS, policies, triggers, and RPCs without applying changes.
7. Inspect GitHub Actions workflows and recent workflow runs, then record each check's exact status and run URL.
8. Expand each confirmed issue into a defect with severity, reproduction evidence, affected files, expected behavior, regression test, and acceptance criteria.

## Safety constraints

- No production schema or data changes during Phase 0.
- Do not reset a database or rewrite migration history.
- Do not remove files solely because they appear duplicated; prove they are unused and preserve history.
- Do not mark placeholder workflows as complete merely because their routes render.
- Phase 1 must not begin until the baseline commands and route/migration inventories are recorded, or any blocked checks are explicitly documented and accepted.
