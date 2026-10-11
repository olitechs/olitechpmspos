# Phase 0 — Six-Entry Migration Evidence Follow-up

**Checked:** 2026-10-11  
**Repository:** `olitechs/olitechpmspos`  
**Ref:** `audit/phase-0-baseline`  
**Supabase:** existing project `mszogmazldxjsiytrlxr`  
**Scope:** read-only source inspection and live catalog inspection. No database mutations, migration replay, or branch creation.

## Result

The additional source and catalog checks narrow the six entries, but do **not** justify marking any of the six fully reconciled. The live migration ledger records names/versions, not the original SQL statements applied. A current object definition establishes current behavior, not which historical ledger row installed it.

## Entry-by-entry evidence

### 1. `20261003114200 — fix_pos_printer_upsert_transport_20261003`

**Live evidence:** `public.fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text,integer)` exists as SECURITY DEFINER with `search_path=public`. Its body upserts into `public.pos_printers` using conflict target `(property_id, client_key)`, validates transport values `network/usb/bluetooth/serial/system`, and checks role authorization.

**Tracked source inspected:** `0047_hardened_direct_printer_transport.sql`, `0048_direct_printer_schema_hardening.sql`, and `0049_multi_transport_physical_printers.sql`. These modify `public.property_printers` and its transport constraints; they do not define the live `fn_upsert_pos_printer` body or its `pos_printers` upsert.

**Status: unresolved.** The tracked candidates concern overlapping printer functionality but do not uniquely establish this ledger entry's upsert correction. Need the applied SQL artifact or deployment diff for the function and its target table.

### 2. `20261003114849 — security_hardening_rpc_and_rls_20261003`

**Tracked source inspected:** `20261003120500_fix_advisor_performance_and_policy_overlaps.sql`. Its header explicitly says it does not change SECURITY DEFINER execution grants. It rewrites selected policy expressions, splits some ALL/write policies, and creates missing FK indexes.

**Live evidence:** policy overlaps remain on `pos_discounts`, `pos_menu_modifier_groups`, `pos_modifier_groups`, and `pos_modifier_options`. Those overlaps alone do not prove a policy is wrong; each predicate and command scope needs review.

**Status: partial only.** This source cannot be treated as the complete broad RPC/RLS hardening migration.

### 3. `20261003114909 — tighten_security_definer_execute_grants_20261003`

**Tracked source inspected:** the policy/index cleanup migration expressly excludes SECURITY DEFINER grants; `0065_phase5_inventory_rpc_security.sql` changes selected RPC permissions only.

**Live evidence:** the catalog query retrieved SECURITY DEFINER bodies and EXECUTE grantees for selected printer, subscription, dashboard, and shift functions. It did not establish a complete expected-versus-actual grant matrix for every function and role, and no single tracked all-purpose grant-tightening migration was identified.

**Status: source-control gap remains.** Recover the applied grant script or a trusted deployment artifact; then diff each function identity's ACL against intended grants and revokes. Do not apply broad revokes based on name or count alone.

### 4. `20261008022614 — 20261008053000_platform_realtime_entitlements`

**Tracked source inspected:** `20261008073000_phase2_pms_realtime.sql` conditionally adds `rooms`, `reservations`, and `guests` to `supabase_realtime`.

**Live evidence:** publication membership includes core PMS tables plus additional POS/printer and entitlement-related tables. This proves a publication is configured, not that the entry's entitlement logic or exact intended publication membership is fully represented by that three-table migration.

**Status: unresolved.** Need the missing platform entitlement SQL/deployment artifact and a definitive expected publication/table list.

### 5. `20261008023412 — 20261008060000_fix_dashboard_entitlement_alias`

**Tracked source inspected:** `0032_property_paywall.sql` defines an earlier `fn_subscription_access`; `20261008210000_phase9_rbac_entitlements.sql` adds RBAC/module wrappers but does not define the current dashboard alias mapping in that file.

**Live evidence:** `public.fn_subscription_access(uuid,text)` currently normalizes module input and explicitly treats `dashboard` as the landing workspace; it also aliases `store` and `stores` to the stored `store` module. It checks platform-owner/property membership before returning access.

**Status: behavior corroborated; provenance unresolved.** The live body contains alias handling, but no tracked migration uniquely explains the specific dashboard alias fix. Need the exact correction artifact or commit diff.

### 6. `20261008042951 — 20261008094500_phase3_reconciliation_security_fix`

**Tracked source inspected:** `20261008104500_phase3_void_refund_reconciliation_correction.sql` replaces `fn_pos_shift_reconciliation(uuid,uuid)` with a SECURITY INVOKER function and performs explicit platform-owner/property-membership checks before reading the selected property's shift and receipts.

**Live evidence:** `fn_pos_shift_reconciliation(uuid,uuid)` is currently SECURITY INVOKER (not SECURITY DEFINER), has `search_path=public`, and contains property-membership and shift/property consistency checks.

**Status: strong behavioral match, exact ledger mapping still unresolved.** The current body aligns with the correction source, but the live ledger entry name differs from the tracked filename and later changes may have replaced the same function. The applied statement/deployment diff is needed to close provenance and to reconcile the exact ACL state.

## Safe closure procedure

1. Obtain the six original applied SQL scripts from the deployment source, operator transcript, CI artifact, or a trusted historical backup.
2. Normalize and compare SQL statements against tracked candidates; do not infer equivalence from filenames.
3. For each entry, enumerate expected changed object identities and compare function definitions, ACLs, RLS policy predicates/commands/roles, constraints/indexes, and publication membership.
4. Record one of: **verified exact source**, **verified included in another applied migration**, **tracked source missing**, or **unresolved**.
5. Do not replay, rename, reorder, or repair production migration history during this audit.

No production changes or additional Supabase branch costs were incurred.
