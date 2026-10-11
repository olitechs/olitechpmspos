# Phase 0 — Live Migration Ledger Reconciliation

**Snapshot:** source commit `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a`; live Supabase project `mszogmazldxjsiytrlxr`; 34 applied ledger versions; 118 root `supabase/migrations/*.sql` files.

## Important interpretation
A ledger `version` is the applied timestamp, not necessarily the filename prefix. Several source files combine changes split into multiple live ledger entries. Name similarity is not proof of SQL equivalence. No migration, DDL, grants, RLS policies, or production data were changed.

## All 34 live entries

| # | Live version | Live name | Candidate tracked source | Status |
|---:|---|---|---|---|
| 1 | 20261003114141 | ensure_multi_transport_physical_printers_20261003 | `0049_multi_transport_physical_printers.sql` | Strong candidate; compare full SQL. |
| 2 | 20261003114200 | fix_pos_printer_upsert_transport_20261003 | Related printer files `0047_hardened_direct_printer_transport.sql`, `0048_direct_printer_schema_hardening.sql` | Unresolved: no same-named file; exact upsert correction not proven tracked. |
| 3 | 20261003114705 | reconcile_missing_recipe_laundry_transfer_schema_20261003 | `0030_recipes_laundry_transfers.sql` / `0028_inventory_recipe_laundry_transfers.sql` | Strong schema candidate; exact SQL comparison pending. |
| 4 | 20261003114729 | reconcile_missing_recipe_stock_function_20261003 | `0030_recipes_laundry_transfers.sql` | Live `fn_consume_recipe_stock` exists; exact body/grants pending. |
| 5 | 20261003114849 | security_hardening_rpc_and_rls_20261003 | `20261003120500_fix_advisor_performance_and_policy_overlaps.sql` | Partial/uncertain; compare each policy and index. |
| 6 | 20261003114909 | tighten_security_definer_execute_grants_20261003 | **No equivalent tracked migration found** | Confirmed source-control gap in this review. The 20261003120500 file explicitly says it does not change SECURITY DEFINER grants; 0065 only changes a specific RPC grant. |
| 7 | 20261008015806 | phase5_store_pos_source_of_truth | `0062_phase5_store_pos_source_of_truth.sql` | Strong candidate. |
| 8 | 20261008015909 | phase5_front_desk_pos_ordering_access | `0063_front_desk_pos_ordering_access.sql` | Strong candidate. |
| 9 | 20261008015932 | phase5_sync_store_location_stock | `0064_sync_store_location_stock.sql` | Strong candidate; live trigger function exists. |
| 10 | 20261008015956 | phase5_inventory_rpc_security | `0065_phase5_inventory_rpc_security.sql` | Strong candidate; verify exact live ACL. |
| 11 | 20261008022614 | 20261008053000_platform_realtime_entitlements | **No same-named source file found** | Unresolved source gap; live entitlement functions exist, publication membership/body comparison pending. |
| 12 | 20261008023412 | 20261008060000_fix_dashboard_entitlement_alias | Related earlier baseline: `0032_property_paywall.sql` | Unresolved: live `fn_subscription_access` exists, but no same-named alias-fix migration found. |
| 13 | 20261008032718 | phase2_pms_realtime | `20261008073000_phase2_pms_realtime.sql` | Strong candidate; verify publication membership. |
| 14 | 20261008034447 | phase2_secure_front_office_mutations | `20261008074500_phase2_secure_front_office_mutations.sql` | Strong candidate; compare all revokes/grants. |
| 15 | 20261008035440 | phase2_front_office_financial_integrity | `20261008080000_phase2_front_office_financial_integrity.sql` | Strong candidate; financial tests pending. |
| 16 | 20261008035504 | phase2_walk_in_folio_integrity | `20261008081000_phase2_walk_in_folio_integrity.sql` | Strong candidate; live walk-in RPC exists and is not anon-executable. |
| 17 | 20261008035602 | phase2_security_surface_cleanup | `20261008082000_phase2_security_surface_cleanup.sql` | Strong candidate; compare ACLs. |
| 18 | 20261008035627 | phase2_fix_trigger_search_path | `20261008082500_phase2_fix_trigger_search_path.sql` | Strong candidate; live trigger helper has configured search path. |
| 19 | 20261008040134 | phase2_folio_checkout_housekeeping | `20261008084000_phase2_folio_checkout_housekeeping.sql` | Strong candidate; financial and tenant tests pending. |
| 20 | 20261008041101 | phase3_pos_pms_integration | `20261008041101_phase3_pos_pms_integration.sql` | Direct source-name match; exact function signatures still need diff. |
| 21 | 20261008041614 | phase3_split_payments | `20261008071500_phase3_split_payments_and_indexes.sql` | Combined-file candidate; `pos_receipt_payments` exists. |
| 22 | 20261008041632 | phase3_atomic_split_sale | `20261008071500_phase3_split_payments_and_indexes.sql` | Combined-file candidate; compare live function body/signature. |
| 23 | 20261008041721 | phase3_pos_indexes | `20261008071500_phase3_split_payments_and_indexes.sql` | Combined-file candidate; inspect each deployed index. |
| 24 | 20261008042511 | 20261008090000_phase3_kds_production_lifecycle | `20261008090000_phase3_kds_production_lifecycle.sql` | Strong candidate; lifecycle tests pending. |
| 25 | 20261008042919 | 20261008093000_phase3_pos_shift_reconciliation | `20261008093000_phase3_pos_shift_reconciliation.sql` | Strong candidate; live reconciliation RPC exists. |
| 26 | 20261008042951 | 20261008094500_phase3_reconciliation_security_fix | Related correction: `20261008104500_phase3_void_refund_reconciliation_correction.sql` | Unresolved/combined history; compare function and grant bodies. |
| 27 | 20261008125120 | phase4_pos_inventory_authority | `20261008160000_phase4_pos_inventory_authority.sql` | Strong candidate; inventory ledger tests pending. |
| 28 | 20261008125306 | phase7_backoffice_configuration | `20261008163000_phase7_backoffice_configuration.sql` | Strong candidate; configuration tables exist. |
| 29 | 20261008125457 | phase8_daily_hotel_metrics | `20261008170000_phase8_daily_hotel_metrics.sql` | Strong candidate; live function exists. A different Phase 7 file shares this 14-digit prefix. |
| 30 | 20261008143221 | phase8_reporting_management | `20261008190000_phase8_reporting_management.sql` | Strong candidate; live function exists. |
| 31 | 20261008143901 | phase8_reporting_accuracy | `20261008200000_phase8_reporting_accuracy.sql` | Strong candidate; compare full body, not name alone. |
| 32 | 20261008145301 | phase10_remove_duplicate_printer_index | `20261008223000_phase10_production_index_cleanup.sql` | Schema verified: canonical unique index exists; duplicate index absent. |
| 33 | 20261008145354 | phase9_rbac_entitlements_reconcile | `20261008210000_phase9_rbac_entitlements.sql` | Related source candidate; live module-access RPC exists. Role alias/grant comparison pending. |
| 34 | 20261008145428 | phase10_financial_ledger_delete_lock | `20261008230000_phase10_financial_ledger_delete_lock.sql` | Schema verified: no DELETE/ALL policy for payments, POS receipts, inventory movements. |

## Deployed schema probes

Confirmed live objects: `fn_upsert_pos_printer`, `fn_consume_recipe_stock`, `fn_subscription_access`, `fn_pos_shift_reconciliation`, `fn_daily_hotel_metrics`, `fn_management_report`, `fn_staff_module_access`, `fn_add_folio_charge`. The canonical printer-assignment unique index exists and its duplicate is absent. Delete policies for `payments`, `pos_receipts`, and `inventory_movements` are absent. A guessed `fn_record_pos_sale` signature did not match; that is not evidence the function is absent—query `pg_proc` for its actual signature.

## Exit blockers

1. Recover/reconstruct exact source for entries #2, #5, #6, #11, #12, and #26.
2. Compare all 34 stored SQL statements against candidate files after comment/whitespace normalization; map every statement to the actual changed functions, policies, indexes, constraints, and publication tables.
3. Identify root migration files not represented by the ledger via exact statement comparison or later-migration inclusion. Do not infer they are safe to apply.
4. Never rename, reorder, replay, delete, or squash production migration history. Test any reconciliation on a disposable Supabase branch first.

**Status: advanced but incomplete.** Each live entry is recorded individually; exact full SQL-to-deployed-object equivalence is still an explicit Phase 0 blocker.
