# Phase 1 — Printer configuration integrity and admin separation

Date: 2026-10-12
Branch: `fix/kitchen-printer-routing-integration`

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

Static repository inspection completed. The following checks are still required before merge or deployment:

1. Run `npm run build`, `npm run lint`, and `npm run test:architecture` on the branch.
2. Apply the migration only to the already-existing disposable Supabase project after verifying its schema includes the 0061 store/printer tables and helper functions.
3. In the disposable project, test:
   - authorized owner/admin can create and update a printer group;
   - property manager and approved F&B manager roles follow the intended permission policy;
   - ordinary staff cannot add, update, or delete physical printers or printer groups;
   - an authenticated user cannot attach a category from another property;
   - an authenticated user cannot attach a printer from another store/workspace;
   - a deliberately invalid link causes the whole RPC transaction to roll back, preserving prior group/category/printer links;
   - unauthorized cross-property and cross-store access is denied.
4. Browser-check platform owner vs property admin route access and verify no route loop.
5. Physical printer/agent tests remain out of scope for Phase 1 and must be performed in Phase 3.

## Acceptance limitation

This report does not claim that build, lint, database authorization tests, or physical printing have passed. Do not apply this migration to production until the disposable schema baseline is proven schema-equivalent, the migration passes the above checks, and explicit deployment approval is provided.
