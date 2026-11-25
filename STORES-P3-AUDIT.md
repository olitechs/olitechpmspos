# Storekeeper Workspace — Phase 3 Audit and Implementation Plan

**Date:** 2026-11-25
**Branch:** `phase3/stores-audit`
**Baseline:** `phase2/stores-transfers` at `327b7100`
**Status:** APPROVED BY USER on 2026-11-25 for the full inferred scope (D22–D30) and the “Preserve ops, drop manager” permission matrix. Implementation is complete as a local commit on `phase3/stores-audit`; no push, merge, tag or release has been made.

## 1. Scope status

There is no dedicated Storekeeper Phase 3 specification in the repository. The only direct Phase 3 carry-over is in the approved Phase 1 audit:

- `STORES-P1-AUDIT.md:583`: “Splitting `storekeeper` from `store_manager`, editable role templates and the dry-run migration — **Phase 3**.”
- `STORES-P1-AUDIT.md:576`: “`authService` role split (Phase 3).”
- `docs/STORES-WORKFLOWS.md:172`: “`storekeeper` / `store_keeper` still alias to `store_manager` and can approve until the split. The seeded `Storekeeper` template cannot.”
- `docs/architecture/STORES_REQUISITIONS_ISSUE_NOTES_IMPLEMENTATION_BASELINE.md:18`: “Existing `store_manager` assignments and permissions remain compatible. A distinct Storekeeper role is introduced additively; no existing employee is silently reassigned.”

Phase 2 is closed and must not be reopened:

- `STORES-P2-AUDIT.md:10`: “Phase 2 covers in-transit stock transfers only.”
- `STORES-P2-AUDIT.md:20`: “No other phase is opened. No destructive refactor is authorized.”

The best-supported Phase 3 scope is therefore an **inferred role/authorization cleanup phase**. It must be approved before implementation.

## 2. Proposed Phase 3 scope

Phase 3 will:

1. Make `storekeeper` a distinct canonical role from `store_manager` in client and server role resolution.
2. Reconcile the seeded role templates with the actual Stores permission catalog.
3. Add a dry-run review artifact before any role-split effect is accepted; no employee is silently reassigned.
4. Add Accountant and Auditor read/cost/report templates.
5. Make built-in role templates editable through the unified roles surface, with impact warning and audit.
6. Unify the two role administration surfaces without deleting staff/module assignment behavior.
7. Add package-disabled permission hints to the role editor. UI hints must never grant permissions.
8. Update the role/navigation contract tests deliberately.

Phase 3 will **not**:

- change requisition, issue-note or transfer lifecycle behavior;
- add wastage approval (D8 chose not to build it in Phase 1);
- open printer-agent, PMS, POS payment or financial work;
- rewrite or renumber applied migrations;
- apply migrations to a live project without staging verification;
- push, merge or release without explicit approval.

## 3. Baseline findings

### 3.1 Client aliases currently collapse Storekeeper into Store Manager

- `src/services/authService.js:29`: `storekeeper:'store_manager', store_keeper:'store_manager'`.
- `src/data/modules/navArchitecture.js:40`: `store_keeper:'store_manager', storekeeper:'store_manager'`.
- `src/services/authService.js:19` and `:25` expose only `store_manager` in `STAFF_ROLES` / `ROLE_LABELS`.
- `src/data/modules/navArchitecture.js:7` and `:20-38` give Stores navigation to `store_manager`, with limited `storekeeper` access only on requisition/request screens.

### 3.2 Server resolver has drifted from the seeded templates

- `supabase/migrations/20261123093000_phase1_stores_permissions_roles.sql:176-191` seeded:
  - `Storekeeper` as non-approving, with requisition view/issue/receive and no costs or cost-centre management.
  - `Store Manager` with approval, void, costs and cost-centre management.
- `supabase/migrations/20261123154837_storekeeper_full_stores_workspace_access.sql:8-21` overwrote `Storekeeper` with the full operational bundle: access, inventory view, receive, issue, transfer, adjust, suppliers and production posting.
- The same migration at `:89-91` made the legacy resolver branches:
  - `store_manager`: 7 operational codes.
  - `storekeeper` / `store_keeper`: 8 operational codes including `stores.production.post`.
- Neither the overwritten template nor the resolver branches include the Phase 1 requisition codes. This is the drift Phase 3 must reconcile.

### 3.3 Role administration is split across two surfaces

- `src/components/employees/RolesPermissionsPanel.jsx` manages `employee_roles` permission bundles. Built-ins are locked at `:142` and edit/delete actions are limited to `!row.is_system` at `:152-159`.
- `src/pages/Admin/Roles.jsx` manages staff, `STAFF_ROLES`, `assigned_modules` and PINs through `authService`.
- `src/data/modules/navArchitecture.js:13` exposes both “Roles & permissions” and “Access rights” entries.
- `STORES-P1-AUDIT.md:229` says Phase 3 should unify these surfaces without silently changing legacy semantics.

### 3.4 Package hints are absent

- `STORES-P1-AUDIT.md:230`: “No package-disabled permission hint exists today (a Phase 3 requirement).”
- `src/data/modules/navArchitecture.js:41` already defines `PACKAGE_MODULES`: `standard` excludes Stores; `premium` and `professional` include it.
- `src/lib/permissions.js:18-20` already maps workspace keys to app IDs. This is the correct UI-only source for hints.

### 3.5 Tests encode the old aliases

- `src/data/modules/navArchitecture.test.js:27-28` asserts Storekeeper aliases to `store_manager`.
- `src/data/modules/navArchitecture.test.js:41-42` asserts access/default app through the alias.
- `src/data/modules/navigationRouting.test.js:59-63` asserts alias regexes in `navArchitecture.js` and `authService.js`.
- `supabase/tests/storekeeper_operational_modules_contract.test.mjs:63-71` asserts the current server alias/template drift.
- `supabase/tests/phase1_employee_management_contract.test.mjs:81-100` asserts the seven operational codes and workspace scoping.
- `supabase/tests/phase1_stores_requisitions_contract.test.mjs:79` asserts the original non-approving Storekeeper template description.

These tests need deliberate Phase 3 updates if D22/D23 are approved.

## 4. Proposed decisions D22–D30

| ID | Proposed decision |
|---|---|
| D22 | `storekeeper` and `store_keeper` normalize to canonical `storekeeper`, not `store_manager`. `store_manager` remains a valid, compatible legacy/canonical role. No existing employee row is silently reassigned. |
| D23 | One forward-only migration becomes the authority for the role matrix. It preserves current operational Storekeeper access, restores the missing Phase 1 requisition codes, and removes only manager-only controls from Storekeeper. |
| D24 | A dry-run review function/report lists per-property staff, current role, `role_id`, assigned modules, proposed canonical role and affected templates. It emits no `UPDATE` on staff. Explicit admin action is required for any reassignment. |
| D25 | Built-in role templates are editable but not deletable. Editing a built-in shows an impact warning naming affected employees, requires confirmation and writes an audit entry. |
| D26 | The legacy “Access rights” surface is folded into `/backoffice/employees/roles`; staff/module/PIN functionality is preserved rather than deleted. |
| D27 | The role editor shows package-disabled hints from `PACKAGE_MODULES` / workspace mapping. Hints are explanatory only; RLS/RPCs remain the authority. |
| D28 | Accountant gets read + cost + report access. Auditor is added as read + cost + report access without billing management or stock writes. |
| D29 | Navigation roles are split: Storekeeper receives operational Stores entries; manager-only entries (approvals, costs, cost centres, valuation) remain admin/owner/store_manager. Permission-code gates in `AppShell.jsx` remain in force. |
| D30 | Existing alias tests are deliberately replaced with split-role tests. New source-contract tests cover the migration, templates, dry-run report, role editor hints and navigation split. |

### 4.1 Proposed permission matrix

| Role | Permission codes |
|---|---|
| Storekeeper | `stores.access`, `stores.inventory.view`, `stores.stock.receive`, `stores.stock.issue`, `stores.stock.transfer`, `stores.stock.adjust`, `stores.suppliers.manage`, `stores.production.post`, `stores.requisition.view`, `stores.requisition.issue`, `stores.requisition.receive`, `stores.stock.wastage.submit` |
| Store Manager | Storekeeper codes plus `stores.requisition.create`, `stores.requisition.approve`, `stores.issue.void`, `stores.costs.view`, `stores.costcentre.manage`, `stores.inventory.valuation.view`, `stores.stock.wastage.approve` |
| Department Requester | `stores.access`, `stores.requisition.create`, `stores.requisition.view`, `stores.requisition.receive` |
| Accountant | `back_office.access`, `back_office.reports.view`, `back_office.billing.manage`, `stores.access`, `stores.inventory.view`, `stores.costs.view`, `stores.inventory.valuation.view` |
| Auditor | `back_office.access`, `back_office.reports.view`, `stores.access`, `stores.inventory.view`, `stores.costs.view`, `stores.inventory.valuation.view` |

This matrix was approved by the user on 2026-11-25 with the “Preserve ops, drop manager” option. It deliberately preserves the later operational Storekeeper grant while restoring the Phase 1 requisition codes and withholding manager-only approval/cost controls. `stores.stock.wastage.submit` is preserved from the Phase 7 wastage workflow because it is operational, not managerial; Storekeeper still has no wastage approval permission.

## 5. Files expected to change after approval

**Migrations and templates**

- `supabase/migrations/20261125110000_phase3_stores_role_split_review.sql` — dry-run review function and review table/view.
- `supabase/migrations/20261125111000_phase3_stores_role_templates.sql` — forward-only template reconciliation, Accountant/Auditor templates and resolver alignment.
- `supabase/templates/phase3_stores_role_authorization.sql` — CLI/template mirror used by source-contract tests.
- `supabase/templates/storekeeper_full_stores_workspace_access.sql` — retained as deployment history; tests may reference it for drift history only.

**Client role resolution and navigation**

- `src/services/authService.js` — canonical split, labels, staff roles and default modules.
- `src/data/modules/navArchitecture.js` — split aliases and Stores navigation role lists.
- `src/components/layout/AppShell.jsx` — permission map verification only; no broad role bypass.
- `src/lib/permissions.js` — package-hint metadata only.

**Role administration**

- `src/components/employees/RolesPermissionsPanel.jsx` — built-in template editing, impact warning, package hints.
- `src/components/employees/EmployeeConsole.jsx` and `src/routes/AppRoutes.jsx` — unified console tab and preserved legacy route.
- `src/services/employeeService.js` — RPC wrappers for audited template edits and dry-run review.
- `src/components/shell/Sidebar.jsx` and `src/data/modules/sidebarNavigation.js` — split-role and unified-surface labels.
- `src/pages/admin/Roles.jsx` — retained unchanged behind the unified `Staff & access rights` tab.

**Tests and docs**

- `supabase/tests/phase3_stores_role_authorization_contract.test.mjs` — new Phase 3 contract suite.
- `supabase/tests/phase1_stores_requisitions_contract.test.mjs` — reviewed; historical drift assertions left unchanged.
- `supabase/tests/phase1_employee_management_contract.test.mjs` — reviewed; historical resolver assertions left unchanged.
- `supabase/tests/storekeeper_operational_modules_contract.test.mjs` — reviewed; historical migration assertions left unchanged.
- `supabase/tests/phase7_1_wastage_approval_runtime.sql` — update expected Storekeeper bundle and preserve wastage submission.
- `src/data/modules/navArchitecture.test.js` — update split-role assertions.
- `src/data/modules/navigationRouting.test.js` — update alias regex assertions.
- `docs/STORES-WORKFLOWS.md` — Phase 3 section and role matrix.

## 6. Risks and controls

| Risk | Control |
|---|---|
| Existing Storekeeper staff suddenly gain/lose access | Dry-run review first; no silent staff reassignment; explicit admin action for reassignments. |
| Editing a built-in template changes many employees at once | Impact preview with affected employee count/names, confirmation and audit entry. |
| UI hints are mistaken for grants | Hints are read-only UI metadata; server re-validates all codes. |
| Two role surfaces diverge again | One canonical roles page; legacy access-rights behavior preserved behind the unified surface. |
| Historical migration drift is hidden | Add forward-only migrations only; never rewrite or renumber applied migrations. |
| Source-contract tests are not runtime proof | Staging Postgres verification remains required before production. |
| Unrelated phases reopen | Explicit exclusions in §2; Room Planner, Floor, payment colours, printer agent and PMS/POS financial work untouched. |

## 7. Exit checks after implementation

1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`
4. `node --test supabase/tests/phase3_stores_role_authorization_contract.test.mjs`
5. `node --test supabase/tests/phase1_stores_requisitions_contract.test.mjs supabase/tests/phase1_employee_management_contract.test.mjs supabase/tests/storekeeper_operational_modules_contract.test.mjs`
6. `node --test src/data/modules/navArchitecture.test.js src/data/modules/navigationRouting.test.js`
7. `npm run test:reports`
8. Verify Phase 1 and Phase 2 Stores routes, navigation, reports and SoD checks remain green.
9. Verify no secrets, no workflow changes and no print-agent changes are included.
10. Report files changed, migrations added, checks run, build result, regressions checked and remaining staging risk.
11. No push, merge, tag or release without explicit user approval.

## 8. Approval record

The user approved the full inferred scope (D22–D30) and the “Preserve ops, drop manager” permission matrix on 2026-11-25. Implementation is authorized in this worktree only. Push, merge, tag and release remain separately gated.

## 9. Implementation result

- Targeted contract/navigation suites: **73/73 pass**, including the new Phase 3 contract suite and the existing Phase 1/2 Stores and Storekeeper navigation suites.
- `npm run lint`: pass, including brand-system, colour-token and link audits.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npm run test:reports`: **13/13 pass**.
- Local Windows `npm run test:architecture`: **642 pass, 1 skipped, 4 fail**. The failures are environment-only and unchanged by Phase 3: one test expects LF while the Windows checkout materialises CRLF, and three print-agent lifecycle cases pass Windows absolute paths to `--import` instead of `file://` URLs under Node 26.
- `git diff --check`: pass. No workflow, package manifest, lockfile, environment or print-agent files are included. The Phase 3 template mirror is byte-identical to the forward-only migration.
- No migration was applied to a live or local Postgres. Staging verification remains required before production.
