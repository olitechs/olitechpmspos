# Booking Configuration and Tenant-Sensitive RPC Remediation

Date: 2026-10-13  
Migration: `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql`

## Confirmed findings

- `fn_public_booking_engine_config(uuid)` was executable by `anon` and `authenticated`, and returned configuration by property ID alone. The live definition did not require an active property or an enabled booking engine.
- `fn_list_pos_menu(uuid)` was `SECURITY DEFINER` without a tenant-membership/staff authorization predicate. The prior baseline audit recorded a successful cross-property menu read.
- `fn_current_pos_shift(uuid)` was `SECURITY DEFINER` and selected a shift using only the caller-supplied property ID, open status, and local date.
- `create_pending_property_for_user(uuid,text,text,text)` accepted a caller-supplied user ID without checking that it matched `auth.uid()`. The prior baseline audit recorded cross-user property disclosure.

## Remediation

- Public booking config now returns a result only when the property is `active` and its `booking_engine_settings.enabled` value is true. Public fields remain compatible with the existing booking-engine consumer.
- POS menu and current-shift RPCs require a platform-owner identity, property membership, an active staff session for that property, or a trusted service-role call. Anonymous execution is revoked.
- Pending-property registration/retrieval is self-scoped for authenticated callers. A trusted service-role JWT may still perform the server-side workflow.
- All functions retain a fixed `search_path = public`; no broad changes to unrelated RPC grants are included.
- Migration is forward-only; historical migration files are unchanged.

## Production ACL and high-risk RPC audit

Read-only production catalog audit (project `mszogmazldxjsiytrlxr`) found 100 public `SECURITY DEFINER` functions: 96 executable by `authenticated`, and only one executable by `anon`—the public booking-config RPC addressed here. The disposable project's advisor output differs from production ACLs, so production catalog results, not disposable advisor counts, are used for the grant assessment.

A targeted review of financial and inventory RPCs found tenant or role checks in sampled functions including `fn_record_pos_sale`, `fn_close_pos_shift`, `fn_approve_cashier_adjustment`, `fn_apply_stock_movement`, `fn_post_stock_adjustment`, `fn_receive_purchase_order`, `fn_consume_recipe_stock`, `fn_channel_connection_upsert`, and `fn_upsert_subscription`. This is a targeted sample, not a sign-off of all 96 authenticated-callable functions. The remaining inventory still requires per-function authorization review.

## Disposable database regression checks

Applied the migration to disposable project `rmkcwminrizloosvegzp`, then ran assertions inside a transaction that was rolled back:

- Active property + enabled booking engine: public config returned.
- Inactive property: public config returned no result.
- Active property with booking engine temporarily disabled: public config returned no result.
- Authorized property owner: POS menu remained readable and own-property lookup remained functional.
- Nonmember: POS menu returned zero rows and current-shift RPC returned no shift.
- Nonmember attempting to retrieve another user's property: call rejected with insufficient privilege.
- ACL check: booking config remains executable by anon/authenticated; POS menu, current shift, and pending-property RPC are not executable by anon; authenticated execution remains enabled for the intended workflows.

The test transaction was rolled back so the temporary booking-engine setting change did not persist.

## Release limitations / remaining gates

- **Production migration has not been applied by this change.** Review the PR and run the migration against a production-equivalent staging schema first.
- The disposable database is not schema-equivalent to production; these checks validate the target functions and relevant objects, not the entire PMS/POS system.
- Current-shift positive-path testing needs a dedicated disposable open-shift fixture and a staff-session fixture. The current-shift negative tenant check passed, but no positive shift row was available in the test data.
- Browser-level booking, staff-PIN login, shift opening/closing, menu rendering, KOT printing, and financial workflows still need smoke/regression tests.
- The broader audit remains open for other authenticated `SECURITY DEFINER` functions and the known property-update policy defect. This migration intentionally does not modify unrelated RPCs or that policy.
