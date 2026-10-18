# Phase 1 — Live Security Drift Findings

**Snapshot date:** 2026-10-18  
**Repository baseline:** `main` at `bca0e53494d6b5d69e60e108d7e7c6138266d8da`  
**Scope:** Read-only comparison of the live Supabase catalog/advisors against security remediation already present in source control.  
**Safety:** No production DDL, grants, policies, functions, triggers, or data were changed. No paid Supabase branch was created.

## Executive result

The live database and repository migration state are not aligned for important security fixes. **Do not create a duplicate migration or deploy a new security migration until migration provenance and the existing forward-migration candidates have been reconciled.**

The live ledger returned 38 entries and ends at `20261013194854_restore_property_scoped_stores`. The repository already contains `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql`, which is not represented in the live ledger returned by Supabase. That source migration contains guards for multiple RPCs, including property creation, POS menu reads, current POS shift reads, and public booking configuration. Its presence in Git does not prove it was applied or tested against the current live schema.

## Confirmed high-priority findings

### 1. `create_pending_property_for_user` — authenticated helper can be called directly

The live catalog shows `public.create_pending_property_for_user(uuid,text,text,text)` is `SECURITY DEFINER`, executable by `authenticated`, and its current live body accepts a caller-supplied `p_user_id` without checking that it matches `auth.uid()`. It queries and may return an existing owner-property row for that supplied user, or creates a pending property assigned to that user.

The intended helper implementation already exists in the repository migration `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql`: it derives the actor from the JWT (or trusted service-role context) and rejects a mismatch between the actor and `p_user_id`. The live function definition does not match that guarded source. This is a potential cross-user property-creation/data-disclosure vulnerability and must be treated as a release blocker until verified and remediated.

### 2. `fn_public_booking_engine_config` — live function lacks source guards

The live function is callable by `anon` and `authenticated` as `SECURITY DEFINER`. Its live definition filters only by property ID and does not require an active property or enabled booking-engine settings. The source migration `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` instead joins enabled booking settings and requires `properties.status = 'active'`.

This function may be intentionally public for booking widgets, so do not revoke anonymous access without preserving the public booking workflow. The active-property/enabled-engine predicate needs to be brought into the verified deployed definition.

### 3. POS RPC tenant guards need deployed verification

The source migration `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` also defines tenant checks for `fn_list_pos_menu(uuid)` and `fn_current_pos_shift(uuid)`. Prior audit artifacts recorded a failed cross-property negative test for `fn_list_pos_menu`. Because the candidate migration is absent from the returned live ledger, treat these source guards as unverified in production until the live function bodies and two-property tests prove they are active.

## Current advisor snapshot

- 96 authenticated-executable `SECURITY DEFINER` functions are flagged for individual review. This is a review queue, not proof that all 96 are exploitable.
- 1 anonymous-executable `SECURITY DEFINER` function: `fn_public_booking_engine_config(uuid)`.
- 1 RLS-enabled table without policies: `public.staff_pin_attempts`. Verify that all access is intentionally mediated through trusted functions.
- 45 foreign-key indexes are flagged as missing; handle these as a separately measured performance task.

## Existing source artifacts — do not duplicate

- `supabase/migrations/20261011130000_phase0_rpc_rls_remediation.sql`
- `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql`
- `docs/audits/PHASE-0-FORWARD-REMEDIATION-STATUS.md`
- `docs/PHASE_0_BASELINE_AUDIT.md`

These files already contain forward-remediation work and test expectations. The migration ledger/source mapping is still unresolved. Do not rewrite historical migrations, renumber files, replay production migrations, or assume a Git commit means the migration reached the live database.

## Required next steps before any deployment

1. Reconcile every live ledger entry with the source migration history, including duplicate timestamp/version candidates and migrations that are in source but absent from the live ledger.
2. Inspect the exact live definitions, grants, policies, and triggers for the four RPCs above, plus dependencies and service-role call paths.
3. In an isolated, non-production test database that does not incur a paid Supabase branch, test two distinct property users:
   - User A cannot retrieve or create a property on behalf of User B.
   - User A cannot read User B's POS menu or current shift.
   - A public booking configuration is returned only for active properties with enabled booking settings.
   - The intended public booking workflow, own-user registration, trusted service-role registration, and property-member POS workflow still succeed.
4. Run security advisors and the repository CI/build/test suite after remediation.
5. Only then prepare a reviewed forward-only migration and release plan. Production database changes remain explicitly out of scope for this audit.

## Verification boundary

This is an evidence report, not a database fix. The read-only catalog and advisor queries support the live-definition observations above. No cross-user mutation was attempted against production, including a mutation later rolled back. Two-property database regression tests and local repository commands have not been claimed as passed.
