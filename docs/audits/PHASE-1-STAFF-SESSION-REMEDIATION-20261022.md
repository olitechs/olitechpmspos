# Phase 1 staff-session remediation — candidate review

**Status:** Draft candidate. Not approved for production deployment.  
**Branch:** `phase1/security-reconciliation-verified-20261022`  
**Production changes:** None.

## Changes proposed

- Add explicit session module, inactivity expiry, hard expiry, and revocation fields to `public.staff_sessions`.
- Bind PIN verification to the selected module; use a 30-minute inactivity window and an 8-hour absolute maximum lifetime.
- Make session refresh fail closed when the session is absent, expired, revoked, attached to inactive staff/property, or no longer assigned to the module.
- Revoke on session clear. Existing sessions with no trustworthy module are invalidated and require PIN re-authentication.
- Add module guards to existing direct RLS staff-role predicates on the reviewed POS, store, property-settings, and payment/folio tables while preserving existing membership-role branches.
- Make `fn_subscription_access(uuid,text)` read-only while preserving existing module aliases and trial/grace decisions; provisioning stays in explicitly authorized lifecycle functions.
- Guard `fn_list_pos_menu(uuid)` and `fn_current_pos_shift(uuid)` through server-side POS module/session/entitlement authorization, while retaining trusted service-role access.
- Restrict the low-level `create_pending_property_for_user(uuid,text,text,text)` helper to trusted internal/service-role callers; authenticated clients use the self-service entry point instead.
- Keep public booking configuration available anonymously only for active properties with `booking_engine_settings.enabled IS TRUE`.
- Add rollback-only SQL regressions for session lifecycle, subscription behavior, cross-property POS RPC calls, booking config exposure, and least-privilege grants; run them in a PostgreSQL 17 GitHub Actions workflow using a minimal schema fixture.

## Validation boundaries

The minimal fixture is designed to compile and exercise this migration's candidate contract. It is **not** a production-equivalent schema, does not recreate all 79 production tables or all 217 policies, and cannot certify full tenant isolation. Production read-only catalog inspection found 36 policies across 16 tables that directly call `current_staff_role`; the migration targets that known set. It also adds focused guards to the four high-risk RPCs above, but the complete policy and SECURITY DEFINER caller inventory remains a release gate.

The migration has not been applied to production. Do not deploy until the isolated PostgreSQL workflow passes, the migration is reviewed against the reconciled production schema, and the full two-property negative matrix passes.

## Subscription access evaluation — additional candidate fix

The candidate migration also replaces `fn_subscription_access(uuid,text)` with a read-only implementation. It retains the current module aliases, active/trial/past-due/grace/suspended decision logic, dashboard exception, and platform-owner/property-member checks, but removes implicit `INSERT INTO property_subscriptions` from an access check.

Read-only production catalog checks found no current properties missing a `property_subscriptions` row. Provisioning already exists in explicit lifecycle functions including `approve_property`, `platform_set_property_package`, `platform_update_subscription`, and `fn_upsert_subscription`; those remain the intended mutation paths. The isolated fixture now tests both an existing active subscription and a missing subscription, requiring denial without creating a row.

This is a candidate implementation tested only against the minimal fixture. Before deployment, verify all subscription lifecycle callers against the reconciled production schema and ensure no unreviewed path relies on the former access-check side effect.


## High-risk RPC remediation added after the live definition review

- `fn_list_pos_menu(uuid)` and `fn_current_pos_shift(uuid)` now call `fn_staff_module_access(property_id, 'pos')` before returning property-scoped data; trusted service-role calls remain supported. Regression tests require a receptionist to access their own property's POS data while denying another property's menu and shift.
- `fn_public_booking_engine_config(uuid)` remains intentionally callable by `anon`, but only returns a configuration when the property is active and the booking engine setting is explicitly enabled. Tests cover enabled, disabled, and inactive cases.
- `create_pending_property_for_user(uuid,text,text,text)` is a low-level helper called by SECURITY DEFINER signup/admin workflows and the self-service wrapper. Direct authenticated execution is revoked to close the observed caller-supplied user-ID exposure without adding an auth.uid() check that could break the signup trigger context. The trusted service role remains granted.

These RPC changes pass the minimal fixture regression. The production migration chain still includes an older tracked but unledgered candidate for similar RPC changes, so rollout must reconcile pending migration order and test signup/self-service property creation before any production deployment.
