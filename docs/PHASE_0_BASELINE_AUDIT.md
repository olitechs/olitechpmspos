# OliTechs PMS & POS — Phase 0 Baseline Audit

**Repository:** `olitechs/olitechpmspos`  
**Baseline branch:** `main`  
**Audit branch:** `audit/phase-0-baseline`  
**Audit date:** 2026-10-11  
**Purpose:** Establish an evidence-based baseline before functional refactoring. This phase documents findings only; it intentionally makes no application/runtime changes.

## 1. Baseline inventory

The recursive Git tree returned by GitHub was not truncated.

- 486 tracked files in the repository tree.
- 167 files under `src/`.
- Four test files are referenced by `npm run test:architecture`: navigation architecture, sidebar navigation, shared UI system, and PMS date utilities.
- Three GitHub Actions workflows: `validate-build.yml`, `production-qa.yml`, and `deploy-supabase-functions.yml`.
- Main application: Vite + React 18 + React Router + Tailwind + Supabase.
- Backend assets include Supabase migrations and the `print-proxy` Edge Function.
- Main source-of-truth/state areas include `AuthContext.jsx`, `PmsStore.jsx`, `AppStore.jsx`, and the PMS/POS/auth/inventory/platform services.

## 2. CI baseline observed

At audit time, GitHub Actions showed these two workflows completed successfully for baseline commit `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a`:

- [Validate OliTechs PMS POS](https://github.com/olitechs/olitechpmspos/actions/runs/38121173660)
- [OliTechs Production QA](https://github.com/olitechs/olitechpmspos/actions/runs/38121173610)

The validation workflow is configured to run dependency installation, print-agent syntax checks, lint, typecheck, architecture tests, contrast audit, and production build. Production QA runs `npm ci`, lint, and production build.

**Interpretation:** a green build validates the configured static checks. It does not prove every route renders unique intended content, every mutation persists correctly, RLS is correct in the deployed project, or the full guest/POS lifecycle works in a browser.

## 3. Confirmed findings and risks

### P0 — Migration version collisions; verify before any migration operation

The tracked migration directory contains repeated numeric versions, including:

- `0016_fix_room_planner_raise.sql` and `0016_store_controls_inventory.sql`
- `0028_inventory_recipe_laundry_transfers.sql` and `0028_maintenance_2.sql`
- `0032_property_paywall.sql` and `0032_property_subscriptions.sql`
- `0033_platform_owner_controls.sql` and `0033_pos_table_sessions.sql`
- `0034_live_dashboard_activity.sql` and `0034_platform_owner_property_management.sql`
- `0035_exclude_voided_pos_reporting.sql` and `0035_subscription_access_bootstrap.sql`
- `0037_persistent_printer_config.sql` and `0037_property_members_rpc_schema_cache_fix.sql`
- `0040_platform_property_status_and_subscription_visibility.sql`, `0040_pos_table_sessions_realtime.sql`, and `0040_property_workspace_roles.sql`
- `0045_property_admin_unsettled_receipt_settings.sql` and `0045_unsettled_receipt_settings.sql`
- `0047_hardened_direct_printer_transport.sql` and `0047_pos_kot_sent_at.sql`
- `0048_default_void_printer_assignments.sql` and `0048_direct_printer_schema_hardening.sql`
- `0049_multi_transport_physical_printers.sql` and `0049_void_print_status_policies.sql`

Timestamped migration versions also collide:
- `20261008170000_phase7_backoffice_timecards.sql` and `20261008170000_phase8_daily_hotel_metrics.sql`
- `20261008223000_fix_inventory_location_function_volatility.sql` and `20261008223000_phase10_production_index_cleanup.sql`

**Risk:** migration tooling may reject duplicate versions, or deployed environments may have inconsistent histories. Do not rename, reorder, reset, or re-run production migrations blindly. Phase 7 must compare local migration files with the actual deployed migration ledger and schema, then use a safe forward-only remediation plan.

### P1 — Store workspace package identifier mismatch

In `src/data/modules/navArchitecture.js`, the main workspace identifier is `stores`, while `PACKAGE_MODULES` uses `store`. `canAccessApp(role, 'stores', 'professional')` checks whether the package's module list contains `stores`, so the current mapping can deny the Stores workspace to otherwise eligible users on package-gated routes. The auth service separately normalizes `stores` to `store`, so access logic is not using one canonical identifier end-to-end.

**Required fix in Phase 1/3:** define canonical workspace IDs and test all role × package combinations before changing authorization behavior.

### P1 — Legacy and shared navigation definitions coexist

The app has `AppShell` / `TopAppNav` layouts and legacy `POSApp` / `Sidebar` / `TopBar` / `POSTabs` components, plus navigation metadata in both `navArchitecture.js` and `sidebarNavigation.js`. This is a verified duplication of navigation architecture, though not every route necessarily renders both shells.

**Risk:** duplicate nav, active-state drift, inconsistent role filtering, and links that target different route conventions.

**Required fix in Phase 1:** establish one owner per route, then make navigation metadata and route registry test against one another.

### P1 — Access-rights sidebar link targets the employee list

In `src/data/modules/sidebarNavigation.js`, the item labelled **Access rights** points to `/backoffice/employees/list`, the same path as Employee list. The route registry defines a dedicated `/backoffice/employees/access-rights` route.

**Impact:** clicking Access rights from that sidebar opens the employee list rather than the intended access-rights page.

### P1 — Multiple inventory destinations reuse one component without route context

In `src/App.jsx`, several distinct destinations render `InventoryOperations` without a section prop: stock adjustments, counts, productions, history, and valuation. Transfer orders also render `POSApp` with the transfers module. These routes need component-level inspection to prove that each route selects its intended section rather than falling back to a common default.

Similarly, `/stores` and `/stores/settings` both render `StoresPage` without an explicit tab/section argument.

**Status:** route wiring is confirmed; whether the components infer the route internally remains to be verified in Phase 2. Do not label these as definitively broken until that component inspection and browser test is complete.

### P1 — Some navigation destinations are explicitly placeholders

`BackOfficeSettingsPage` routes unknown settings slugs to `ModuleStatusPage`; Back Office Help is also a `ModuleStatusPage`. Stores POS Devices is intentionally a placeholder according to its route description. The presence of placeholders is confirmed; the audit must inventory them and distinguish planned scope from accidental dead ends.

### P1 — PMS store silently degrades optional datasets

In `src/data/PmsStore.jsx`, room types, reservations, and guests are loaded with `Promise.allSettled`. If reservations or guests fail, the store replaces those datasets with empty arrays; only room-type failure receives a surfaced message. This can make a partial backend failure look like a genuinely empty hotel.

**Required fix in Phase 4:** preserve per-resource errors and expose an actionable partial-data state; do not show empty-state copy when a fetch failed.

### P1 — POS state has sample/default configuration mixed with persisted data

In `src/data/AppStore.jsx`, table sessions and kitchen orders are loaded from Supabase, while zones and staff are initialized from `INITIAL_ZONES` and `INITIAL_STAFF`, and printer defaults are generated by `seedPrinters()`. This is not automatically a defect, but it requires clear separation between demo defaults, property configuration, and persisted production state to prevent seeded defaults being mistaken for saved property settings.

### P2 — Architecture coverage does not yet prove all navigation destinations work

The existing navigation tests check ID/path uniqueness, role normalization, package rules, and basic sidebar metadata. They do not establish that every declared nav link resolves to a route, that each route renders distinct expected content, or that protected pages deny unauthorized direct URL access.

**Required fix in Phase 1/2:** build route-registry tests and browser-level route smoke tests; add assertions for canonical workspace IDs and every navigation item's destination.

## 4. Phase 0 defect register

| ID | Priority | Finding | Owner phase | Acceptance evidence |
|---|---|---|---|---|
| AUD-001 | P0 | Migration version collisions | Phase 7 | Migration ledger/schema reconciliation; forward-only plan |
| AUD-002 | P1 | `stores` vs `store` package ID mismatch | Phase 1/3 | Role × package test matrix passes |
| AUD-003 | P1 | Dual navigation architecture | Phase 1 | One shell per route; no duplicate bars |
| AUD-004 | P1 | Access rights link points to employee list | Phase 1/2 | Correct route and active state test |
| AUD-005 | P1 | Inventory destinations reuse component without explicit section | Phase 2 | Each route has expected unique heading/content and working actions |
| AUD-006 | P1 | Stores settings route has no explicit section context | Phase 2 | Settings route shows settings-specific content |
| AUD-007 | P1 | Placeholder destinations need explicit inventory | Phase 2/6 | Every nav item classified implemented, planned, or retired |
| AUD-008 | P1 | PMS partial fetch failures appear as empty data | Phase 4 | Failure states differentiated from empty states |
| AUD-009 | P1 | POS sample defaults vs persisted configuration need boundary tests | Phase 5/6 | New-property and existing-property persistence tests |
| AUD-010 | P1 | No route-to-component integration test matrix | Phase 1/2 | Every nav link tested against expected route/component |
| AUD-011 | P2 | Migration copies under `v6/` can drift from root migrations | Phase 7 | Determine whether `v6/` is shipped/used; document canonical migration directory |
| AUD-012 | P2 | Build-green status can be misread as end-to-end verification | Phase 9 | Browser/E2E workflow and production smoke test evidence |

## 5. Phase 0 exclusions

This baseline commit intentionally does **not**:
- edit runtime behavior;
- change roles, entitlements, or RLS policies;
- rename or delete migration files;
- remove legacy components before all usages are mapped;
- claim that every feature has been tested manually.

## 6. Phase 0 exit checklist

- [x] Capture tracked-file inventory and identify major application/backend areas.
- [x] Record current CI workflow status and what it does/does not prove.
- [x] Identify initial high-confidence route/navigation and migration risks.
- [x] Create a prioritized defect register with acceptance evidence.
- [ ] Complete every component/service/RPC/RLS relationship in a machine-readable feature map.
- [ ] Run a fresh local install/build and browser smoke suite in an isolated environment.
- [ ] Compare migration history with the deployed Supabase project without modifying production.

**Phase 0 status: baseline findings documented; exit gate is not yet fully satisfied.** The remaining checklist items are prerequisites for declaring the audit exhaustive and moving to broad refactoring.


## 7. Live Supabase production baseline (read-only)

Connected project identified as **`olitechs-pms-pos`** (`mszogmazldxjsiytrlxr`), region `eu-west-1`, status `ACTIVE_HEALTHY`. No DDL, data, or migration operation was executed during this audit.

The live migration ledger returned **34 applied versions**. This is substantially different in shape from the root repository's long set of numeric-prefix and timestamped migration files. The live ledger includes applied versions such as `20261008015806`, `20261008032718`, and `20261008145428`; some stored migration names do not match the full filename prefixes in the repository. This is evidence that the migration history must be reconciled, not evidence that the live schema is necessarily broken. The audit did not attempt to run pending migrations or compare every live table/function definition.

### Supabase advisors — findings to triage

The production project’s read-only advisors returned:

- **Security WARN:** 1 anonymous-callable `SECURITY DEFINER` function, `public.fn_public_booking_engine_config(p_property_id uuid)`. Confirm whether public execution is intentional and whether the function limits returned fields/property access.
- **Security WARN:** 96 authenticated-callable `SECURITY DEFINER` functions. This count is not 96 proven vulnerabilities; each function must be checked for explicit role/property authorization and least-privilege grants. Prioritize administrative, financial, staff, inventory, and cross-property RPCs.
- **Security WARN:** leaked-password protection is disabled in Supabase Auth.
- **Performance WARN:** 20 cases of multiple permissive RLS policies, including some policies that mention the `anon` role. Inspect the effective policy logic for unintended OR-permission widening; consolidate only after preserving required access.
- **Performance INFO:** 43 foreign keys without covering indexes and 107 unused indexes. Treat these as candidates for workload/schema review, not automatic delete/add instructions.

Advisor references:
- [Supabase database linter — SECURITY DEFINER functions callable by anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Supabase database linter — SECURITY DEFINER functions callable by authenticated users](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

**Safety requirement:** no broad grant revocation, RLS policy rewrite, index deletion, or migration replay is authorized by these warnings alone. Phase 3/7 must inspect each function/policy and prove expected access with tests before applying a forward-only fix.

## 8. Updated defect register additions

| ID | Priority | Finding | Owner phase | Acceptance evidence |
|---|---|---|---|---|
| AUD-013 | P0 | Root migration filenames and live migration ledger are not reconciled | Phase 7 | Every local migration mapped to live version/name; safe forward-only plan approved |
| AUD-014 | P0 | Anonymous execution warning for `fn_public_booking_engine_config` | Phase 3/7 | Public use-case documented and function output/authorization tested; grants minimized |
| AUD-015 | P1 | 96 authenticated-callable SECURITY DEFINER RPCs require authorization review | Phase 3/7 | RPC inventory includes caller grants, role/property checks, and positive/negative tests |
| AUD-016 | P1 | 20 multiple-permissive-policy advisor warnings | Phase 3/7 | Effective access evaluated per table/role/action; no unintended permission widening |
| AUD-017 | P1 | Leaked-password protection disabled | Phase 3 | Setting enabled or formally risk-accepted with owner approval |
| AUD-018 | P2 | 43 foreign keys lack covering indexes | Phase 7 | Query/workload-informed index review |
| AUD-019 | P2 | 107 indexes reported unused | Phase 7 | Review query windows and constraints before retaining/removing candidates |

The migration-ledger comparison is now **partially complete**: the live ledger was retrieved and its count/current entries recorded, but each live version still needs a file-by-file mapping and schema drift review. The final Phase 0 exit gate therefore remains open.
