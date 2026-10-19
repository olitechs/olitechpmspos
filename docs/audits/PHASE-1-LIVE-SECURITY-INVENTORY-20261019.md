# Phase 1 — Live Security Inventory Snapshot

**Captured:** 2026-10-19  
**Purpose:** Evidence for reconciliation only. This report is not a deployment approval.  
**Production project:** `mszogmazldxjsiytrlxr` (read-only queries only)  
**Existing disposable project:** `rmkcwminrizloosvegzp`  
**Source baseline:** `main` at `017bb447c651020fac2733f3e721a11012da1839`; Phase 1 branch head before this report: `eff2856d294e6285debcfaeabc98300c1b542d24`.

## 1. Live catalog counts

| Catalog signal | Production | Disposable | Interpretation |
|---|---:|---:|---|
| Public base tables | 79 | 48 | Disposable schema is not equivalent |
| Public functions | 136 | 102 | Disposable schema is not equivalent |
| Migration ledger entries | 38 | 56 | Do not infer historical SQL from names |
| SECURITY DEFINER functions | 100 | 83 | Require signature-by-signature review |
| SECURITY DEFINER functions executable by `authenticated` | 96 | 82 | Count is an inventory signal, not by itself a vulnerability finding |
| SECURITY DEFINER functions executable by `anon` | 1 | 56 | Disposable project has materially different ACL posture |
| SECURITY DEFINER functions without fixed `search_path` | 0 | 0 | This check does not establish that all function bodies are safe |
| Public tables with RLS disabled | 0 | 1 | Disposable project has an RLS-disabled table |
| Public policies | 217 | 137 | Policy count does not establish policy correctness |
| Policies targeting role `public` | 193 | 137 | Review grants and predicates together; do not blanket-revoke |

## 2. Confirmed production drift

### High priority: public booking configuration RPC

Production `public.fn_public_booking_engine_config(uuid)` is `SECURITY DEFINER`, executable by `anon`, and its current body uses a LEFT JOIN to booking settings without checking that the property is active or that settings are enabled. The Supabase security advisor flags this as an anonymous-callable SECURITY DEFINER function.

The tracked source migration `supabase/migrations/20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` changes this to require `p.status = 'active'` and `s.enabled IS TRUE`, but it is absent from the production migration ledger. The function body must be reviewed for compatibility before deployment; the migration has **not** been applied.

### High priority: pending-property creation

The Phase 0 execution record documents production `public.create_pending_property_for_user(uuid,text,text,text)` accepting caller-provided `p_user_id` without matching it to `auth.uid()`. The tracked source remediation compares the supplied user ID with the authenticated actor, but production is not confirmed to contain that guard.

### High priority: POS menu and shift RPCs

The Phase 0 execution record documents missing caller/property authorization guards in production `public.fn_list_pos_menu(uuid)` and `public.fn_current_pos_shift(uuid)`. The tracked source migration checks membership/platform-owner/current-staff-role. That is an improvement over the observed production body but is not yet a sufficient final authorization contract: current staff session identity, expiry/revocation, assigned module, action permission, property status, and subscription entitlement must be proven at the server boundary.

### Potential mutation inside access evaluation

Production `public.fn_subscription_access(uuid,text)` contains an INSERT into `property_subscriptions` when a subscription row is missing. A function used as an access check should not silently mutate subscription state. Split this compatibility repair into an explicit, separately authorized and audited operation only after dependencies and callers are mapped. Do not alter package semantics as part of this remediation.

## 3. RLS and policy review leads

- Production catalog query reports RLS enabled on all 79 public base tables; none are FORCE RLS. FORCE RLS is not automatically required for every table, but ownership, bypass roles, views, triggers, and SECURITY DEFINER access must be reviewed.
- Eight production UPDATE policies have a NULL `WITH CHECK`: `room_types_update`, `rate_plans_update`, `housekeeping_tasks_update`, `room_closures_update`, `property_users_update`, `maintenance_tickets_update`, `inventory_items_update`, and `inventory_movements_update`. Determine whether the corresponding `property_id` or owner fields are client-writable and inspect constraints/triggers before proposing a targeted correction. Do not infer exploitability from this count alone.
- Many tables have multiple permissive policies, which PostgreSQL ORs together. Review the effective predicate per table and operation; adding a restrictive-looking policy does not cancel an existing permissive policy.
- Production security advisor reports RLS enabled without a policy on `public.staff_pin_attempts`. Verify whether direct grants are absent and access is intentionally limited to a narrow RPC. The disposable project also flags `public.staff_sessions` as RLS-enabled without a policy.
- Production advisor flags `fn_public_booking_engine_config(uuid)` as anonymous-callable SECURITY DEFINER. It also emits generic authenticated-callable SECURITY DEFINER notices for 96 functions; each needs a signature, caller, ACL, body, property/action/entitlement guard, search path, and intended-exposure disposition. Do not mass-revoke EXECUTE: existing app workflows and intentionally public endpoints must be mapped first.
- Disposable advisors show additional schema-specific issues, including an RLS-disabled `public.pos_shifts`, a SECURITY DEFINER view `public.my_properties`, and 18 functions with mutable search path. These are not proof of identical production findings; the disposable project is not schema-equivalent.

## 4. Migration history and safety

The six unresolved historical ledger artifacts listed in `docs/audits/PHASE-0-EXECUTION-20261019.md` remain unrecoverable from currently connected evidence. Preserve the migration ledger and original filenames. Do not fabricate scripts, rewrite history, mark migrations applied, or replay candidate migrations.

No production DDL, grants, policies, functions, triggers, data, or migration ledger entries were changed during this inventory. No new Supabase branch/project was created. No files under `v6/` were changed.

## 5. Required remediation gates

1. Produce a versioned inventory for every exposed SECURITY DEFINER function: exact signature, owner, ACL, search path, body hash/body review, direct/indirect callers, caller identity, tenant scope, role/action permission, entitlement, and intended anon/service-role access.
2. Produce a per-table RLS/grant matrix, including views/materialized views, child tables without `property_id`, UPDATE `USING` + `WITH CHECK`, cross-property reassignment, and all alternate RPC paths.
3. Build a disposable two-property/two-user fixture with distinct memberships and staff sessions; test direct SELECT/INSERT/UPDATE/DELETE and sensitive RPC families as anon, non-member, member, staff, expired/revoked session, wrong module/action, inactive property, missing entitlement, and service role.
4. Review the four Phase 0 RPC corrections against actual production signatures, dependencies, return types, grants, and source schema. Run only on an equivalent isolated schema; keep the production migration ledger unchanged.
5. Implement action-level server authorization, PIN/session expiry/revocation, and transaction-bound append-only audit events. Test the authorization decision and the business operation atomically.
6. Test the actual browser workflows, including PIN login, property switching, session expiry, offline queue behavior, and POS/PMS regression suites.
7. Merge/release only after CI and security/browser gates pass and Phase 0 has explicit sign-off.

**Disposition:** Inventory advanced; Phase 0/Phase 1 remain blocked. This report is evidence, not a claim of completed enforcement or production remediation.
