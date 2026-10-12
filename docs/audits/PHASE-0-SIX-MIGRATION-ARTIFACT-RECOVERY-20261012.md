# Phase 0 — Six Migration Artifact Recovery and Live Effect Reconciliation

**Checked:** 2026-10-12  
**Repository ref:** `fix/phase0-rpc-rls-remediation`  
**Production Supabase project:** `mszogmazldxjsiytrlxr`  
**Decision:** **BLOCKED — original SQL artifacts were not recovered from accessible Git history; live state exposes additional security drift that must be addressed before release.**

## Safety boundary

This was a read-only production catalog and migration-ledger inspection plus repository history/source inspection. No SQL was applied; no production schema, data, grants, policies, or publication membership was changed. No Supabase branch or project was created. No historical migration was replayed.

## Recovery result

Exact-name searches of repository commits for all six ledger names returned no matching commits. The repository contains related source migrations and later code, but none of the accessible sources proves the exact SQL submitted for all six original ledger rows. The production migration ledger contains version/name metadata only; it does not retain the original SQL body.

Accordingly, the original six scripts are **not recovered**. This report records the closest source candidates and independently observed live effects, without treating names or behavioral similarity as proof of provenance.

## Entry-by-entry reconciliation

### 1. `20261003114200 — fix_pos_printer_upsert_transport_20261003`

**Original artifact:** Not found in accessible repository history.

**Tracked candidates inspected:**
- [0047_hardened_direct_printer_transport.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/0047_hardened_direct_printer_transport.sql)
- [0048_direct_printer_schema_hardening.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/0048_direct_printer_schema_hardening.sql)
- [0049_multi_transport_physical_printers.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/0049_multi_transport_physical_printers.sql)

These files alter `public.property_printers`; they do not define the live `public.fn_upsert_pos_printer(...)` function, which upserts into the separate `public.pos_printers` table.

**Live effect observed:** `fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text,integer)` exists as SECURITY DEFINER, has `search_path=public`, checks platform/property/staff role authorization, validates connection type and baud rate, and upserts using unique key `(property_id, client_key)`. EXECUTE is granted to `authenticated` and `service_role`, not `anon`.

**Disposition:** **Partial behavioral evidence; source/provenance unresolved.** Do not equate the property-printer schema migrations with the missing POS-printer upsert correction.

### 2. `20261003114849 — security_hardening_rpc_and_rls_20261003`

**Original artifact:** Not found.

**Tracked candidate inspected:** [20261003120500_fix_advisor_performance_and_policy_overlaps.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/20261003120500_fix_advisor_performance_and_policy_overlaps.sql). Its own header expressly says it does not change SECURITY DEFINER execution grants, and it focuses on selected policy rewrites and indexes. It is not evidence of the complete missing RPC/RLS hardening script.

**Live security-relevant effects observed:**
- `fn_list_pos_menu(uuid)` is SECURITY DEFINER and executable by `authenticated`, but its current live body only filters rows by the supplied `p_property_id`; it does **not** check that the caller belongs to that property or has an authorized staff role.
- `fn_current_pos_shift(uuid)` is also SECURITY DEFINER and authenticated-executable; its current live body filters by supplied property ID and open shift but contains no caller/property authorization check.
- `fn_public_booking_engine_config(uuid)` is SECURITY DEFINER and executable by `anon`, `authenticated`, and `service_role`. Its current live body uses a LEFT JOIN and filters only by property ID; it does not enforce the active-property / enabled-booking-engine predicates described by the candidate remediation SQL on this branch.
- The Phase 0 forward-only remediation source proposes stronger guards for the first two functions and tighter public-booking filtering, but it is only repository source in this branch; the inspected production definitions do not contain those guards.

**Disposition:** **Unresolved, with confirmed live authorization drift.** The current `fn_list_pos_menu` body is consistent with the prior reported cross-tenant exposure. Do not clear Phase 0 on the basis of CI success or the presence of a proposed fix in Git.

### 3. `20261003114909 — tighten_security_definer_execute_grants_20261003`

**Original artifact:** Not found.

**Tracked source inspected:** the policy/index cleanup explicitly excludes SECURITY DEFINER grants. Other tracked migrations change selected function permissions but do not establish a complete replacement for the missing grant-tightening script.

**Live ACL snapshot observed for selected functions:** `fn_upsert_pos_printer`, `fn_subscription_access`, `fn_pos_shift_reconciliation`, `fn_list_pos_menu`, and `fn_current_pos_shift` are executable by `authenticated` and `service_role`; `fn_public_booking_engine_config` is also executable by `anon`. This is a targeted sample, not a complete inventory of every SECURITY DEFINER function or every expected role grant.

**Disposition:** **Unresolved.** Recover the exact applied grant script or a trusted deployment transcript, then compare grants by exact function identity signature and role. Avoid blanket revokes that could break intended workflows.

### 4. `20261008022614 — 20261008053000_platform_realtime_entitlements`

**Original artifact:** Not found.

**Tracked candidate inspected:** [20261008073000_phase2_pms_realtime.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/20261008073000_phase2_pms_realtime.sql), which conditionally adds `rooms`, `reservations`, and `guests` to `supabase_realtime`. It does not establish the missing entry's full entitlement-related intent.

**Live effect observed:** `supabase_realtime` currently publishes 13 public tables: `fnb_print_jobs`, `guests`, `housekeeping_tasks`, `pos_kitchen_orders`, `print_logs`, `printer_assignments`, `properties`, `property_printers`, `property_subscriptions`, `property_users`, `reservations`, `rooms`, and `staff`.

**Disposition:** **Partial effect corroboration; exact mapping unresolved.** The larger publication set may reflect multiple migrations; current membership cannot prove which ledger entry added each table or whether it matches the intended entitlement behavior.

### 5. `20261008023412 — 20261008060000_fix_dashboard_entitlement_alias`

**Original artifact:** Not found.

**Tracked candidates inspected:**
- [0032_property_paywall.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/0032_property_paywall.sql), which defines an earlier subscription access function but not the specific dashboard alias behavior.
- [20261008210000_phase9_rbac_entitlements.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/20261008210000_phase9_rbac_entitlements.sql), which delegates module entitlement checks to `fn_subscription_access` but does not itself define the current alias mapping.

**Live effect observed:** `fn_subscription_access(uuid,text)` normalizes module input; treats `dashboard` as the landing workspace and maps `store` / `stores` to the stored `store` module. It verifies platform-owner/property membership. Its current SECURITY DEFINER body also inserts a subscription row if one is absent and the property is active with a package, so this function is not strictly read-only despite its access-check role.

**Disposition:** **Behavior corroborated; provenance unresolved.** Review the insert side effect separately in the authorization and data-integrity review. Do not infer that the missing alias migration is recovered.

### 6. `20261008042951 — 20261008094500_phase3_reconciliation_security_fix`

**Original artifact:** Not found.

**Tracked candidates inspected:**
- [20261008093000_phase3_pos_shift_reconciliation.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/20261008093000_phase3_pos_shift_reconciliation.sql)
- [20261008110000_phase3_reconciliation_finalization.sql](https://github.com/olitechs/olitechpmspos/blob/fix/phase0-rpc-rls-remediation/supabase/migrations/20261008110000_phase3_reconciliation_finalization.sql)

These define `fn_pos_shift_reconciliation` as SECURITY INVOKER with `search_path=public` and explicit platform-owner/property-membership and shift/property consistency checks. The previously cited `20261008104500_phase3_void_refund_reconciliation_correction.sql` does **not** define this reconciliation function; it concerns cashier adjustment/void/refund behavior. The earlier candidate mapping should not be used as provenance evidence.

**Live effect observed:** the current live `fn_pos_shift_reconciliation(uuid,uuid)` is SECURITY INVOKER, has `search_path=public`, checks platform-owner/property membership, verifies the shift belongs to the requested property, and scopes receipt/refund queries by property and shift.

**Disposition:** **Strong current-behavior match to the 09:30/11:00 tracked candidates; exact ledger mapping unresolved.** Current live function security mode and behavior are corroborated, but exact applied source and all related ACL changes remain unproven.

## Conclusions and required next evidence

1. **None of the six original scripts has been recovered as the exact applied artifact.** Accessible Git history yielded related source only.
2. Live production catalog inspection found significant security drift in `fn_list_pos_menu`, `fn_current_pos_shift`, and `fn_public_booking_engine_config` relative to the intended guards documented in the Phase 0 remediation source.
3. `fn_pos_shift_reconciliation` currently has the expected invoker/membership checks, but the exact original ledger-to-source mapping remains unproven.
4. The current realtime publication and dashboard/store aliases are observable, but they do not establish exact historical provenance.
5. Continue to keep PR #20 unmerged and Phase 2 gated.

To finish provenance recovery, obtain at least one trusted source for the exact original SQL or deployed change for each missing entry: the operator's SQL editor transcript/export, original migration files from the machine/backup used for deployment, CI/release artifacts, or a trusted pre/post schema/deployment diff. Then compare each expected object effect against the live catalog. Do not recreate a historical script from the current schema and label it original.

**No production changes were made during this pass.**
