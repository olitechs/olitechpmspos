# Phase 1 Foundation Security Audit

**Snapshot:** 2026-10-18  
**Repository baseline:** `main` at `281555877fdaaaeae1ffc7dea18dea28af67b7db`  
**Scope:** Phase 1 only. Read-only repository and Supabase inspection before code changes.  
**Production safety:** No production DDL, migration, grants, RLS policy, function, trigger, or data was changed.

## Executive result

Phase 1 security remediation is **not complete**. This PR's limited client-only authentication-marker cleanup can be merged independently after its code checks pass; that merge does not close the broader Phase 1 security or database acceptance gates. No database changes are included.

## Read-only database baseline

The Supabase project named `olitechs-pms-pos` was inspected using read-only metadata queries and advisors.

- Public schema contains **79 base tables** and **136 public functions**.
- The live Supabase migration ledger contains **38 entries**.
- The committed `supabase/migrations/` directory contains **127 SQL migration files** plus its README. The directory has overlapping numeric prefixes and multiple timestamped corrections; source filename, live ledger name, and current function body alone do not prove exact SQL provenance.
- Supabase security advisor snapshot:
  - **96** authenticated-executable `SECURITY DEFINER` function findings requiring function-by-function authorization/grant review. This count is a review queue, not proof that all 96 are exploitable.
  - **1** anon-executable `SECURITY DEFINER` function: `public.fn_public_booking_engine_config(uuid)`. It may be intentionally public, but its body, grants, and active/enabled-property guard must be verified together.
  - **1** RLS-enabled table with no policies: `public.staff_pin_attempts`. Direct client access is denied by default; verify the trusted RPC path is sufficient and intentional.
  - **45** unindexed foreign-key findings. These are performance follow-ups, not a reason to add indexes blindly.
- Existing repository reconciliation notes state that the old disposable test schema is not production-equivalent and that source-to-ledger SQL mapping remains open. No paid Supabase branch or new project was created.

## Source findings

### Authentication boundary

- `src/lib/AuthContext.jsx` uses `authService` and listens to Supabase Auth state changes.
- The active root app still writes `localStorage.olitech_token = "supabase_session"` on login/registration and removes it on logout.
- Repository search found no active-root read of this marker; the remaining matches are writes/removal plus the historical `v6/` duplicate.
- The marker is not a credential and must never be used as proof of authentication or authorization. The scoped change removes the redundant active-root marker writes while preserving the Supabase Auth session and existing UI state flow. The historical `v6/` tree remains untouched.

### Existing work that must not be duplicated or merged blindly

- Draft PR #10: `feat: Phase 1 foundation architecture and security`.
- Draft PR #30: property-membership RLS / owner-escalation hardening. Its disposable-database and negative-test acceptance gates remain open in the PR description.
- PR #20: prior RPC/RLS remediation, merged; its description explicitly notes that the disposable schema was incomplete relative to production and that source-to-live reconciliation and browser smoke tests remained open.
- The `main` branch currently has no branch protection / required status checks enabled. This PR's client-only change must have passing CI before merge. Database-security work remains blocked from deployment until its separate acceptance gates are satisfied.

## Phase 1 blockers and acceptance gates

1. **Migration provenance:** Reconcile every live ledger entry with committed source SQL and capture exact function, policy, trigger, table, index, and grant definitions. Do not rename historical migrations or replay them to make filenames align.
2. **Tenant isolation:** Test direct table and RPC access with two properties and distinct user/role fixtures. Include read, insert, update, delete, cross-property identifiers, owner escalation, and platform-owner operations.
3. **Privileged RPCs:** Review every exposed `SECURITY DEFINER` function for explicit actor/property/action checks, fixed `search_path`, execute grants, and unintended data disclosure. Treat the advisor count as triage, not as an automatic revoke list.
4. **PIN/session boundary:** Verify server-side PIN verification, rate limits, expiry, active staff session checks, and grants. Keep browser storage as UI context only.
5. **Workflow invariants:** Add regression coverage for reservation, POS session/KDS persistence, printer ownership/configuration, cashier/receipt behavior, and stock/financial mutations before changing those workflows.
6. **Executable verification:** Run the repository's build, lint, typecheck, architecture tests, database negative tests, Supabase advisors, and critical-path browser checks from a working checkout. The current tool environment could not clone the repository because outbound DNS to GitHub is unavailable; no local commands are claimed as passed.

## Change boundary for this PR

- Remove only the redundant custom `olitech_token` marker writes from the active `src/lib/AuthContext.jsx`.
- Add a static architecture regression test for that invariant and include it in `npm run test:architecture`.
- Do not change SQL migrations, RLS policies, POS/KDS dispatch, printer transport/recovery, reservation logic, financial logic, `AppStore.jsx`, `PmsStore.jsx`, or `v6/`.
- This merge does not complete Phase 1 security remediation and does not authorize production database changes or Phase 2. Remaining Phase 1 gates above must be completed and verified before any database-security rollout.

## Verification status

| Check | Result |
|---|---|
| Read-only production migration ledger | Completed: 38 entries |
| Read-only production schema counts | Completed: 79 public tables, 136 public functions |
| Supabase security/performance advisors | Completed; findings above recorded |
| Source search for active-root custom token marker | Completed |
| GitHub Actions lint / typecheck / architecture tests / contrast audit / production build | Passed on the PR head; architecture suite 54/54 |
| Two-property database regression tests | Not run: current disposable schema is not certified production-equivalent |
| Production writes | None |
