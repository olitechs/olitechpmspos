# Phase 0 — Migration Reconciliation Addendum (Live Schema Evidence)

**Checked:** 2026-10-11  
**Supabase project:** `mszogmazldxjsiytrlxr` (existing project only)  
**Repository ref:** `audit/phase-0-baseline`  
**Scope:** read-only catalog inspection and repository migration-file comparison. No migrations, DDL, grants, policies, or production data were changed.

## Reconciliation result

The live ledger currently contains 34 rows, ending at version `20261008145428`. The repository directory contains 118 SQL migration files plus README. The 34 ledger rows are recorded in `PHASE-0-MIGRATION-RECONCILIATION.md`; this addendum records fresh catalog evidence and distinguishes schema corroboration from proof of exact migration equivalence.

**Important limitation:** Supabase's migration ledger exposes applied version/name metadata, not the original SQL text for each historical application. Consequently, exact statement-by-statement equivalence cannot be asserted from the ledger alone. It requires the original applied SQL/deployment artifact or a trusted pre/post schema snapshot. The live catalog can corroborate resulting objects but cannot prove which historical file created them when later migrations replace the same function/policy.

## Live schema evidence

| Area | Repository source candidate(s) | Live observation | Assessment |
|---|---|---|---|
| Multi-transport printer schema | `0047_hardened_direct_printer_transport.sql`, `0048_direct_printer_schema_hardening.sql`, `0049_multi_transport_physical_printers.sql` | `property_printers`, `printer_assignments` and transport/status indexes exist. Canonical unique index `printer_assignments_printer_id_assignment_type_key` exists; duplicate `printer_assignments_printer_type_unique` is absent. | Resulting schema corroborated; historical SQL provenance remains partial. |
| Recipe/laundry/transfer schema | `0028_inventory_recipe_laundry_transfers.sql`, `0030_recipes_laundry_transfers.sql` | `fn_consume_recipe_stock(uuid,jsonb,text)` exists as SECURITY DEFINER with `search_path=public`; recipes, recipe ingredients, stock transfers and laundry objects are present. | Strong result-level corroboration; the two candidate files overlap and are not interchangeable without statement diff. |
| Advisor/policy cleanup | `20261003120500_fix_advisor_performance_and_policy_overlaps.sql` | `pos_receipts_shift_idx` and other POS indexes/policies exist. Current policy catalog still has SELECT plus ALL/write permissive-policy overlaps on `pos_discounts`, `pos_menu_modifier_groups`, `pos_modifier_groups`, and `pos_modifier_options`. | Partial match only. Existing overlaps may be intentional for write authorization but need policy predicate review; do not treat filename as proof the ledger entry is equivalent. |
| Phase 5 store/POS source of truth | `0062_phase5_store_pos_source_of_truth.sql` | `fn_bulk_upsert_store_products(uuid,jsonb)` and `fn_list_pos_menu(uuid)` exist. Live `fn_list_pos_menu` has no direct membership check and a negative tenant test returned another property's menu. | Object exists; security behavior is defective despite the candidate migration. |
| Phase 5 stock-location synchronization | `0064_sync_store_location_stock.sql`, `0065_phase5_inventory_rpc_security.sql` | `fn_sync_product_default_location()` exists, is SECURITY DEFINER, has `search_path=public`, and is not executable by anon/authenticated. `fn_bulk_upsert_store_products` is authenticated-executable and not anon-executable. | Strong ACL/config corroboration for the probed objects; exact full-file equivalence not proven. |
| Phase 2 realtime | `20261008073000_phase2_pms_realtime.sql` | `supabase_realtime` publication includes `reservations`, `rooms`, `staff`, `housekeeping_tasks`, `properties`, `property_subscriptions`, and POS/printer tables. | Publication is present with expected core tables; exact expected table set needs comparison with source SQL. |
| Phase 2 secure front-office mutations | `20261008074500_phase2_secure_front_office_mutations.sql`, `20261008080000_phase2_front_office_financial_integrity.sql`, `20261008081000_phase2_walk_in_folio_integrity.sql`, `20261008082000_phase2_security_surface_cleanup.sql`, `20261008082500_phase2_fix_trigger_search_path.sql` | `fn_walk_in_check_in` and `fn_record_front_desk_payment` are not anon-executable and are authenticated-executable. `fn_phase2_property_guard` is not executable by anon/authenticated. `fn_phase2_touch_updated_at` has `search_path=public`. | ACL/search-path checks corroborate selected statements, not every grant or mutation guard. |
| Phase 3 split sale / reconciliation | `20261008071500_phase3_split_payments_and_indexes.sql`, `20261008093000_phase3_pos_shift_reconciliation.sql`, `20261008104500_phase3_void_refund_reconciliation_correction.sql` | `pos_receipt_payments`, shift-payment indexes, and POS receipt/shift indexes exist. `fn_pos_shift_reconciliation` exists. | Strong object-level evidence; function bodies and all index definitions still require per-object source comparison. |
| Phase 9 entitlements | `20261008210000_phase9_rbac_entitlements.sql` | `fn_staff_module_access` exists. | Existence corroborated; role aliases and grants are not fully reconciled. |
| Phase 10 printer-index cleanup | `20261008223000_phase10_production_index_cleanup.sql` | Canonical printer assignment unique index exists and duplicate index is absent. | Result corroborated. |
| Phase 10 financial ledger delete lock | `20261008230000_phase10_financial_ledger_delete_lock.sql` | No DELETE or ALL policy is present on `payments`, `pos_receipts`, or `inventory_movements`. | Policy outcome corroborated for those tables; verify grants/triggers and other financial tables separately. |

## Ledger rows with unresolved or non-unique source mapping

These rows must remain explicitly unresolved until original applied SQL or deployment artifacts are recovered:

| Ledger version | Ledger name | Reason |
|---|---|---|
| `20261003114200` | `fix_pos_printer_upsert_transport_20261003` | No same-named tracked migration; adjacent printer migrations cover overlapping schema, not proven exact upsert correction. |
| `20261003114849` | `security_hardening_rpc_and_rls_20261003` | Candidate cleanup file only partially aligns; live policy overlaps remain. |
| `20261003114909` | `tighten_security_definer_execute_grants_20261003` | No equivalent tracked all-purpose grant-hardening file identified. |
| `20261008022614` | `20261008053000_platform_realtime_entitlements` | No same-named tracked file. Realtime publication is present but does not establish the full entitlement change. |
| `20261008023412` | `20261008060000_fix_dashboard_entitlement_alias` | Related older subscription source exists, but exact alias correction source was not identified. |
| `20261008042951` | `20261008094500_phase3_reconciliation_security_fix` | Related correction/finalization files exist; exact applied grant/function state cannot be assigned uniquely from the ledger name. |

## Repository migrations beyond the live ledger

The tracked migration directory includes later files whose timestamps/names are not represented in the 34-row live ledger, including:

- `20261009100000_phase2_pms_audit_trail.sql`
- `20261009103000_phase2_folio_payment_reconciliation.sql`
- `20261008230500_harden_bulk_product_import.sql`
- `20261008201500_inventory_expiry_watch.sql`
- `20261008150000_phase6_cashier_financial_hardening.sql`
- `20261008152500_phase5_fnb_print_recovery.sql`
- `20261008120000_phase4_authoritative_inventory_ledger.sql`
- `20261008121500_phase4_bulk_import_ledger.sql`
- `20261008123000_phase4_inventory_operations.sql`
- `20261008133000_phase4_goods_receiving_grn.sql`
- `20261008135000_phase5_printer_property_integrity.sql`
- `20261008100000_phase3_receipt_refund_settlement.sql`
- `20261008103000_phase3_void_refund_stock_settlement.sql`
- `20261008110000_phase3_reconciliation_finalization.sql`
- `20261008113000_phase3_refund_printer_route.sql`
- `20261008114500_phase3_refund_stock_helper_lockdown.sql`

This list is a ledger-name comparison, **not** an instruction to apply these files. Some statements may have been applied under differently named ledger rows or subsumed by later migrations. Before any deployment, each file must be classified as (a) already applied under another ledger entry, (b) intentionally not applied, or (c) pending and safe to apply only after a reviewed migration plan. Never blindly replay them against production.

## Specific negative evidence

A catalog probe did not find these functions in the live public schema at the time checked: `fn_audit_pms_change`, `fn_reconcile_folio_payments`, `fn_harden_bulk_product_import`. They are suggestive of later migration work, but the names alone do not prove their absence is a defect; inspect each corresponding SQL file for the actual objects it creates and any later rename/replacement before classifying.

## Closure criteria

The migration reconciliation is **not yet fully closed**. To close it without a paid branch or production mutation:

1. Recover the exact SQL/deployment artifacts for the six unresolved ledger entries above.
2. Parse each of the 34 ledger entries against its candidate source and record the expected changed object names.
3. Compare every affected live function body, function identity signature, EXECUTE ACL, RLS policy expression, index definition, constraint, trigger definition, and publication membership against that expected object set.
4. Enumerate every tracked SQL migration not represented by a ledger row; prove whether its effects are included in another applied migration or absent from production.
5. Preserve production history: no migration replay, rename, reorder, deletion, or ledger repair as part of this audit.

No branch or additional Supabase cost was incurred for this reconciliation.
