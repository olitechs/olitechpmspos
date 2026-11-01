# Phase 2 — Core PMS implementation record

**Date:** 2026-11-01  
**Implementation branch:** `feature/phase-2-core-pms-current`  
**Base:** current `main` at Phase 2 branch creation  
**Status:** In progress — code changes prepared; production migration and end-to-end acceptance remain gated.

## Branch reconciliation

The historical `feature/phase-2-core-pms` branch is 178 commits behind current `main` and 27 commits ahead, with a diverged merge base. It was not force-updated or merged. A fresh implementation branch was created from current `main` to avoid carrying a stale base or overwriting newer work.

## Scope already present in current main

The current application already contains much of the Phase 2 foundation:

- `src/lib/pmsDateUtils.js` uses `Africa/Nairobi` for PMS date keys, validates ISO civil dates, models stays as half-open ranges, and detects overlaps in the UI.
- `src/lib/pmsDateUtils.test.js` covers Nairobi date boundaries, local-noon calendar dates, invalid dates, half-open same-day turnover, and inactive reservation states.
- `src/components/pms/RoomPlanner.jsx` already has month and rolling-range modes, reservation movement and group movement calls.
- `src/services/pmsService.js` uses transactional RPCs for reservation bundle creation, planner edits, moves, check-in, check-out and front-desk payments.
- `src/components/modules/Reservations.jsx` already exposes reservation operations and reservation audit history.
- Housekeeping UI uses the server-side housekeeping RPCs for task state transitions and inspection.

These existing workflows were retained; this implementation does not rewrite the large Room Planner or POS financial code.

## Production read-only findings

The connected production project was inspected without executing DDL or DML.

### P0 — Reservation overlap checks are not concurrency-safe

- `fn_check_room_availability(uuid,uuid,date,date,uuid)` performs ordinary SELECT checks against active reservations and room closures.
- `fn_create_reservation_bundle`, `fn_update_planner_reservation`, and `fn_move_planner_reservation` call the availability check before writing.
- The production `reservations` table has no exclusion constraint preventing overlapping room/date ranges.
- The production `reservations` and `room_closures` tables have no non-internal triggers.
- A read-only preflight found zero existing active-reservation overlaps and zero active-reservation/closure overlaps at inspection time.
- Therefore two concurrent transactions can both observe availability before either commits and both insert an overlapping reservation. The UI check cannot close this race.

### P1 — Folio deposit and checkout migration drift

The live migration ledger includes `phase2_folio_checkout_housekeeping` at version `20261008040134`, but does not include the repository migrations:

- `20261009100000_phase2_pms_audit_trail.sql`
- `20261009103000_phase2_folio_payment_reconciliation.sql`

The live `fn_record_front_desk_payment` checks the outstanding posted folio charges. It does not include the newer pre-check-in booking-total reconciliation logic from the repository migration. The live `fn_check_out_room` also uses the older balance implementation. The exact newer migration must be tested against the current live schema before rollout.

### P1 — Reservation audit trigger migration is not applied

The production migration ledger does not record `20261009100000_phase2_pms_audit_trail.sql`. Reservation audit reads exist in the app, but production reservation/room tables currently have no user-defined triggers from the inspected trigger catalog. Audit-history availability must be verified after that migration is reconciled and applied.

## Changes in this implementation

### `20261101090000_phase2_room_inventory_concurrency.sql`

Adds two SECURITY DEFINER trigger functions with pinned search paths and row-security bypass limited to internal trigger execution:

1. Reservation guard: serializes active reservation writes per property and rejects overlapping booked/checked-in reservations or overlapping room closures.
2. Room-closure guard: uses the same property-level transaction lock and rejects a closure that overlaps an active reservation.

A property-level advisory transaction lock is intentionally used instead of one lock per room. It avoids lock-order deadlocks for multi-room group bookings and serializes the comparatively low-volume room-inventory writes within one property. It does not block other properties.

Both triggers preserve half-open stay semantics: `[arrival, departure)`. A departure and a new arrival on the same date do not overlap. Existing reservation and closure rows are not rewritten.

### Regression coverage

The migration was applied successfully to a fresh PostgreSQL 17 service database in GitHub Actions. The ephemeral integration harness (`supabase/tests/phase2_room_inventory_integration.sh`) ran independent PostgreSQL sessions and passed the following checks:
- same-day turnover is accepted;
- overlapping reservation insert is rejected;
- reservation overlapping a room closure is rejected;
- closure overlapping an active reservation is rejected;
- concurrent overlapping reservation transactions serialize and the second is rejected;
- concurrent reservation-versus-closure transactions serialize and the second is rejected.

The CI run is linked from PR #54 under **Phase 2 PostgreSQL integration**. This fixture proves the new trigger logic against PostgreSQL 17, but is intentionally minimal and does not establish compatibility with every production column, policy, RPC, or historical migration.

`supabase/tests/phase2_room_inventory_concurrency.test.mjs` checks that the migration retains:
- property-scoped transaction locks;
- pinned SECURITY DEFINER search paths;
- active-status and half-open overlap predicates;
- closure/reservation mutual exclusion;
- trigger-only function grants;
- forward-only, non-destructive migration structure.

The test is included in `npm run test:architecture`.

## Audit/folio migration reconciliation status

A source-level compatibility review against the repository's schema history found:
- `audit_logs` is initially defined with `actor_id`, `action`, `property_id`, `old_value`, `new_value`, and `created_at`; the audit migration adds the three entity-reference columns and indexes without changing those base fields.
- `payments.status` and `payments.shift_id` are introduced by the existing cashier migration; `reservations.total_amount` is introduced by the Room Planner migration.
- The folio migration's replacement `folio_totals` keeps the original view's five-column shape (`reservation_id`, `property_id`, `subtotal`, `paid`, `balance`) and numeric aggregate outputs.
- The existing folio checkout migration drops/recreates `fn_check_out_room` with the `public.reservations` return type, so the later `CREATE OR REPLACE` uses the same declared return type in the repository's ordered migration history.

This is source-history compatibility only. The production migration ledger previously inspected does not contain `20261009100000` or `20261009103000`, and production function bodies are older. The current Supabase connector could not authenticate to the PMS production project during this execution; the other available Supabase connection resolves to a different project and was not used. Therefore the live catalog, view dependencies, constraints, RLS policies, function grants, and exact migration ledger have **not** been re-read or reconciled in this run. Neither migration has been applied.

## Deployment and acceptance gates

No production SQL has been run and no production data has been modified.

Before production rollout:
1. Back up the database and verify restoration.
2. Reconcile the live migration ledger and SQL definitions for the two existing Phase 2 migrations above.
3. Test all migrations on a disposable database first.
4. Apply the audit and folio reconciliation migrations in their documented order, if confirmed missing and safe for the live schema.
5. Apply the new concurrency guard migration.
6. Run concurrent-session tests for two simultaneous overlapping bookings, same-day turnover, room closure conflicts, grouped bookings, reservation moves and rollback behavior.
7. Verify front-desk deposits, folio balances, check-in/out, reservation audit history and housekeeping state transitions with real property roles.
8. Run repository lint, architecture tests, typecheck and production build.
9. Verify Room Planner month and rolling views and existing POS/folio behavior before requesting merge.

## Not yet claimed as complete

- No migration was applied to production.
- PostgreSQL 17 disposable integration tests passed for the new room-inventory migration, including real two-session concurrency tests; this fixture is not production-schema-equivalent.
- No authenticated browser end-to-end test was run.
- No lint, typecheck or Vite production build was run in this execution environment.
- No PR merge or deployment is authorized by this implementation record.
