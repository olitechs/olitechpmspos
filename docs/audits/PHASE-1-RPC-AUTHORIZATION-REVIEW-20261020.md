# Phase 1 — RPC Authorization Review and Remediation Gate

**Captured:** 2026-10-20  
**Branch:** `phase1/foundation-data-security-20261019`  
**Disposition:** **BLOCKED — evidence review only; no production database changes.**

## Scope and evidence

Read-only `pg_get_functiondef`, function ACL, and information-schema queries were run against production project `mszogmazldxjsiytrlxr`. The source migration `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` was reviewed from Git. No DDL/DML, grant changes, policy changes, function changes, or migration-ledger writes were made.

The existing disposable project remains materially different from production. Tests against it cannot be represented as proof of production-equivalent isolation.

## Confirmed production function behavior

| Function | Production evidence | Required disposition |
|---|---|---|
| `create_pending_property_for_user(uuid,text,text,text)` | SECURITY DEFINER, `row_security=off`, executable by `authenticated`; body accepts caller-supplied `p_user_id` without matching it to `auth.uid()`. | Release blocker. The tracked source migration adds the identity comparison, but it is not in the production migration ledger. Validate signature/dependencies on an equivalent isolated schema before deployment. |
| `fn_public_booking_engine_config(uuid)` | SECURITY DEFINER and executable by `anon`; body returns config for a matching property without checking active property status or enabled booking settings. | Release blocker. Public execution is intentional only if returned fields are public and both status/settings predicates are enforced. |
| `fn_list_pos_menu(uuid)` | SECURITY DEFINER, executable by `authenticated`; production body filters by property and POS flags but does not check caller membership, staff session, or platform capability. | Release blocker. Add tenant and operator authorization only after a tested canonical helper is agreed; do not rely on a client-supplied property ID. |
| `fn_current_pos_shift(uuid)` | SECURITY DEFINER, executable by `authenticated`; production body filters by property/open status/date only. | Release blocker. Must enforce tenant and operator authorization before returning a shift. |
| `current_staff_role(uuid)` | SECURITY DEFINER; joins `staff_sessions` to active staff and matches `auth.uid()` and property; considers a session current when `verified_at > now() - interval '30 minutes'`. | This is a useful session predicate, not a complete authorization decision: it does not accept/check requested module or action, subscription entitlement, or property status. |
| `verify_staff_pin(uuid,text,text)` | SECURITY DEFINER; requires authenticated user and property membership or platform-owner status; checks active staff, assigned module, and a 5-attempt/10-minute window with a 5-minute lock; upserts one `staff_sessions` row per user. | Preserve the existing throttle contract. Verify all direct grants, role/module binding, expiry/revocation, and transaction-bound audit semantics before changing it. |
| `touch_active_staff_session()` | SECURITY DEFINER; updates `verified_at` for every session row matching `auth.uid()`. | Review callers and refresh behavior: it can extend the 30-minute freshness window. Must not be callable in a way that revives a revoked/disabled staff session. |
| `clear_active_staff_session()` | SECURITY DEFINER; deletes rows matching `auth.uid()`. | Confirm it is called on module exit/logout and that sensitive RPCs re-check server-side state. |
| `fn_subscription_access(uuid,text)` | SECURITY DEFINER; requires platform owner or property membership, but inserts a subscription row when none exists for an active packaged property. It also implements legacy module aliases and trial/grace rules. | Access evaluation must be side-effect-free. Map callers and preserve package/trial/grace semantics before splitting the compatibility insert into an explicitly authorized, audited repair operation. |

## Schema constraints that affect a safe remediation

Production `staff_sessions` currently has `user_id`, `staff_id`, `property_id`, and `verified_at`; there are no explicit `expires_at`, `revoked_at`, or module-bound session columns in the inspected schema. A design that assumes those fields already exist is invalid. Adding them requires a forward-only migration, data/backfill policy, caller inventory, and tests before any function can reference them.

Production `audit_logs` currently has `id`, `actor_id`, `action`, `property_id`, `old_value`, `new_value`, and `created_at`. This is not yet evidence of the complete append-only event contract: entity identity, outcome, request/idempotency correlation, actor staff identity, and immutability/transaction coupling still need verification.

Production `staff_pin_attempts` has RLS enabled but no policy reported by the advisor. Direct grants and all alternate access paths must be verified before concluding whether a no-policy table is safely RPC-only.

The expanded effective-privilege query found `anon` has effective SELECT on 73 of 79 public base tables and effective INSERT, UPDATE, and DELETE on 71 of 79 each. All 79 have RLS enabled, so these grants are **not by themselves proof of row exposure**; the policy predicates still apply. However, the grant surface materially increases the blast radius of any permissive/mis-scoped policy. The same query found 193 policies targeting `public` and 8 UPDATE policies with NULL `WITH CHECK`. These are review counts, not an exploitability verdict. Policy-by-policy anonymous negative tests and least-privilege grant review are mandatory. Do not mass-revoke privileges until public booking flows and policy dependencies are mapped.

The production security advisor also reports **Leaked Password Protection Disabled** for Supabase Auth. This is an account/auth configuration finding separate from SQL remediation; enablement requires a deliberate Auth configuration change and should be tracked in the release security checklist.

## Review of the tracked source migration

The existing migration improves four known gaps, but is **not sufficient as the final authorization layer**:

- It checks `auth.role() = 'service_role'` in the POS RPCs; use explicit function ACLs and a documented service-only path, and avoid treating role strings as tenant authorization.
- `fn_list_pos_menu` and `fn_current_pos_shift` allow any property member and use `current_staff_role(property_id) IS NOT NULL` as a broad staff condition. They do not enforce requested module/action, subscription entitlement, or property active status.
- The staff helper only proves a recent verification for that user/property and active staff row. It does not prove that the session is authorized for the requested operation.
- The migration must be tested against a schema-equivalent isolated database. The existing disposable database is known to be non-equivalent.
- The migration must not be applied to production until function signatures/return types, all callers, ACL effects, and regression gates have been reviewed.

## Required tests before Phase 1 sign-off

1. Two distinct users and two properties with separate memberships; do not simulate two tenants using one owner account.
2. For each tenant, test direct SELECT/INSERT/UPDATE/DELETE on representative parent and child tables, including cross-property foreign keys and attempted property reassignment.
3. Exercise each of the four RPCs as anon, property owner/member, non-member, staff with correct module, staff with wrong module, expired/revoked session, inactive staff, inactive property, missing entitlement, and service role.
4. Confirm public booking configuration returns no data for missing/inactive properties or disabled booking settings.
5. Confirm `fn_subscription_access` has no side effects for missing subscription rows and preserve existing module aliases and trial/grace decisions.
6. Test PIN throttling, session replacement across properties, session freshness, revocation, logout, and inability to extend a revoked session through `touch_active_staff_session()`.
7. Verify audit events are emitted in the same transaction as sensitive operations, cannot be edited/deleted by clients, and contain no PIN/hash/token or unnecessary guest PII.
8. Run browser tests for login/PIN entry, property switching, session expiry, revoked access, POS menu/shift, room/reservation, and offline queue conflicts.
9. Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test:architecture`, browser tests, and security advisors on the exact final branch head.

## Decision

Keep PR #48 draft. Do not merge or release Phase 1, do not apply the tracked migration to production, and do not claim complete tenant isolation until the schema-equivalent test prerequisite and negative-test matrix pass. No production writes were made in this review.
