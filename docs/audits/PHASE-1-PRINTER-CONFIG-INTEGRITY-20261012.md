# Phase 1 — Printer configuration integrity and admin separation

Date: 2026-10-12
Branch: `fix/kitchen-printer-routing-integration`
Pull request: https://github.com/olitechs/olitechpmspos/pull/22

## Scope implemented

- Added `fn_save_store_printer_group`, a single database transaction for group create/update plus category and printer link replacement.
- The RPC validates store/workspace/property identity, group name length, duplicate IDs, category ownership by property, and printer ownership by store/workspace.
- Added a database trigger that rejects printer-group links where the group and physical printer belong to different stores/workspaces.
- Split broad store-printer write policies into read policies and manager/admin-only write policies. Platform owners remain permitted through the existing platform-owner helper; property owner/admin/manager and approved F&B staff roles are considered.
- Updated the printer store to use the atomic RPC, surface hydration errors, scope deletion/status updates to the selected store, and validate manual IP/hostname and port input.
- Hardened the admin route UX: property administrators are redirected away from platform-wide property/subscription/audit routes; platform owners are redirected away from property staff/settings routes. Property-admin dashboard navigation now leads to the property back office.

## Safety

- No production Supabase migration was applied.
- No production rows were modified.
- The migration is additive and is committed on the feature branch only.
- Route guards are defense in depth; database RLS/RPC authorization remains authoritative.

## Verification status

### Passed in GitHub Actions on the initial Phase 1 commit

- Lint
- Typecheck
- Navigation and role-access tests
- Theme-contrast audit
- Production build
- Production QA workflow build

The migration received a follow-up SQL policy cleanup after that run. CI must be rechecked against the latest PR head before merge.

### Database verification is blocked by the current disposable schema

A read-only catalog check of the existing disposable project found these required Phase 1 objects absent: `stores`, `workspace_members`, `store_members`, `printer_groups`, `printer_group_categories`, `printer_group_printers`, `printers`, `pos_menu_categories`, `is_workspace_member(uuid)`, and `is_store_member(uuid)`. Therefore this migration cannot be safely exercised on the current disposable schema until the baseline restoration/equivalence step is completed. The existing project was not modified.

Required tests after the baseline is corrected:

1. Apply the migration only to the already-existing disposable Supabase project after verifying its schema includes the 0061 store/printer tables and helper functions.
2. Test authorized owner/admin, property manager and approved F&B manager permissions.
3. Verify ordinary staff cannot add, update, or delete physical printers or printer groups.
4. Verify categories from another property and printers from another store/workspace are rejected.
5. Verify a deliberately invalid link rolls back the entire RPC transaction, preserving prior group/category/printer links.
6. Verify unauthorized cross-property and cross-store access is denied.
7. Browser-check platform owner vs property admin route access and verify no route loop.
8. Physical printer/agent tests remain out of scope for Phase 1 and must be performed in Phase 3.

## Acceptance limitation

Phase 1 code changes are not yet approved for production deployment. Do not apply this migration to production until the disposable schema baseline is proven schema-equivalent, the migration passes the database authorization/atomicity tests, the latest CI is green, and explicit deployment approval is provided.
