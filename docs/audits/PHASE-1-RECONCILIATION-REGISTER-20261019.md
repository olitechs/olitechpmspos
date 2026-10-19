# Phase 1 Reconciliation Register — 2026-10-19

**State: OPEN / BLOCKED FOR DATABASE ROLLOUT**  
**Related PR:** https://github.com/olitechs/olitechpmspos/pull/48  
**Source evidence:** 'docs/audits/PHASE-0-EXECUTION-20261019.md'

This register distinguishes a reviewed design from verified production state. It intentionally does not infer historical migration contents from current schema objects.

## Confirmed findings and disposition

| ID | Finding | Risk | Current disposition | Evidence required to close |
|---|---|---|---|---|
| P0-SEC-01 | 'create_pending_property_for_user(uuid,text,text,text)' is SECURITY DEFINER and production body does not bind supplied user ID to 'auth.uid()' | Cross-user property creation/disclosure | Open; tracked remediation exists but is not confirmed applied | Exact function body + ACL on production after separately approved deployment; authenticated negative test |
| P0-SEC-02 | 'fn_list_pos_menu(uuid)' has no production caller/property guard | Cross-property menu/stock disclosure | Open | Expected/live body and grants; two-tenant member/non-member tests |
| P0-SEC-03 | 'fn_current_pos_shift(uuid)' lacks production caller/property guard | Cross-property shift disclosure | Open | Expected/live body and grants; two-tenant member/non-member tests |
| P0-SEC-04 | 'fn_public_booking_engine_config(uuid)' does not require active property and enabled booking engine | Disabled/inactive configuration exposed | Open | Anonymous tests for inactive property, disabled engine, unknown property, enabled active property |
| P0-MIG-01 | '20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql' exists in source but is absent from production migration ledger | Source/live drift; unsafe assumption about deployed security | Do not infer applied; do not deploy yet | Schema-equivalent disposable validation, reviewed plan, explicit deployment approval, post-deploy ledger/function/ACL verification |
| P0-SEC-05 | The tracked POS RPC remediation treats property membership and any active staff role as alternatives; it does not explicitly bind a staff session to the POS module/action or check the live entitlement/status in the POS RPC | A member or staff session established for another module may pass the RPC guard; subscription revocation may not be enforced at this boundary | Open; source migration is not sufficient for final role/session enforcement | Reviewed function design plus tests proving active POS session/module, action permission, property status, and subscription entitlement are required; verify against production-equivalent schema |
| P0-MIG-02 | Six historical ledger rows have no trusted original applied-SQL artifact | Historical provenance cannot be proven | Unresolved; no rename/replay/repair | Recover artifacts or owner-approved, evidence-based disposition for each row |

## Six unresolved migration-history entries

| Ledger version | Recorded name | Status |
|---|---|---|
| '20261003114200' | 'fix_pos_printer_upsert_transport_20261003' | Unresolved: original applied SQL/deployment evidence missing |
| '20261003114849' | 'security_hardening_rpc_and_rls_20261003' | Unresolved: original applied SQL/deployment evidence missing |
| '20261003114909' | 'tighten_security_definer_execute_grants_20261003' | Unresolved: original applied SQL/deployment evidence missing |
| '20261008022614' | '20261008053000_platform_realtime_entitlements' | Unresolved: original applied SQL/deployment evidence missing |
| '20261008023412' | '20261008060000_fix_dashboard_entitlement_alias' | Unresolved: original applied SQL/deployment evidence missing |
| '20261008042951' | '20261008094500_phase3_reconciliation_security_fix' | Unresolved: original applied SQL/deployment evidence missing |

Do not mark these resolved because a similarly named source file exists or current function/policy behavior appears similar. Ledger metadata is not an applied-SQL hash.

## Required authorization inventory before database rollout

For each public SECURITY DEFINER function, capture: exact signature and definition, owner, search path, row_security, execute ACL (including PUBLIC/anon/authenticated/service_role), caller identity derivation, property scope, action/role predicate, subscription entitlement predicate, input/foreign-key validation, and returned columns/data. Compare exact expected and live states. Include views, triggers, and direct table grants where they can bypass the same intended boundary.

For each tenant table, capture: RLS enabled/forced state, table grants, all policies including permissive/restrictive mode, operation, USING, WITH CHECK, helper-function definitions and grants, and whether a direct or indirect relationship can cross properties. RLS tests must run as actual anon/authenticated roles in a disposable fixture; service-role tests do not prove end-user isolation.

## Role, permission, entitlement and PIN/session consistency gaps to test

- Client 'canRoleUseModule' and 'hasSubscriptionModule' are UX gates, not server authorization.
- The role aliases in 'authService.js', 'staff_role_check', 'current_staff_role', 'can_backoffice', 'can_store_read/write', and individual RPC role lists must agree or be migrated to one canonical server mapping.
- 'verify_staff_pin' must be tested for brute-force throttling, constant error behavior, active staff/module membership, property membership, session issuance, session expiry/revocation, and no hash disclosure. The current source migration's SHA-256 client hash is not a password-hardening KDF; rate limiting and migration strategy require explicit security review before calling it production-grade.
- PIN login must not imply Supabase user authentication or admin permissions. A PIN-selected staff identity needs server-side session authority on every sensitive RPC.
- Entitlement enforcement must use authoritative subscription status/expiry and the canonical package-to-feature map, not only 'properties.package' or client session snapshots.
- Verify direct writes and SECURITY DEFINER RPCs enforce the same action permissions. A role-based route guard alone is insufficient.
- Ensure staff PIN reset/update endpoints cannot accept arbitrary client-provided hashes to bypass PIN validation; if compatibility requires accepting hashes, validate format and enforce secure server-side rate limits.

## Verification record

| Gate | Result at this commit | Notes |
|---|---|---|
| Production database writes | Not performed | Explicitly prohibited by the current phase boundary |
| Historical migrations rewritten/replayed | No | Preserve provenance |
| Production-equivalent tenant fixture | Not available in Phase 0 record | Existing disposable DB is not schema-equivalent |
| Exact-head build/lint/typecheck | Pending | Must be run against final Phase 1 head |
| Two-tenant direct table/RPC suite | Pending | Requires equivalent disposable schema and real role contexts |
| Browser smoke suite | Pending | Must cover auth, room/reservation, POS/KDS, shifts, printer setup |
| Phase 1 approval/merge | Pending | Keep PR draft and do not merge |

## Safe closure procedure

1. Recover/approve dispositions for the six historical entries and archive the evidence.
2. Complete exact live function/policy/grant inventory read-only.
3. Validate the forward-only remediation migration on a schema-equivalent isolated database, including all direct-write and RPC negative tests.
4. Run role/entitlement/PIN/session and offline idempotency/conflict tests.
5. Run exact-head build, lint, typecheck, architecture/regression suites, and browser smoke tests.
6. Review the complete diff and update this register with links/logs; obtain owner approval before merge or production rollout.
