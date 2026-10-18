# Phase 2 — Current migration provenance reconciliation (inventory scope)

**Snapshot date:** 2026-10-18  
**Project inspected read-only:** `mszogmazldxjsiytrlxr`  
**Repository branch:** `phase-2-inventory-security-audit`  
**Current live ledger:** 38 entries. No SQL was executed against production; no migration, grants, RLS policy, function, trigger, or data was changed.

## Decision

**Migration reconciliation is not closed. Do not prepare or apply the inventory correction migration yet.** The live ledger provides applied version/name metadata, not the original SQL/checksum. The committed migration directory contains overlapping numeric prefixes and several files explicitly recorded as applied via Supabase before their parity files were committed. Matching a name or observing the current function body is not proof that a particular file was applied unchanged.

This report supplements the historical 34-entry audit in `docs/audits/PHASE-0-MIGRATION-RECONCILIATION.md`; it does not rewrite that dated snapshot or historical migration history.

## Current 38-entry live ledger

The list below is the live version/name metadata returned during this review. The status column is a provenance assessment, not permission to replay or edit any migration.

| # | Live version | Live name | Inventory/source mapping status |
|---:|---|---|---|
| 1 | 20261003114141 | ensure_multi_transport_physical_printers_20261003 | Out of inventory scope; historical report has candidate `0049_multi_transport_physical_printers.sql`, exact SQL still unproven. |
| 2 | 20261003114200 | fix_pos_printer_upsert_transport_20261003 | Out of inventory scope; unresolved source gap in historical report. |
| 3 | 20261003114705 | reconcile_missing_recipe_laundry_transfer_schema_20261003 | Inventory-adjacent; candidates `0028_inventory_recipe_laundry_transfers.sql` / `0030_recipes_laundry_transfers.sql`; exact statement provenance unresolved. |
| 4 | 20261003114729 | reconcile_missing_recipe_stock_function_20261003 | Inventory-critical; `fn_consume_recipe_stock` exists but exact body/grants are not proven by ledger metadata. |
| 5 | 20261003114849 | security_hardening_rpc_and_rls_20261003 | Security-critical; unresolved exact source/grant/policy mapping. |
| 6 | 20261003114909 | tighten_security_definer_execute_grants_20261003 | Security-critical; no complete equivalent tracked grant-hardening source was identified. |
| 7 | 20261008015806 | phase5_store_pos_source_of_truth | Inventory-critical; candidate `0062_phase5_store_pos_source_of_truth.sql`; compare exact body and ACL. |
| 8 | 20261008015909 | phase5_front_desk_pos_ordering_access | Out of immediate inventory scope; candidate `0063_front_desk_pos_ordering_access.sql`. |
| 9 | 20261008015932 | phase5_sync_store_location_stock | Inventory-critical; candidate `0064_sync_store_location_stock.sql`; trigger behavior is central to the location-balance defect. |
| 10 | 20261008015956 | phase5_inventory_rpc_security | Inventory-critical; candidate `0065_phase5_inventory_rpc_security.sql`; per-RPC role grants still require exact reconciliation. |
| 11 | 20261008022614 | 20261008053000_platform_realtime_entitlements | No same-named tracked source established; unrelated to stock fixes, but unresolved migration provenance remains a project-wide gate. |
| 12 | 20261008023412 | 20261008060000_fix_dashboard_entitlement_alias | Related source exists but exact alias-fix provenance unresolved. |
| 13 | 20261008032718 | phase2_pms_realtime | Candidate `20261008073000_phase2_pms_realtime.sql`. |
| 14 | 20261008034447 | phase2_secure_front_office_mutations | Candidate `20261008074500_phase2_secure_front_office_mutations.sql`. |
| 15 | 20261008035440 | phase2_front_office_financial_integrity | Candidate `20261008080000_phase2_front_office_financial_integrity.sql`. |
| 16 | 20261008035504 | phase2_walk_in_folio_integrity | Candidate `20261008081000_phase2_walk_in_folio_integrity.sql`. |
| 17 | 20261008035602 | phase2_security_surface_cleanup | Candidate `20261008082000_phase2_security_surface_cleanup.sql`. |
| 18 | 20261008035627 | phase2_fix_trigger_search_path | Candidate `20261008082500_phase2_fix_trigger_search_path.sql`. |
| 19 | 20261008040134 | phase2_folio_checkout_housekeeping | Candidate `20261008084000_phase2_folio_checkout_housekeeping.sql`. |
| 20 | 20261008041101 | phase3_pos_pms_integration | Same-name candidate exists; function identity/body still needs comparison. |
| 21 | 20261008041614 | phase3_split_payments | Candidate `20261008071500_phase3_split_payments_and_indexes.sql`; combined-source mapping. |
| 22 | 20261008041632 | phase3_atomic_split_sale | Same combined-source candidate; exact body not proven. |
| 23 | 20261008041721 | phase3_pos_indexes | Same combined-source candidate; exact indexes not proven. |
| 24 | 20261008042511 | 20261008090000_phase3_kds_production_lifecycle | Candidate `20261008090000_phase3_kds_production_lifecycle.sql`. |
| 25 | 20261008042919 | 20261008093000_phase3_pos_shift_reconciliation | Candidate `20261008093000_phase3_pos_shift_reconciliation.sql`. |
| 26 | 20261008042951 | 20261008094500_phase3_reconciliation_security_fix | Related correction exists, but exact source mapping unresolved. |
| 27 | 20261008125120 | phase4_pos_inventory_authority | Candidate `20261008160000_phase4_pos_inventory_authority.sql`; live version differs from source timestamp. |
| 28 | 20261008125306 | phase7_backoffice_configuration | Candidate `20261008163000_phase7_backoffice_configuration.sql`. |
| 29 | 20261008125457 | phase8_daily_hotel_metrics | Candidate `20261008170000_phase8_daily_hotel_metrics.sql`; live timestamp differs from source timestamp and duplicate source prefixes exist. |
| 30 | 20261008143221 | phase8_reporting_management | Candidate `20261008190000_phase8_reporting_management.sql`. |
| 31 | 20261008143901 | phase8_reporting_accuracy | Candidate `20261008200000_phase8_reporting_accuracy.sql`. |
| 32 | 20261008145301 | phase10_remove_duplicate_printer_index | Candidate `20261008223000_phase10_production_index_cleanup.sql`; selected index outcome corroborated, not full SQL equivalence. |
| 33 | 20261008145354 | phase9_rbac_entitlements_reconcile | Candidate `20261008210000_phase9_rbac_entitlements.sql`; role alias/grant equivalence remains open. |
| 34 | 20261008145428 | phase10_financial_ledger_delete_lock | Candidate `20261008230000_phase10_financial_ledger_delete_lock.sql`; selected no-delete-policy outcomes corroborated. |
| 35 | 20261012112134 | workspace_entitlement_module_normalization_20261012 | Newer entry; source file and full live function/policy/grant comparison must be identified before this entry is called reconciled. |
| 36 | 20261013180526 | staff_pin_throttle_and_hash_privileges | Newer entry; source file and live function/table grants need exact comparison. |
| 37 | 20261013194249 | pos_device_registry | Newer entry; source migration and table/policy/index definitions need exact comparison. |
| 38 | 20261013194854 | restore_property_scoped_stores | Newer entry; source migration and store/location authorization definitions need exact comparison. |

## Inventory source files that are not represented by an exact live ledger filename

The following committed files must be classified by comparing statements and resulting objects, not by filename or timestamp:

- `20261008120000_phase4_authoritative_inventory_ledger.sql`
- `20261008121500_phase4_bulk_import_ledger.sql`
- `20261008123000_phase4_inventory_operations.sql`
- `20261008133000_phase4_goods_receiving_grn.sql`
- `20261008103000_phase3_void_refund_stock_settlement.sql`
- `20261008104500_phase3_void_refund_reconciliation_correction.sql`
- `20261008114500_phase3_refund_stock_helper_lockdown.sql`
- `20261008230500_harden_bulk_product_import.sql`
- `20261008201500_inventory_expiry_watch.sql`
- `20261008150000_phase6_cashier_financial_hardening.sql`
- `20261008152500_phase5_fnb_print_recovery.sql`

This list is not an instruction to apply those files. Some effects may have been applied under a different live ledger entry, subsumed by a later function replacement, or never deployed. Each file needs an object-level disposition.

## Required reconciliation artifacts before any forward migration

1. For each live entry, identify the committed source file(s), exact expected changed object identities, and any missing applied SQL/deployment artifact.
2. Query the current live catalog read-only for every affected function's identity arguments, full `pg_get_functiondef`, SECURITY DEFINER/INVOKER mode, `search_path`, owner and EXECUTE ACL.
3. Compare table columns, constraints, indexes, trigger functions/order, RLS enabled state, policy command/role/USING/WITH CHECK, and publication membership with source expectations.
4. For inventory, specifically reconcile `fn_apply_stock_movement`, `fn_record_pos_sale`, `fn_reverse_pos_stock`, `fn_consume_recipe_stock`, `fn_receive_purchase_order`, `fn_complete_stock_transfer`, `fn_post_stock_adjustment`, `fn_approve_inventory_count`, `fn_post_wastage`, `fn_post_production`, `fn_inventory_valuation`, and `products_sync_default_location`.
5. Reconcile movement totals against `products.current_stock` and `product_stock_locations` using read-only aggregate queries; identify any drift before choosing a repair plan.
6. Record each discrepancy as **verified exact source**, **verified included in another applied migration**, **tracked source missing**, **not deployed**, or **unresolved**. No ambiguous row may be silently classified as safe to replay.
7. Only after this is complete, build the migration locally or in an already-authorized disposable environment; run regression tests, advisors, and app checks; review recovery steps. Never modify historical filenames or migration ledger entries.

## Current conclusion

The event/role contract and static source guards are now documented on the Phase 2 branch. The 38-row ledger has been refreshed read-only. Exact inventory SQL-to-live equivalence, the missing/overlapping source mappings, and runtime two-property authorization/balance tests remain blockers. Therefore no corrective SQL migration has been authored or applied yet.
