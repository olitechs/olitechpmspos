# Phase 0 — Security and Migration Provenance Execution Record

**Snapshot:** 2026-10-19  
**Working branch:** `phase0/security-provenance-closeout-20261019`  
**Production Supabase project:** `mszogmazldxjsiytrlxr` (read-only during this work)  
**Existing disposable project:** `rmkcwminrizloosvegzp`  
**Disposition:** **OPEN — do not release Phase 1 or apply security migrations to production yet.**

## Safety boundary

- No production DDL, data, RLS policy, function, trigger, grant, or migration ledger changes were made.
- No Supabase branch or new project was created.
- No historical migration file was renamed, re-versioned, reordered, replayed, or repaired.
- `v6/` was not modified.
- The existing free disposable project was used for transactional SQL authorization checks; the tests below roll back.
- This record is not a claim that the disposable schema is production-equivalent.

## Fresh read-only inventory

| Evidence | Production | Existing disposable |
|---|---:|---:|
| Public base tables | 79 | 48 |
| Public functions | 136 | 102 |
| Migration ledger entries | 38 | 56 |
| Source migration files in repository | 127 | 127 |

The schema gap means the disposable database is useful for targeted negative tests, but it cannot certify all production RLS, RPC, trigger, table, and workflow behavior.

## Confirmed production security drift

Read-only `pg_get_functiondef` and execute-grant inspection confirmed the following differences from the guarded source implementation:

1. `public.create_pending_property_for_user(uuid,text,text,text)` is SECURITY DEFINER and its production body accepts the caller-supplied `p_user_id` without checking it against `auth.uid()`. It is executable by `authenticated`. This is a release-blocking potential cross-user property creation / data-disclosure issue.
2. `public.fn_list_pos_menu(uuid)` production body filters by property ID but does not verify property membership, platform-owner status, or an active staff session.
3. `public.fn_current_pos_shift(uuid)` production body filters by property ID and open/date state but has no caller/property authorization guard.
4. `public.fn_public_booking_engine_config(uuid)` production body returns configuration for a matching property without enforcing both active property status and `booking_engine_settings.enabled IS TRUE`.
5. The disposable project has guarded implementations for these RPCs and a property entitlement update trigger. This confirms that the proposed guard behavior exists in that environment, **not** that it is installed in production.

The source file `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` is present in Git but absent from the 38-entry production migration ledger. Do not infer that it has been applied to production.

## Disposable authorization regression check

The existing disposable database was tested in a transaction with simulated authenticated JWT claims and `SET LOCAL ROLE authenticated`. The SQL completed without an assertion error, and the transaction was rolled back.

Assertions covered:

- An owner can retrieve their existing property idempotently.
- An authorized owner can invoke their own-property POS menu RPC.
- A non-member receives no rows from the other property's POS menu RPC.
- Cross-user pending-property creation is rejected with SQLSTATE `42501`.
- An unknown property returns no public booking configuration.
- A property owner cannot change protected property status/package fields.

The reusable script is `supabase/tests/phase0_rpc_security_regression.sql`. It requires one owner membership plus a second property that owner does not belong to. Run it only on a disposable database; it explicitly rolls back.

**Limitations:** the current fixture does not prove two distinct tenant users with independent roles, broad direct table read/write/delete isolation, all sensitive RPC families, or equivalence to production's full schema. The SQL connector did not expose PostgreSQL NOTICE output, so the evidence is successful completion without assertion error rather than a captured per-assertion log.

## Migration provenance

Current inventory confirms:

- 38 production ledger rows.
- 127 source SQL files (78 legacy-numbered and 49 timestamp-prefixed).
- 20 ledger entries have normalized filename matches; 18 remain unmatched.
- Six historical ledger entries still lack a trusted original applied-SQL artifact or equivalent deployment record:
  - `20261003114200 fix_pos_printer_upsert_transport_20261003`
  - `20261003114849 security_hardening_rpc_and_rls_20261003`
  - `20261003114909 tighten_security_definer_execute_grants_20261003`
  - `20261008022614 20261008053000_platform_realtime_entitlements`
  - `20261008023412 20261008060000_fix_dashboard_entitlement_alias`
  - `20261008042951 20261008094500_phase3_reconciliation_security_fix`

The ledger stores version/name metadata, not original SQL bodies or blob hashes. Current object definitions can corroborate a feature but cannot, by themselves, prove which historical migration installed it. These six entries remain **unresolved**. No history repair or replay is safe until trusted artifacts are recovered or an explicit evidence-based disposition is approved.

## Remaining Phase 0 gates

- [ ] Recover and archive the original SQL/deployment artifacts for all six unresolved entries, or document that they are irretrievable and approve an evidence-based disposition.
- [ ] Complete an exact expected-vs-live definition and ACL review for all exposed SECURITY DEFINER functions, including caller identity, tenant/property/action checks, fixed search paths, and intentional public access.
- [ ] Obtain a production-equivalent isolated database fixture without creating a paid branch; otherwise document the unavailable test prerequisite and do not claim full tenant-isolation acceptance.
- [ ] Run a complete two-tenant test matrix: direct SELECT/INSERT/UPDATE/DELETE; cross-property identifiers; owner/admin/platform-owner role boundaries; sensitive RPCs; status/package guard; POS shifts, menu, inventory, and booking configuration.
- [ ] Run browser smoke tests for sign-in, property access, registration/approval, room/reservation flow, POS/KDS persistence, cashier/shift operations, and printer configuration.
- [ ] Run exact-head GitHub Actions and capture build, lint, typecheck, architecture, security, and browser results.
- [ ] Obtain explicit Phase 0 sign-off before Phase 1 implementation or production security rollout.

## Required next production-safe step

Prepare a reviewed, forward-only deployment plan for the already tracked RPC guard migration. First apply and validate it only in a schema-equivalent disposable environment. Do not apply it to production from this branch. After the test prerequisites and migration provenance review pass, schedule production deployment as a separate explicitly approved operation.
