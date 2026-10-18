# Phase 0 Release Gate — Verification Evidence (2026-10-12)

**Decision: BLOCKED — do not merge PR #20 or proceed to Phase 2 production rollout.**

This record captures the verification performed on 2026-10-12. It does not claim that Phase 0 is cleared.

## Scope and safety

- Production Supabase project: `mszogmazldxjsiytrlxr`.
- Disposable verification project: `rmkcwminrizloosvegzp` (existing project; no new branch/project created).
- Production database operations in this verification were read-only catalog/advisor/migration-ledger reads.
- No production migration, DDL, grant, policy, data, or deployment changes were performed.
- The existing branch `fix/phase0-rpc-rls-remediation` received a source-only UI fix for a missing `ExternalLink` import (commit `71e1acb2e130c6caa046e33b10df56dfc63e25dc`).

## Evidence collected

### Automated repository validation

For commit `71e1acb2e130c6caa046e33b10df56dfc63e25dc`:
- GitHub Actions “OliTechs Production QA”: lint and production build succeeded.
- GitHub Actions “Validate OliTechs PMS POS”: print-agent checks, lint, typecheck, navigation/role-access tests, contrast audit, and application build succeeded.
- Vercel status check reported success.

These validate the source/build pipeline only; they do not prove database tenant isolation.

### Production migration ledger

A read-only Supabase migration listing returned 34 ledger rows. The six rows below are present in the live ledger, but their exact applied SQL provenance is not uniquely proven by the repository sources currently available:

1. `20261003114200 — fix_pos_printer_upsert_transport_20261003`
2. `20261003114849 — security_hardening_rpc_and_rls_20261003`
3. `20261003114909 — tighten_security_definer_execute_grants_20261003`
4. `20261008022614 — 20261008053000_platform_realtime_entitlements`
5. `20261008023412 — 20261008060000_fix_dashboard_entitlement_alias`
6. `20261008042951 — 20261008094500_phase3_reconciliation_security_fix`

The migration ledger records version/name metadata, not the original SQL statements. Exact reconciliation requires trusted original applied SQL, deployment artifacts, or equivalent historical evidence plus object-by-object comparison. Do not infer equivalence from similar names or current function bodies alone.

### Disposable project capability check

Read-only queries against the existing disposable project found:
- 47 public base tables.
- 2 properties, 1 property-user membership, 2 products.
- 53 migration ledger rows.

This fixture does **not** provide two independent tenant memberships and suitable cross-tenant sentinel data for a valid positive/negative two-tenant test. Its schema is also not production-equivalent. Therefore, it cannot satisfy the security acceptance test.

### Production Supabase Security Advisor

The read-only advisor query on 2026-10-12 reported:
- 1 finding for `anon` execution of SECURITY DEFINER function `public.fn_public_booking_engine_config(uuid)`. This may be intentional because it is documented as public-facing, but the exposure must be explicitly reviewed and the finding disposition recorded.
- 96 findings for SECURITY DEFINER functions executable by `authenticated`. These are warnings, not automatically vulnerabilities; each exposed function requires classification by intended caller and proof of authorization checks.
- 1 finding that leaked-password protection is disabled.

These results do not independently prove tenant data leakage, but the exposed RPC surface is not yet documented as a complete reviewed grant/authorization matrix.

## Release blockers

1. **Six-entry provenance is unresolved.** Obtain exact SQL/deployment artifacts for the six entries, or provide trusted evidence that maps each entry to an equivalent source and all expected object changes.
2. **Two-tenant authorization tests are not complete.** On a schema-equivalent disposable environment, prove both authorized access and denied cross-tenant access for `fn_list_pos_menu`, tenant-sensitive SECURITY DEFINER RPCs, and property update/status/package guards. Include both expected positive and negative assertions with outputs.
3. **RPC authorization/grants are not fully reconciled.** Review exposed SECURITY DEFINER functions by exact identity signature, caller role, function body, search_path, and tenant guard; record intentional public/authenticated access versus defects.
4. **Production-equivalent schema comparison is missing.** The disposable project has 47 public tables versus 76 previously observed in production, so results cannot be treated as equivalent.
5. **Browser smoke tests remain separate from CI.** CI success is not browser/runtime evidence.

## Closure checklist

- [ ] Recover and archive the six original applied SQL/deployment artifacts.
- [ ] Compare the 34 production ledger rows against source artifacts and document all tracked migrations absent from the ledger without replaying migrations.
- [ ] Produce and retain a reviewed SECURITY DEFINER EXECUTE/authorization matrix.
- [ ] Run positive and negative two-tenant tests on a schema-equivalent disposable environment.
- [ ] Verify property status/package guard behavior for owner/admin/platform-owner roles.
- [ ] Re-run CI after any resulting code changes and record browser smoke-test evidence.
- [ ] Obtain explicit Phase 0 sign-off before merging PR #20 or continuing Phase 2 release work.

## References

- PR #20: https://github.com/olitechs/olitechpmspos/pull/20
- Migration reconciliation addendum: https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/docs/audits/PHASE-0-MIGRATION-RECONCILIATION-ADDENDUM.md
- Six-entry follow-up: https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/docs/audits/PHASE-0-SIX-ENTRY-EVIDENCE-FOLLOWUP.md
- Security Advisor documentation: https://supabase.com/docs/guides/database/database-linter

**Final disposition:** BLOCKED. No production database changes were made. The gate must remain closed until the checklist above is evidenced and reviewed.
