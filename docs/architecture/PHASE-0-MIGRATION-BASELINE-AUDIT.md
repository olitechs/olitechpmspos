# Phase 0 — Migration Baseline Audit

**Audit date:** 2026-10-31  
**Repository:** `olitechs/olitechpmspos` (`main`)  
**Supabase project ref:** `mszogmazldxjsiytrlxr` (`olitechs-pms-pos`)  
**Scope:** Read-only repository and Supabase catalog/history inspection. No production DDL or data writes were performed.

## Decision

**Phase 0 is in progress and is blocked from producing a safe baseline.** Do not delete or rename existing migration files and do not mark the current database as reconciled. The repository and the live migration ledger do not provide a reliable one-to-one migration mapping, and the full schema-only dump plus a reproducible local diff has not yet been produced.

The proposed single baseline can be introduced only after a schema-only snapshot has been captured and verified against the live catalog, the current migration ledger has been reconciled, and a clean disposable/local database can be built from the candidate baseline. The current live project must not be reset or have migration history rewritten to make the numbers line up.

## Findings

### 1. Migration files and history are not aligned

Repository scan of `supabase/migrations/` found:

- **129 SQL migration files** plus a README.
- **79 legacy four-digit-prefix files** and **50 timestamped 14-digit-prefix files**.
- Duplicate legacy migration version prefixes:
  - `0016`, `0028`, `0032`, `0033`, `0034`, `0035`, `0037`, `0040`, `0045`, `0047`, `0048`, `0049`.
- Duplicate timestamp prefixes:
  - `20261008170000`: `phase7_backoffice_timecards` and `phase8_daily_hotel_metrics`.
  - `20261008223000`: `fix_inventory_location_function_volatility` and `phase10_production_index_cleanup`.
- `0066_printer_cash_drawer_configuration.sql` uses a four-digit name despite the later timestamp naming convention. It must not be assumed to be a valid, applied live migration solely because it exists in Git.
- Supabase migration history currently reports **38 applied entries**. The stored versions and migration names do not consistently match repository filename prefixes/names. Some database history names contain the original filename timestamp in the name while the actual applied version is a different timestamp.

These are evidence of migration-ledger drift/renaming and ordering ambiguity, not proof that every repository migration is unapplied. Each SQL change must be mapped to the live ledger and actual schema before a pending/applied classification is made.

### 2. Live schema inventory (read-only catalog queries)

The configured Supabase project currently reports:

| Catalog check | Result |
|---|---:|
| Base tables / partitioned tables in `public` | 79 |
| Views / materialized views in `public` | 5 |
| Base tables with RLS disabled | 0 |
| Base tables without a `workspace_id` column | 78 of 79 |
| Tables with at least one policy targeting the `public` role | 64 |
| Policies in `public` | 217 |
| Policies targeting `public` | 193 |
| Functions in `public` | 136 |
| Functions marked `SECURITY DEFINER` | 100 |

Interpretation:

- RLS being enabled on every catalogued base table is positive but **does not by itself prove tenant isolation**.
- The schema is primarily property-scoped today; the requested universal `workspace_id` model is not present on 78 of 79 base tables. Do not mass-add nullable `workspace_id` columns until the workspace/property ownership mapping and backfill rules are defined.
- Policies targeting `public` need per-policy review of their predicates, grants, and callable RPC surface. Their role target alone is not enough to conclude a policy is vulnerable.
- The `SECURITY DEFINER` functions require a separate authorization, search-path, and EXECUTE-grant audit. Counts alone do not prove a vulnerability.

These figures are catalog metadata, not a full schema dump. No row contents were exported.

### 3. Supabase Advisor snapshot (2026-10-31)

The connected project's advisors returned the following findings:

- **Security:** one `anon`-executable `SECURITY DEFINER` function (`public.fn_public_booking_engine_config(uuid)`), 96 `authenticated`-executable `SECURITY DEFINER` function findings, and one RLS-enabled table with no policies (`public.staff_pin_attempts`). Some authenticated RPCs may intentionally be callable, but each function needs an explicit caller/authorization contract and least-privilege EXECUTE grants. The anonymous booking config function needs a documented public-data justification or its grant must be narrowed. The staff PIN attempts table needs a reviewed access design; do not add a broad policy just to silence the advisor.
- **Performance:** 45 foreign-key constraints were reported without covering indexes. These should be reviewed against actual query patterns and existing composite indexes before adding indexes; blindly indexing every foreign key can increase write cost.

Advisor findings are a live snapshot and may change as the schema changes. This audit does not treat all findings as confirmed exploits; it records concrete items requiring review before the security and performance acceptance gates can pass.

### 4. Baseline blockers

1. **No verified schema-only dump in the repository.** The MCP catalog inventory is not a replacement for `supabase db dump` / `pg_dump --schema-only`; it does not reconstruct every DDL statement, trigger body, grant, extension, sequence, type, or policy definition in a replayable baseline.
2. **No clean local rebuild/diff evidence.** This environment has not run the repository's Supabase CLI, `supabase db reset`, `supabase db diff`, or `supabase migration list` locally.
3. **Duplicate migration prefixes.** Multiple files claim the same migration version, making deterministic replay dependent on tooling/order and historical application details.
4. **History-to-file reconciliation incomplete.** Existing migration history cannot safely be rewritten based on filename matching alone.
5. **Data-preserving baseline strategy unresolved.** A baseline that represents the current live schema must be tested on an empty local database and then used for forward-only future changes; it must not be pushed over the live database as a reset.
6. **Workspace model is not yet normalized.** The current schema is mostly property-scoped, so workspace membership, workspace ownership, and legacy property mapping must be designed before Phase 1 tenant migration.

## Safe next steps for Phase 0

1. From a controlled environment with the correct Supabase CLI version and access, take a **schema-only** dump of the configured project. Store it in a restricted backup location first; commit only the reviewed schema baseline, never credentials or production rows.
2. Capture the exact CLI migration list and compare it to the 38 live history entries. For each repository migration, classify it as applied-equivalent, unapplied, superseded, duplicate, or historical/manual.
3. Resolve duplicate prefixes by content and historical evidence. Do not delete or silently rename applied migrations.
4. Generate a candidate `00000000000000_baseline.sql` from the verified schema, preserving roles/grants, extensions, enums/types, sequences, functions, triggers, policies, indexes, and relevant schema objects. Review any managed Supabase objects separately.
5. Build a clean local database from the candidate baseline, compare its schema with the captured source schema, and prove there is no unexplained drift.
6. Keep the legacy migration archive until the team explicitly approves a cutover plan. Use forward-only migrations after the baseline; do not reset or rewrite production history as part of the baseline exercise.

## Phase 0 exit criteria

- [ ] Schema-only dump captured, access-controlled, and versioned by checksum.
- [ ] All 38 live migration entries reconciled to repository SQL and schema effects.
- [ ] Duplicate migration prefixes resolved by a documented mapping.
- [ ] Candidate baseline builds a clean local database.
- [ ] Schema diff has no unexplained drift.
- [ ] Migration replay and CI checks pass.
- [ ] Explicit release plan approved before any production migration action.

**Current status: BLOCKED — audit recorded; no baseline has been generated or applied.**
