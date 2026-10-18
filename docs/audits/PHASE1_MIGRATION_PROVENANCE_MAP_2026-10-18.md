# Phase 1 — Migration Provenance Mapping (working audit)

**Snapshot date:** 2026-10-18  
**Target:** Production Supabase project `mszogmazldxjsiytrlxr` (read-only)  
**Source:** `olitechs/olitechpmspos` `main`  
**Status:** Working mapping; candidate matches are not proof of deployed SQL equivalence.

## Safety boundary

This is a documentation-only reconciliation. No production SQL was changed, no migration was applied or repaired, no historical migration was renamed/re-versioned, and no paid Supabase branch was created. The free disposable project is not production-equivalent (48 public base tables versus 79 in production), so it cannot establish production migration provenance by itself.

## Inventory

- Production migration ledger: 38 entries; latest version `20261013194854_restore_property_scoped_stores`.
- Source directory: 127 SQL files (78 legacy-numbered and 49 timestamp-prefixed).
- 20 ledger entries have a source filename whose migration name matches after stripping the version prefix and normalizing separators.
- 18 ledger entries have no exact normalized source-name match. These require object/content-level evidence; they are not automatically considered missing or unapplied.
- Duplicate source filename version prefixes remain a risk (legacy: `0016`, `0028`, `0032`, `0033`, `0034`, `0035`, `0037`, `0040`, `0045`, `0047`, `0048`, `0049`; timestamp collisions: `20261008170000`, `20261008223000`).

## Unmatched ledger entries and candidate sources

**Interpretation:** “Candidate” below means filename/topic-level lead only. It must not be promoted to “equivalent” without checking source SQL effects, live schema objects and constraints/policies/grants, and any available migration history or deployment artifact.

| Production ledger version | Ledger name | Candidate source file(s) | Current classification / next evidence needed |
|---|---|---|---|
| `20261003114141` | `ensure_multi_transport_physical_printers_20261003` | `0049_multi_transport_physical_printers.sql` | Strong name-level lead. Compare all printer columns/check constraints/indexes against live catalog and determine whether this file's contents equal the deployed migration. |
| `20261003114200` | `fix_pos_printer_upsert_transport_20261003` | `0047_hardened_direct_printer_transport.sql`; inspect other printer migrations including `0048_direct_printer_schema_hardening.sql` | Unresolved. The ledger name implies upsert behavior; compare function definitions/triggers/constraints rather than relying on the filename. |
| `20261003114705` | `reconcile_missing_recipe_laundry_transfer_schema_20261003` | `0028_inventory_recipe_laundry_transfers.sql`; `0030_recipes_laundry_transfers.sql` | Unresolved and collision-sensitive. Both files declare recipe/laundry/transfer objects; compare full contents and live table/function definitions before identifying the deployed equivalent. |
| `20261003114729` | `reconcile_missing_recipe_stock_function_20261003` | No defensible single candidate yet; inspect `0028_inventory_recipe_laundry_transfers.sql` and `0030_recipes_laundry_transfers.sql` for the exact stock function body | Unresolved. Capture deployed function identity, definition, owner, security mode, grants, and dependencies. |
| `20261003114849` | `security_hardening_rpc_and_rls_20261003` | `20261011130000_phase0_rpc_rls_remediation.sql`; `0065_phase5_inventory_rpc_security.sql`; review earlier security migrations | Unresolved. Candidate scopes differ. Compare every changed RPC, policy and RLS setting, not just names. |
| `20261003114909` | `tighten_security_definer_execute_grants_20261003` | No defensible single candidate yet; inspect `0065_phase5_inventory_rpc_security.sql`, `20261011130000_phase0_rpc_rls_remediation.sql`, and `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` | Unresolved. Compare exact ACLs by function signature, including PUBLIC/anon/authenticated/service_role. |
| `20261008015909` | `phase5_front_desk_pos_ordering_access` | `0063_front_desk_pos_ordering_access.sql` | Strong normalized-name candidate. Verify its grants/RLS/function effects against live catalog before classifying as equivalent. |
| `20261008015932` | `phase5_sync_store_location_stock` | `0064_sync_store_location_stock.sql` | Strong normalized-name candidate. Verify trigger existence, trigger function body, and stock-location invariants in production. |
| `20261008022614` | `20261008053000_platform_realtime_entitlements` | No single source file identified by current filename inventory | Unresolved. Search source history and inspect publication membership plus entitlement-related function/policy definitions. |
| `20261008023412` | `20261008060000_fix_dashboard_entitlement_alias` | `0007_admin_dashboard.sql` is only a weak topic-level lead | Unresolved. Search all migration history for dashboard aliases and compare exact RPCs/entitlement logic. |
| `20261008041614` | `phase3_split_payments` | `20261008071500_phase3_split_payments_and_indexes.sql` | Strong name-level lead. Verify `pos_receipt_payments`, `fn_record_pos_sale` signature/body, split-allocation validation, RLS, and indexes. |
| `20261008041632` | `phase3_atomic_split_sale` | `20261008071500_phase3_split_payments_and_indexes.sql` | Possible combined/re-versioned migration. Inspect transaction/atomicity and idempotency behavior; do not infer equivalence from the combined filename. |
| `20261008041721` | `phase3_pos_indexes` | `20261008071500_phase3_split_payments_and_indexes.sql`; `20261008093000_phase3_pos_shift_reconciliation.sql` | Unresolved. Compare index names, columns, predicates and uniqueness with live `pg_indexes`. |
| `20261008042951` | `20261008094500_phase3_reconciliation_security_fix` | `20261008110000_phase3_reconciliation_finalization.sql`; `20261008093000_phase3_pos_shift_reconciliation.sql`; inspect `20261008104500_phase3_void_refund_reconciliation_correction.sql` | Unresolved. Reconcile function bodies and EXECUTE grants for reconciliation and stock-adjustment RPCs. |
| `20261008145301` | `phase10_remove_duplicate_printer_index` | `20261008223000_phase10_production_index_cleanup.sql` | Strong topic-level lead; verify the named index's live existence and whether the deployed change was exactly this drop. |
| `20261008145354` | `phase9_rbac_entitlements_reconcile` | `20261008210000_phase9_rbac_entitlements.sql` | Strong normalized-name candidate. Verify the module/role checks and function ACLs match production. |
| `20261012112134` | `workspace_entitlement_module_normalization_20261012` | `20261012160000_workspace_entitlement_module_normalization.sql` | Strong normalized-name candidate. Verify the deployed `fn_subscription_access` body and ACLs; version mismatch remains to be explained. |
| `20261013194854` | `restore_property_scoped_stores` | No source file with this exact name was found in the current migration directory | Unresolved. Inspect current store tables, RLS policies, RPCs and grants; search git history/deleted files and release artifacts for the actual deployed source. |

## Initial production object evidence (read-only)

The production catalog confirms that relevant objects currently exist, including `recipes`, `recipe_ingredients`, `inventory_locations`, `product_stock_locations`, `stock_transfers`, `laundry_orders`, `pos_receipt_payments`, `property_printers`, and `fn_sync_product_default_location()`. Existence alone does not establish which migration created or last modified an object.

The live `create_pending_property_for_user(uuid,text,text,text)` definition still accepts caller-supplied `p_user_id` without checking it against `auth.uid()`; this is the high-priority security drift recorded in `PHASE1_LIVE_SECURITY_DRIFT_2026-10-18.md`. The production fix remains unapplied.


### Additional live catalog observations

Read-only catalog inspection also found:
- `pos_receipt_payments` exists with RLS enabled and indexes `pos_receipt_payments_receipt_idx`, `pos_receipt_payments_property_idx`, and `pos_receipt_payments_receipt_method_idx`.
- `pos_receipts` has `pos_receipts_property_idempotency_key_uidx`, `pos_receipts_pos_shift_id_idx`, and reconciliation/status indexes. This is consistent with split-payment/reconciliation features being present, but does not distinguish which of the multiple candidate migrations introduced them.
- `property_printers` has `property_printers_connection_type_idx` and `property_printers_transport_status_idx`. The catalog query did not return `printer_assignments_printer_type_unique`; since the candidate cleanup uses `DROP INDEX IF EXISTS`, its absence cannot prove that migration ran.
- `rooms`, `reservations`, and `guests` are members of `supabase_realtime`, consistent with the PMS realtime feature. Publication membership does not establish the exact migration provenance.
- `products_sync_default_location` exists and invokes `fn_sync_product_default_location()`, supporting the stock-location sync feature's presence. The trigger/function still need body and ACL comparison against the candidate file.
- Recipe/transfer tables and their primary/unique indexes exist. That establishes current objects, not whether `0028`, `0030`, or one of the deployed legacy migrations was the source.

These observations narrow the object-level comparison but do not upgrade the candidate rows to “equivalent with evidence”; exact SQL artifacts/deployment records and full relevant definition/ACL diffs are still required.

## Required proof to close a row

For each unresolved row, capture:
1. source path and blob SHA / relevant SQL lines;
2. deployed migration version/name and any available SQL artifact or deployment record;
3. exact live object definitions and ACLs affected (tables, columns, constraints, indexes, triggers, policies, functions and grants);
4. a conclusion of **exact**, **equivalent with evidence**, or **unresolved**, with the evidence cited;
5. a list of differences that need a forward-only remediation rather than migration-history repair.

Do not run `migration repair`, rename historical files, or replay the source directory against production. Do not make a production change until provenance is reconciled and the security fix is reviewed and tested against a production-equivalent schema.
