# Phase 1 staff-session remediation — candidate review

**Status:** Draft candidate. Not approved for production deployment.  
**Branch:** `phase1/staff-session-remediation-20261022`  
**Production changes:** None.

## Changes proposed

- Add explicit session module, inactivity expiry, hard expiry, and revocation fields to `public.staff_sessions`.
- Bind PIN verification to the selected module; use a 30-minute inactivity window and an 8-hour absolute maximum lifetime.
- Make session refresh fail closed when the session is absent, expired, revoked, attached to inactive staff/property, or no longer assigned to the module.
- Revoke on session clear. Existing sessions with no trustworthy module are invalidated and require PIN re-authentication.
- Add module guards to existing direct RLS staff-role predicates on the reviewed POS, store, property-settings, and payment/folio tables while preserving existing membership-role branches.
- Add a rollback-only SQL regression suite and PostgreSQL 17 GitHub Actions workflow using a minimal schema fixture.

## Validation boundaries

The minimal fixture is designed to compile and exercise this migration's own contract. It is **not** a production-equivalent schema, does not recreate all 79 production tables or all 217 policies, and cannot certify full tenant isolation. Production read-only catalog inspection found 36 policies across 16 tables that directly call `current_staff_role`; the migration targets the current known set, but the complete policy and SECURITY DEFINER caller inventory remains a release gate.

The migration has not been applied to production. Do not deploy until the isolated PostgreSQL workflow passes, the migration is reviewed against the reconciled production schema, and the full two-property negative matrix passes.
