# Production Database Migration Reconciliation

**Project:** `mszogmazldxjsiytrlxr`  
**Repository branch inspected:** `main`  
**Audit date:** 2026-11-14

## Purpose

Prevent a future `supabase db push` from replaying SQL that has already been applied manually or through the Supabase migration API.

Supabase compares the timestamp prefix of files in `supabase/migrations/` with `supabase_migrations.schema_migrations.version`. A matching schema object or a similar migration name is not, by itself, proof that a particular SQL file was applied.

## Current findings

- The repository contains **69 timestamped SQL migration files**.
- The production history contains **2 exact timestamp matches** for those files.
- **38 files** have a plausible matching applied-history entry by migration name, but their file timestamp differs from the recorded version. These require content-level verification before repair.
- **31 files** have no convincing name match in the production history. They must be reviewed individually; do not mark them applied just because some related database objects exist.
- Two pairs of files share a timestamp prefix:
  - `20261008170000_phase7_backoffice_timecards.sql` and `20261008170000_phase8_daily_hotel_metrics.sql`
  - `20261008223000_fix_inventory_location_function_volatility.sql` and `20261008223000_phase10_production_index_cleanup.sql`

  Supabase migration versions are timestamp-based, so each file in a pair needs a unique timestamp before the repository can be considered clean. Do not rename these until dependency order and Git history have been checked.

## Eight migrations applied during the 2026-11-14 production session

These exact SQL files were fetched from `main` and applied successfully to production using the Supabase migration API. Their production history records were created using the following names and generated versions:

| Repository file | Current production history version |
|---|---:|
| `20261113100000_booking_engine_booking_url.sql` | `20261114052328` |
| `20261104100000_phase2_reservation_concurrency_hardening.sql` | `20261114052607` |
| `20261104120000_phase2_walk_in_concurrency_hardening.sql` | `20261114052615` |
| `20261104180000_phase3_pos_folio_room_planner_hardening.sql` | `20261114052621` |
| `20261108100000_room_planner_option_expiry.sql` | `20261114052629` |
| `20261109100000_front_office_structure_foundation.sql` | `20261114052642` |
| `20261110190000_fix_pos_table_join_and_quantity_voids.sql` | `20261114052647` |
| `20261105100000_phase2_guest_folio_management.sql` | `20261114052712` |

The original repository timestamps are not yet present in the remote migration history. The schema changes are already applied; do not run these SQL files again.

## Safe repair procedure for the eight confirmed files

Use the official Supabase CLI migration-repair command from the repository root, linked to the production project. This changes migration tracking only; it does not execute the migration SQL.

```powershell
supabase link --project-ref mszogmazldxjsiytrlxr

supabase migration repair 20261113100000 20261104100000 20261104120000 20261104180000 20261108100000 20261109100000 20261110190000 20261105100000 --status applied --remote

supabase migration list --remote
```

Before running the repair, confirm that the eight original files still contain the same SQL that was applied during the production session. If any file has since changed, stop and compare its Git history and current contents first.

## Remaining reconciliation work — do not auto-apply

1. Compare the contents and Git history of each of the 38 name-matched files with the SQL represented by its existing production migration record. Only then decide whether its original timestamp should be marked applied.
2. Inspect each of the 31 unmatched files against the live schema, functions, triggers, policies, indexes, constraints, and data effects. Classify each as:
   - already applied under another recorded migration;
   - superseded by a later migration;
   - genuinely pending and safe to apply;
   - obsolete or incompatible and should be archived/replaced.
3. Review the two duplicate timestamp pairs and assign unique timestamps in dependency order. Do not change an applied migration's contents.
4. Run `supabase migration list --remote` and `supabase db push --dry-run --remote` after reconciliation. Do not run a real `db push` until the dry-run shows only intentionally pending migrations and each has been reviewed.
5. Keep a checked-in reconciliation ledger with the decision, evidence, and matching remote version for every file.

## Important production safeguards

- Never replay a migration merely to make the history look tidy.
- Never insert or delete rows directly in `supabase_migrations.schema_migrations`; use the supported Supabase CLI `migration repair` command.
- Do not mark a migration applied based only on a matching function/table name.
- Do not mark an unmatched migration as reverted unless the production history record is confirmed incorrect.
- Do not modify production business data while reconciling migration history.

## References

- [Supabase: Deploy database migrations and diagnose sync errors](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase CLI: migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair)
