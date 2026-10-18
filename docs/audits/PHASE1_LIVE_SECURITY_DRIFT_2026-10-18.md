# Phase 1 — Live Security Drift Findings

**Snapshot date:** 2026-10-18  
**Repository baseline:** `main` at `bca0e53494d6b5d69e60e1088e6e7c6138266d8da`  
**Scope:** Read-only production catalog/advisor audit, migration-provenance comparison, and focused transactional authorization tests in the existing free disposable project.  
**Safety:** No production DDL, grants, policies, functions, triggers, or data were changed. Test fixture changes were rolled back. No paid Supabase branch was created.

## Executive result

**Do not deploy a migration yet.** We found the guarded implementation in source control and in the existing disposable test database, but production's live function bodies still differ. The migration ledger/source mapping is incomplete, and the disposable database is not production-equivalent.

### Migration inventory and provenance

| Evidence | Production | Existing free disposable test project |
|---|---:|---:|
| Migration ledger entries | 38 | 56 |
| Public base tables | 79 | 48 |
| Public functions | 136 | 102 |
| Source-controlled migration SQL files | 127 (shared repo inventory) | Same repo inventory |

The repository has 78 legacy numbered migration files and 49 timestamp-prefixed files. There are 14 duplicate filename version prefixes, including duplicate legacy versions `0016`, `0028`, `0032`, `0033`, `0034`, `0035`, `0037`, `0040`, `0045`, `0047`, `0048`, `0049`, and timestamp collisions `20261008170000` and `20261008223000`.

20 of the 38 production ledger entries match a source migration filename after normalizing the leading version prefix from both names. The other 18 do **not** have an exact normalized filename match; this does not prove those migrations are absent, because some may be represented by combined, renamed, or re-versioned source files. They require manual content/object-level mapping before migration replay or repair.

Specific remediation provenance gaps:
- Production ledger ends at `20261013194854_restore_property_scoped_stores`.
- Source file `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` is not present in the production ledger.
- The disposable ledger contains `20261013180927_harden_booking_and_tenant_sensitive_rpcs`, but this uses a different version from the source file and the disposable schema is smaller than production. This proves a guarded implementation was exercised in the test project, not that the exact source migration was applied to production.
- Source files `20261011120000_phase0_rpc_tenant_guard_remediation.sql` and `20261011130000_phase0_rpc_rls_remediation.sql` also need a source-to-ledger mapping. Do not assume a similarly named test-only migration is byte-for-byte equivalent.
- Do not rewrite historical migrations, renumber colliding files, use `migration repair` to paper over unknown history, or replay the entire directory against production.

## Confirmed high-priority production findings

### 1. `create_pending_property_for_user` — authenticated helper lacks caller/target identity check

The live production catalog shows `public.create_pending_property_for_user(uuid,text,text,text)` is `SECURITY DEFINER`, executable by `authenticated`, and its live body accepts a caller-supplied `p_user_id` without checking that it matches `auth.uid()`. It queries and may return an existing owner-property row for that supplied user, or creates a pending property assigned to that user.

The guarded implementation in source migration `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` derives the actor from the JWT (or trusted service-role context) and rejects a mismatch between the actor and `p_user_id`. The live function definition does not match that implementation. Treat this as a release-blocking potential cross-user property-creation/data-disclosure vulnerability until a reviewed forward fix is applied and production behavior is verified.

### 2. `fn_public_booking_engine_config` — live body lacks active/enabled predicates

The live production function is executable by `anon` and `authenticated` as `SECURITY DEFINER`. Its live definition filters by property ID but does not require an active property or enabled booking-engine settings. The source migration candidate joins enabled booking settings and requires `properties.status = 'active'`.

Anonymous access may be intentional for the public booking widget. Do not revoke it blindly. Preserve the public booking workflow while ensuring inactive properties and disabled booking engines return no configuration.

### 3. POS RPC tenant guards remain unverified in production

The source migration candidate defines tenant checks for `fn_list_pos_menu(uuid)` and `fn_current_pos_shift(uuid)`. Their live production bodies do not match the candidate's full guarded definitions. The current production function bodies and grants need to be reconciled before any deployment.

## Focused isolated authorization test — results

Tests were run against the existing project `olitech-phase-0-disposable-test` (organization plan: free), not production. The test wrapped fixture changes in one transaction and rolled back at the end; the fixture user, membership, product, and current-day shift were not persisted.

**Passed in the disposable schema:**
- User A calling `create_pending_property_for_user` with User B's ID is rejected with SQLSTATE `42501`.
- User A's own pending-property helper call is idempotent and returns their existing property.
- User A receives no rows from User B's POS menu or current-shift lookup.
- User B can read their own active POS menu and current shift.
- Public booking configuration is returned for an active property with enabled booking settings and is null for the inactive fixture property.
- Function grants match intended access for the tested pair: `anon` cannot execute the property-creation helper, while anonymous execution remains enabled for the public booking-configuration RPC.

**Test limitation:** this verifies the guarded implementation in the disposable database, not the vulnerable live production definitions. The test project has 48 public base tables versus production's 79 and therefore is not a production-equivalent full-schema clone. The full PMS/POS financial, stock, staff-PIN, and service-role registration lifecycle has not been certified by this focused test.

**Test harness correction:** an initial assertion counted rows from a function returning a composite `pos_shifts` value. A null composite can still appear as one row in a `FROM` expression, so that count was not a valid authorization assertion. The corrected test checks the returned composite's `id` for null/non-null; the corrected two-property test passed. The initial count result is not treated as evidence of a separate current-shift vulnerability.

## Current production Supabase advisor snapshot

Security advisor:
- 96 authenticated-executable `SECURITY DEFINER` function findings. This is a function-by-function review queue, not proof all are exploitable.
- 1 anonymous-executable `SECURITY DEFINER` function: `fn_public_booking_engine_config(uuid)`.
- 1 RLS-enabled table without policies: `public.staff_pin_attempts`; confirm trusted RPC-only access is intentional.
- 1 warning: leaked-password protection is disabled in Supabase Auth; assess and enable under the project's authentication policy.

Performance advisor:
- 45 foreign-key indexes flagged as missing.
- 103 unused indexes reported; review workload and observation period before any removal.
- 20 multiple-permissive-policy warnings; review for unintended policy overlap rather than deleting policies automatically.

These advisor notices are not blanket instructions to revoke function execution or drop indexes. Inspect each function/policy and its intended callers before changing behavior.

## Disposable-project advisor snapshot — not production findings

The separate disposable project reports 56 anonymous-executable `SECURITY DEFINER` functions, one public table (`pos_shifts`) with RLS disabled, one `SECURITY DEFINER` view (`my_properties`), two RLS-enabled tables without policies (`staff_pin_attempts` and `staff_sessions`), 18 mutable-search-path function findings, and 54 unindexed foreign keys. This different advisor profile further confirms the disposable database is not production-equivalent; do not copy its remediation wholesale into production.

## Required next steps before any deployment

1. Produce a machine-readable migration mapping: source file → deployed ledger version/name → live schema objects affected → equivalent content evidence. Mark each mapping exact, renamed/equivalent, or unresolved.
2. Diff the four relevant production RPC definitions and ACLs against the candidate SQL and dependencies, including `ensure_my_pending_property`, `handle_new_user`, staff-session authorization, and service-role registration.
3. Bring the isolated test environment to production-equivalent schema without using a paid branch or touching production. If that cannot be achieved safely, label tests as focused-only and do not claim full regression coverage.
4. Expand transactional negative/positive tests to cover User A/User B isolation, own-user signup idempotency, trusted service-role registration, active/inactive public booking, POS menu/current shift, and direct API grants.
5. Run security advisors after a reviewed fix and classify every remaining `SECURITY DEFINER` finding by intended caller and authorization guard. Then rerun repository CI/build/architecture checks.
6. Only after all gates pass, prepare a reviewed forward-only migration and release plan. Production database changes remain explicitly out of scope for this audit.

## Verification boundary

This report records audit evidence and isolated tests; it does not apply a production fix. The production vulnerability remains open. No cross-user mutation was attempted against production, and no production write was executed.
