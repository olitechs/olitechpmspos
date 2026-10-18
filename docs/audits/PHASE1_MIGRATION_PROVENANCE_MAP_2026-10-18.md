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


## Evidence-based dispositions after source/live comparison

This section records what the current evidence supports. “Feature present” means the relevant live objects or behavior exist; it does **not** establish the exact migration file/version that introduced them. Production's ledger stores version/name metadata, not the historical SQL body or blob hash. Therefore, no row is labelled **exact** without a preserved deployment artifact.

| Ledger version / name | Source blob(s) inspected | Live production evidence | Disposition |
|---|---|---|---|
| `20261003114141 ensure_multi_transport_physical_printers_20261003` | `0049_multi_transport_physical_printers.sql` blob `00d58031fc2eb80a5241617f80fd6b7164275743` | `property_printers` has connection-type/status indexes and RLS/policies; schema has transport fields (see live catalog). | **Feature consistent; provenance unresolved.** File adds transport fields/check values/index; live indexes support the feature, but exact check-constraint/column comparison and deployment SQL artifact are still needed. |
| `20261003114200 fix_pos_printer_upsert_transport_20261003` | `0047_hardened_direct_printer_transport.sql` blob `e1f448489f96eb0c02dfd2d2d8ca1cdd4642b137`; `0048_direct_printer_schema_hardening.sql` blob `cc077ee0031106c66be6bdae6c56f65aa715762d` | Live printer status/transport indexes exist; this does not prove which upsert body or constraints were deployed. | **Unresolved.** Candidate files primarily alter columns/check constraints/indexes; ledger name suggests upsert behavior not established by those files alone. Need exact upsert function/trigger definition and deployment artifact. |
| `20261003114705 reconcile_missing_recipe_laundry_transfer_schema_20261003` | `0028_inventory_recipe_laundry_transfers.sql` blob `27731ee127a86a1713c80b4b2352071b7e33f034`; `0030_recipes_laundry_transfers.sql` blob `ecd30654f03ed892d9b6b9654e4029af0837819a` | Recipe, ingredient, inventory-location, product-stock-location, stock-transfer and laundry tables exist; all inspected tables have RLS and four property-scoped policies. | **Feature consistent; exact provenance unresolved.** The two candidates overlap materially but differ in function implementation/length; current schema alone cannot identify which version ran. |
| `20261003114729 reconcile_missing_recipe_stock_function_20261003` | Same two recipe/laundry candidates above | Recipe/stock functions exist; current `fn_record_pos_sale` has a 16-argument signature, while these candidates include an earlier 10-argument signature. | **Later evolution/overwrite demonstrated; migration provenance unresolved.** The live function is not byte/identity-equivalent to the candidate signature; inspect full live body/deployment history before attributing the stock-function change. |
| `20261003114849 security_hardening_rpc_and_rls_20261003` | `20261011130000_phase0_rpc_rls_remediation.sql` blob `e16f7c48e318edd6dba451b60ff5146d59db7f34`; `0065_phase5_inventory_rpc_security.sql` blob `500b51077e6a123b8cf1509870291e85a53f1733` | Recipe/inventory/transfer tables have RLS and property policies. The four high-risk RPCs below are still not all guarded as in the later source candidate. | **Partial feature evidence; unresolved.** Do not assume this ledger row represents the later remediation source. Compare each function/policy and ACL individually. |
| `20261003114909 tighten_security_definer_execute_grants_20261003` | Same security candidates plus `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql` blob `b1d003f9415b026d05850914963d7d3bedacc5bd` | Live grants for `create_pending_property_for_user`, `fn_list_pos_menu`, and `fn_current_pos_shift` exclude anon and permit authenticated/service_role; public booking config permits anon/authenticated/service_role. | **Grant surface mostly matches the later candidate, but function-body authorization does not.** This confirms grants alone are insufficient. The exact historical grant migration remains unresolved. |
| `20261008015909 phase5_front_desk_pos_ordering_access` | `0063_front_desk_pos_ordering_access.sql` blob `4dee676e27778092458b03e815a1da0120d4201b` | Current staff/module data was not exhaustively compared against the migration's specific update predicate. | **Unresolved.** The candidate is a small data update for active front-desk/reception staff; current rows cannot prove the historical update ran. Need a safe aggregate-only comparison of assigned modules and a deployment artifact. |
| `20261008015932 phase5_sync_store_location_stock` | `0064_sync_store_location_stock.sql` blob `67670e92ec7104e6845832cd8066f7b5bf0332c4` | `products_sync_default_location` exists and invokes `fn_sync_product_default_location()`; function is SECURITY DEFINER with search_path=public, executable by service_role but not anon/authenticated. | **Feature consistent; provenance unresolved.** Need full live trigger/function comparison, including delta accounting and trigger event/timing. |
| `20261008022614 20261008053000_platform_realtime_entitlements` | No source file with this exact name exists in current `main` migration directory. | Realtime publication includes `rooms`, `reservations`, and `guests`. | **Realtime portion supported; entitlement portion unresolved.** Publication membership supports the realtime sub-effect, but no evidence identifies the combined migration's entitlement SQL. |
| `20261008023412 20261008060000_fix_dashboard_entitlement_alias` | No source file with this exact name exists in current directory. | `fn_subscription_access(uuid,text)` exists, is SECURITY DEFINER, and is executable by authenticated; its current body normalizes module aliases and checks subscription/property state. | **Current feature present; historical migration unresolved.** Need git history/deployment SQL to link the ledger entry to the current function body. |
| `20261008041614 phase3_split_payments` | `20261008071500_phase3_split_payments_and_indexes.sql` blob `5559cf82299b500cefd1760ce1995c9fbc6298b6` | `pos_receipt_payments` exists with RLS and the candidate's receipt/property indexes; `pos_receipts_property_idempotency_key_uidx` and shift index exist. | **Feature consistent; later evolution present.** Current receipt-sale function signature has 16 arguments, matching the candidate's newer extended signature in this file; exact original ledger artifact remains unavailable. |
| `20261008041632 phase3_atomic_split_sale` | Same split-payment candidate above | Current payment table, receipt idempotency index, and split-payment receipt index exist. | **Feature consistent; exact provenance unresolved.** The candidate combines payment schema, idempotency and atomic sale function; no deployment artifact proves whether this combined source or separately versioned migrations created them. |
| `20261008041721 phase3_pos_indexes` | Same split-payment candidate and `20261008093000_phase3_pos_shift_reconciliation.sql` blob `17fb4e7aa14addd9b7ad69f610c0746a5efdd662` | Current POS receipts have shift, status, property, reservation/room, discount and idempotency indexes; payment table indexes exist. | **Indexes/features present; exact provenance unresolved.** Current index definitions should be compared by full `pg_get_indexdef` before treating any candidate as equivalent. |
| `20261008042951 20261008094500_phase3_reconciliation_security_fix` | `20261008104500_phase3_void_refund_reconciliation_correction.sql` blob `df369278e31c74ca327c4269c425eb6d2cfc389b`; `20261008110000_phase3_reconciliation_finalization.sql` blob `f08d268e3f7d930f883ceed2168bf908ae082061` | Reconciliation-related POS indexes exist, but current source/live function body and ACL comparison is incomplete. | **Unresolved.** Do not infer equivalence from index presence; compare full reconciliation/refund/stock RPC definitions and grants. |
| `20261008145301 phase10_remove_duplicate_printer_index` | `20261008223000_phase10_production_index_cleanup.sql` blob `2dd3276551b31db25271fb6456b8aeef78c75739` | Index `printer_assignments_printer_type_unique` is absent from live index listing. | **Consistent with cleanup, not proof it ran.** The source uses `DROP INDEX IF EXISTS`; the index may have been absent before the migration. |
| `20261008145354 phase9_rbac_entitlements_reconcile` | `20261008210000_phase9_rbac_entitlements.sql` blob `841fa03110185939f01938d6de5b42e49d3f7ecf` | Current entitlement/RBAC functions exist, are SECURITY DEFINER with search_path=public, and authenticated can execute them. | **Feature consistent; exact provenance unresolved.** Function body and effective/direct ACLs need full comparison; current function existence cannot prove the source version. |
| `20261012112134 workspace_entitlement_module_normalization_20261012` | `20261012160000_workspace_entitlement_module_normalization.sql` blob `af2e29759d1ba1d09a1c7d8de1bade50bf48da94` | `fn_subscription_access(uuid,text)` exists and authenticated can execute it. Current body contains active-property/package/subscription checks and module normalization. | **Strong functional correspondence; exact provenance unresolved.** Compare complete normalized function body and direct ACLs to the candidate, and locate the deployment artifact. |
| `20261013194854 restore_property_scoped_stores` | No exact source file in current migration directory. | `stores` exists with RLS, four policies, `stores_property_default_idx`, and `stores_property_name_unique`. The query did not find a `store_locations` relation. | **Store table is present; migration provenance and intended “property-scoped stores” semantics unresolved.** Search deleted git history/release artifacts and compare store RLS, RPCs, constraints and grants. |

## Authorization and grant verification (production, read-only)

### Effective execution surface observed

| Function | anon | authenticated | service_role | SECURITY DEFINER | Observed concern |
|---|---:|---:|---:|---:|---|
| `create_pending_property_for_user(uuid,text,text,text)` | No | Yes | Yes | Yes; `search_path=public,row_security=off` | **Critical authorization drift:** live body checks only that `p_user_id` is non-null, then creates/returns a property for that supplied ID. It does not compare the ID with `auth.uid()`. A later candidate at `20261013210000` derives/validates the actor, but that migration version is absent from production ledger. |
| `fn_list_pos_menu(uuid)` | No | Yes | Yes | Yes; `search_path=public` | Live body filters by caller-supplied property UUID and POS flags but lacks the source candidate's caller/property membership and active-staff authorization guards. |
| `fn_current_pos_shift(uuid)` | No | Yes | Yes | Yes; `search_path=public` | Live body filters only by caller-supplied property UUID, open status and Nairobi date; it lacks the candidate's membership/staff authorization guards. |
| `fn_public_booking_engine_config(uuid)` | Yes | Yes | Yes | Yes; `search_path=public` | Anonymous execute appears intentional for a public booking widget, but live body does not require active property status or `booking_engine_settings.enabled IS TRUE`; later candidate does. Keep anon grant until public booking requirements and a safe replacement are validated. |

The role checks above use PostgreSQL effective `has_function_privilege` results, not only direct ACL text. Function owners and service-role capabilities are separate from the ordinary authenticated caller model. Do not blanket-revoke SECURITY DEFINER functions; evaluate each function's callers and dependent RPCs.

### RLS/policy observations

- `recipes`, `recipe_ingredients`, `inventory_locations`, `product_stock_locations`, `stock_transfers`, `laundry_orders`, `pos_receipt_payments`, `pos_receipts`, `property_printers`, `products`, `properties`, `property_users`, and `stores` all have RLS enabled in the inspected production catalog.
- The six recipe/inventory/laundry/transfer tables each had four policies with property membership/platform-owner predicates.
- `pos_receipt_payments` has a single SELECT policy for authenticated users; writes are expected to flow through privileged sale RPCs.
- This targeted list does not clear the separate advisor finding for `staff_pin_attempts` or all other tables/policies.

## Gate status

- Migration mapping: **partially reconciled, not complete**. The live schema supports multiple feature-level correspondences, but the database ledger does not preserve deployed SQL bodies or source blob hashes. Rows marked unresolved need deployment artifacts, git history, or full object-level diffs before an exact mapping can be asserted.
- Authorization/grants: **critical drift confirmed** for the four RPCs above; no grants or functions changed.
- Transactional two-property regression: prior focused disposable-project test passed and rolled back fixture data, but that project is not schema-equivalent to production.
- CI: latest GitHub Validate and Production QA runs succeeded.
- Vercel: deployment check is failing due the free-plan API deployment rate limit (`api-deployments-free-per-day`), not an application compile/test result.
- Production: read-only throughout this continuation. No migrations applied, no migration history repaired, no paid branch created, and no Phase 2 work started.

## Required proof to close a row

For each unresolved row, capture:
1. source path and blob SHA / relevant SQL lines;
2. deployed migration version/name and any available SQL artifact or deployment record;
3. exact live object definitions and ACLs affected (tables, columns, constraints, indexes, triggers, policies, functions and grants);
4. a conclusion of **exact**, **equivalent with evidence**, or **unresolved**, with the evidence cited;
5. a list of differences that need a forward-only remediation rather than migration-history repair.

Do not run `migration repair`, rename historical files, or replay the source directory against production. Do not make a production change until provenance is reconciled and the security fix is reviewed and tested against a production-equivalent schema.
