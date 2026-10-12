# Phase 0 — Artifact Retrieval Attempt 2 and Exact Live-Object Comparison

**Checked:** 2026-10-12  
**Supabase project:** `mszogmazldxjsiytrlxr` (production, read-only)  
**Repository ref:** `fix/phase0-rpc-rls-remediation`  
**Result:** Original deployed SQL remains unavailable from connected sources. Read-only object comparison confirms material security mismatches.

## What was attempted to recover the originals

- Re-ran GitHub code searches for all six ledger version strings, migration names, and key affected function names.
- Re-inspected the existing reconciliation/follow-up reports and relevant tracked SQL candidates on the remediation branch.
- Inspected the production migration ledger entries and current function definitions, ACLs, table columns, indexes, RLS policy definitions, and Realtime publication membership using read-only catalog queries.
- Checked tracked migration sources that have overlapping behavior, including root and `v6` copies of the booking-engine migration.

The exact six original SQL bodies were not found. GitHub code search returns existing audit references to those ledger strings, not original migration files. The Supabase migration ledger provides only version/name metadata. The connected GitHub source does not expose a verified original SQL editor transcript, backup, or deployment bundle for those six entries. No evidence was found that a workflow artifact contains the missing scripts. Therefore, **the originals cannot be honestly represented as recovered** from the currently connected evidence.

## Exact live-object comparison

This section compares source candidates with observed production state. Because the original applied scripts are absent, it is a *candidate-source-to-live-state* comparison, not an exact historical statement diff.

### 1. Printer transport upsert — ledger `20261003114200`

**Live exact function identity:** `public.fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text,integer)`.

**Live definition/ACL observed:**
- SECURITY DEFINER; `search_path=public`.
- Validates connection type against `network/usb/bluetooth/serial/system`.
- Validates baud rate against the configured allowed values.
- Checks platform-owner/property-role/staff-role authorization.
- Upserts `public.pos_printers` on `(property_id, client_key)`.
- EXECUTE: `authenticated`, `service_role`; not `anon`.
- Live `pos_printers_property_id_client_key_key` unique index exists.

**Tracked candidate mismatch:** files `0047`, `0048`, and `0049` primarily change `public.property_printers` and `printer_assignments`, a distinct model from `pos_printers`. They cannot be used as an exact reconstruction of the missing upsert migration.

**Status:** Current function behavior and ACL sampled; original SQL and its full expected object set missing.

### 2. Broad RPC/RLS hardening — ledger `20261003114849`

**Tracked candidate:** `20261003120500_fix_advisor_performance_and_policy_overlaps.sql`. Its header explicitly states that it does not change SECURITY DEFINER EXECUTE grants. It rewrites selected policies/indexes; it is not evidence of the complete historical RPC/RLS hardening script.

**Observed current policies:** selected self-service/profile/staff policies use scalar-subquery forms of `auth.uid()`; selected ALL/write policies remain alongside SELECT policies on `pos_discounts`, `pos_menu_modifier_groups`, `pos_modifier_groups`, and `pos_modifier_options`. These overlaps require predicate/command-level review; overlap alone is not proof of a defect.

**Confirmed live function mismatch:** `fn_list_pos_menu(uuid)` remains SECURITY DEFINER and authenticated-executable, but its body filters only by supplied `p_property_id` and has no membership/role guard. `fn_current_pos_shift(uuid)` has the same class of issue: supplied-property filtering without caller/property authorization. The current `fn_public_booking_engine_config(uuid)` body returns settings by property ID through a LEFT JOIN, with no active-property or booking-engine-enabled predicate.

**Status:** Candidate SQL is partial; material live authorization gaps remain. This is a release blocker.

### 3. SECURITY DEFINER EXECUTE grant tightening — ledger `20261003114909`

**Observed ACL sample:**
- `fn_list_pos_menu(uuid)`: `authenticated`, `service_role`.
- `fn_current_pos_shift(uuid)`: `authenticated`, `service_role`.
- `fn_upsert_pos_printer(...)`: `authenticated`, `service_role`.
- `fn_subscription_access(uuid,text)`: `authenticated`, `service_role`.
- `fn_public_booking_engine_config(uuid)`: `anon`, `authenticated`, `service_role`.
- `fn_pos_shift_reconciliation(uuid,uuid)`: `authenticated`, `service_role`, SECURITY INVOKER.

This is an exact sample of live ACLs, not a complete all-function ACL matrix. The broad grant-tightening source remains missing; do not use a blanket revoke to compensate.

**Status:** Original grant statements and complete expected role matrix missing.

### 4. Platform Realtime / entitlements — ledger `20261008022614`

**Tracked candidate:** `20261008073000_phase2_pms_realtime.sql` adds core PMS tables conditionally; it does not prove the missing platform-entitlements script.

**Observed publication:** `supabase_realtime` currently contains 13 public tables: `fnb_print_jobs`, `guests`, `housekeeping_tasks`, `pos_kitchen_orders`, `print_logs`, `printer_assignments`, `properties`, `property_printers`, `property_subscriptions`, `property_users`, `reservations`, `rooms`, and `staff`.

**Status:** Live publication membership observed; original expected table list and entitlement statements missing, so per-entry attribution is impossible.

### 5. Dashboard entitlement alias — ledger `20261008023412`

**Live function:** `fn_subscription_access(uuid,text)` normalizes module names, accepts `dashboard` as the landing workspace, and aliases `store`/`stores` to the `store` module after a platform-owner/property-membership check.

**Additional side effect:** if no subscription row exists for an active, packaged property, the SECURITY DEFINER function inserts a `property_subscriptions` row. This means an access-check call can mutate data. Whether this was intended must be verified against the missing source and documented separately.

**Tracked candidates:** `0032_property_paywall.sql` is an earlier baseline; `20261008210000_phase9_rbac_entitlements.sql` delegates entitlement checks but does not uniquely prove the dashboard-alias correction.

**Status:** Current alias behavior observed; original exact statements missing.

### 6. Shift reconciliation security — ledger `20261008042951`

**Live exact function identity:** `public.fn_pos_shift_reconciliation(uuid,uuid)`.

**Live definition observed:**
- SECURITY INVOKER (not SECURITY DEFINER); `search_path=public`.
- Requires platform-owner or property membership.
- Verifies the shift belongs to the supplied property.
- Scopes receipts and refunds by property and shift.
- Calculates revenue, voids, refunds, payment methods, and reconciliation result.

**Tracked candidate comparison:** `20261008093000_phase3_pos_shift_reconciliation.sql` and `20261008110000_phase3_reconciliation_finalization.sql` contain SECURITY INVOKER versions with membership and shift/property checks. The live behavior strongly matches these candidates. However, `20261008104500_phase3_void_refund_reconciliation_correction.sql` concerns cashier adjustment/void/refund behavior rather than uniquely defining the current reconciliation body.

**Status:** Strong behavior-level match; original exact SQL and complete ACL/related-grant provenance remain missing.

## Overall result

| Requirement | Status |
|---|---|
| Recover exact original SQL for all six entries | **Blocked — not present in connected repository evidence** |
| Compare live printer upsert behavior and sampled ACL | Partial; source gap |
| Compare broad RPC/RLS hardening effects | Partial; **live tenant-authorization gaps confirmed** |
| Compare grant-tightening migration | Partial ACL sample only; full expected matrix missing |
| Compare Realtime publication state | Live table set recorded; original expected set missing |
| Compare dashboard alias behavior | Live alias found; historical provenance missing |
| Compare shift reconciliation function | Strong live behavior match; exact provenance missing |
| Production changes | None |
| New Supabase project/branch | None |
| PR #20 / Phase 2 | Keep unmerged / gated |

## Required input to finish historical exact-statement comparison

At least one trusted artifact source must be made available for each missing entry:
1. Original SQL editor query/history export or operator transcript for the production project.
2. The machine/backup directory used to apply those SQL scripts, including original filenames and checksums.
3. A retained deployment/CI artifact that includes the applied SQL and run/commit metadata.
4. A trusted pre/post deployment schema diff that identifies each statement and its deployment provenance.

A current catalog snapshot alone cannot recover overwritten function bodies or prove which ledger row applied a particular statement. Do not synthesize SQL and label it original. Once the artifacts are supplied or exposed through a connected source, hash them, compare statement-by-statement to the tracked candidates, then compare the expected object effects against the production catalog before considering any remediation.

**No production SQL was executed that changed data or schema. No migration was replayed.**
