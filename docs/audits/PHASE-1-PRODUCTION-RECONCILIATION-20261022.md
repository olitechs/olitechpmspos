# Phase 1 production security reconciliation — read-only snapshot

**Captured:** 2026-10-22  
**Environment:** production Supabase project `mszogmazldxjsiytrlxr`  
**Change policy:** this document was prepared from SELECT-only catalog queries and Supabase advisory output. No production writes, migrations, data edits, or project setting changes were made.

## Confirmed live schema facts

- Supabase migration API currently reports **38 migration ledger rows**. It includes ledger entries for the six historical timestamps previously flagged as missing: `20261003114200`, `20261003114849`, `20261003114909`, `20261008022614`, `20261008023412`, and `20261008042951`. The earlier audit statement that these six entries were absent from the live ledger is stale and must not be relied on. This does not prove that the corresponding repository SQL file names/content match the deployed definitions; reconcile file contents and checksums before replaying anything.
- `public.staff_sessions` still has only `user_id`, `staff_id`, `property_id`, and `verified_at`. It has no explicit module, expiry, or revocation columns in the current live schema.
- The read-only policy inventory found 36 policies across 16 tables whose expressions directly reference `current_staff_role`.
- Eight UPDATE policies have a NULL `WITH CHECK`: `housekeeping_tasks_update`, `inventory_items_update`, `inventory_movements_update`, `maintenance_tickets_update`, `property_users_update`, `rate_plans_update`, `room_closures_update`, and `room_types_update`. Their current USING predicates differ; do not apply a blanket policy rewrite. Review row identity/property invariants, triggers, and intended mutability table by table.
- The current production grants still allow `anon` to execute `public.fn_public_booking_engine_config(uuid)` as SECURITY DEFINER.
- Current Supabase security advisors report: one RLS-enabled table with no policies (`staff_pin_attempts`); one anon-executable SECURITY DEFINER function (`fn_public_booking_engine_config`); 96 authenticated-executable SECURITY DEFINER functions requiring function-by-function authorization review; and leaked-password protection disabled in Auth.
- The broad SECURITY DEFINER advisor is an inventory, not proof that every listed RPC is exploitable. Review the actual body, grants, callers, tenant checks, and intended exposure before changing EXECUTE grants.

## Phase 1 candidate status

The forward-only candidate migration is `supabase/migrations/20261022180000_phase1_staff_session_expiry_scope.sql`. Its current CI passes against the repository's minimal PostgreSQL fixture, but the fixture is not a production-equivalent schema. No production migration has been applied.

## Required next gates

1. Reconcile all 38 live migration ledger rows to repository files and live function/policy definitions. Treat timestamp/name mismatches as unresolved until content is compared; never replay historical SQL just because a ledger name differs.
2. Build a schema-equivalent disposable database from the verified migration chain, including auth roles/functions, enums, RLS policies, triggers, grants, and subscription lifecycle functions. The connected Supabase organization currently cannot create a free development branch because branching is plan-gated and has reached its active-project limit; do not use production or an unrelated project as a substitute.
3. Run two-property negative tests against that environment, including session lifecycle, role/module entitlement, direct-table RLS, RPC tenant boundaries, platform-owner behavior, public booking config, staff PIN throttling, and subscription lifecycle.
4. Review all SECURITY DEFINER RPCs that accept caller-controlled property/user IDs; prioritize `create_pending_property_for_user`, `fn_list_pos_menu`, `fn_current_pos_shift`, `fn_public_booking_engine_config`, subscription provisioning/access, financial and inventory mutations.
5. Run Supabase security advisors and full application checks on the final PR head. Keep the PR draft and do not apply the migration to production until all gates pass.
