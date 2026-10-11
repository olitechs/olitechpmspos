# Phase 0 — RPC and RLS Policy Inventory

**Live Supabase project:** `mszogmazldxjsiytrlxr` · **Snapshot:** 2026-10-11 · **Mode:** read-only.

This file is an object-by-object inventory and static triage aid. Guard markers show source text only; they do not prove correct authorization. All mutating authorization tests must run in a disposable branch. No production grants, policies, functions, or data were changed.

## Function/RPC inventory

`EXEC` columns reflect effective PostgreSQL EXECUTE privileges as queried, not just explicit ACL text. `GUARD markers` are string-presence checks in `pg_get_functiondef`; wrappers, helper calls, trigger-only functions, and control flow need semantic review.

| Signature | Definer | EXEC anon/auth/service | search_path | Guard markers | Write-like SQL marker | Return type |
|---|---|---|---|---|---|---|
| `admin_audit_log(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `record` |
| `admin_dashboard_stats()` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `jsonb` |
| `admin_list_properties()` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `record` |
| `admin_profile_count()` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `bigint` |
| `admin_property_users(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `record` |
| `admin_sync_pending_applications()` | YES | —/Y/Y | `search_path=public,row_security=off` | platform owner | no/indirect | `integer` |
| `approve_property(uuid,property_package)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | yes | `properties` |
| `can_backoffice(uuid)` | YES | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `boolean` |
| `can_manage_phase2_catalogue(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property role, staff role | no/indirect | `boolean` |
| `can_manage_pos_menu(uuid)` | YES | —/Y/Y | `search_path=public` | property role, staff role, POS menu guard | no/indirect | `boolean` |
| `can_store_read(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property role, staff role | no/indirect | `boolean` |
| `can_store_write(uuid,text)` | YES | —/Y/Y | `search_path=public` | property role, staff role, store write guard | no/indirect | `boolean` |
| `charge_restaurant_to_room(uuid,uuid,text,numeric)` | YES | —/Y/Y | `search_path=public` | platform owner, property member, property role, staff role | yes | `folio_charges` |
| `claim_owner_property(text)` | YES | —/Y/Y | `search_path=public,row_security=off` | **none detected** | no/indirect | `properties` |
| `clear_active_staff_session()` | YES | —/Y/Y | `search_path=public` | auth.uid | yes | `boolean` |
| `create_pending_property_for_user(uuid,text,text,text)` | YES | —/Y/Y | `search_path=public,row_security=off` | **none detected** | yes | `properties` |
| `create_staff_member(uuid,text,text,text,text,text[],text,text,uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid | yes | `jsonb` |
| `current_staff_id(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid | no/indirect | `uuid` |
| `current_staff_role(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, staff role | no/indirect | `text` |
| `ensure_my_pending_property(text)` | YES | —/Y/Y | `search_path=public,row_security=off` | auth.uid, platform owner | no/indirect | `properties` |
| `fn_add_folio_charge(uuid,uuid,text,text,numeric)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `folio_charges` |
| `fn_add_reservation(uuid,uuid,text,text,date,date,integer,numeric)` | no | —/Y/Y | `search_path=public` | **none detected** | yes | `reservations` |
| `fn_add_room_to_reservation_group(uuid,uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `reservations` |
| `fn_adjust_guest_loyalty_points(uuid,uuid,integer,text,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `guest_loyalty_accounts` |
| `fn_adjust_product_stock(uuid,numeric,text)` | YES | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `products` |
| `fn_adjust_stock(uuid,numeric,text)` | no | —/Y/Y | `search_path=public` | **none detected** | yes | `inventory_items` |
| `fn_apply_stock_movement(uuid,numeric,text,text,uuid)` | YES | —/—/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `products` |
| `fn_approve_cashier_adjustment(uuid,boolean,text)` | YES | —/Y/Y | `search_path=""` | auth.uid, platform owner, property role, staff role | yes | `cashier_adjustments` |
| `fn_approve_inventory_count(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `inventory_counts` |
| `fn_bulk_upsert_pos_menu(uuid,jsonb)` | YES | —/Y/Y | `search_path=public` | POS menu guard | no/indirect | `integer` |
| `fn_bulk_upsert_store_products(uuid,jsonb)` | YES | —/Y/Y | `search_path=public` | platform owner, property member, store write guard | yes | `jsonb` |
| `fn_cashier_shift_summary(uuid)` | YES | —/Y/Y | `search_path=""` | platform owner, property role, staff role | no/indirect | `jsonb` |
| `fn_channel_connection_upsert(uuid,text,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `channel_connections` |
| `fn_check_in_reservation(uuid)` | no | —/Y/Y | `search_path=public` | property member | yes | `reservations` |
| `fn_check_out_room(uuid)` | no | —/Y/Y | `search_path=public` | property member | yes | `reservations` |
| `fn_check_room_availability(uuid,uuid,date,date,uuid)` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `record` |
| `fn_clock_staff(uuid,uuid,boolean,text)` | no | Y/Y/Y | `search_path=""` | auth.uid, property member | yes | `staff_timecards` |
| `fn_close_cashier_shift(uuid,numeric,text)` | YES | —/Y/Y | `search_path=""` | auth.uid, platform owner, property role, staff role | yes | `cashier_shifts` |
| `fn_close_pos_shift(uuid,numeric,text,boolean)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property role, staff role | yes | `jsonb` |
| `fn_complete_stock_transfer(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `stock_transfers` |
| `fn_consume_recipe_stock(uuid,jsonb,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `jsonb` |
| `fn_create_and_receive_purchase(uuid,uuid,text,date,jsonb)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `purchase_orders` |
| `fn_create_housekeeping_task(uuid,uuid,text,text,uuid,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `housekeeping_tasks` |
| `fn_create_inventory_count(uuid,uuid,jsonb,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `inventory_counts` |
| `fn_create_kitchen_order(uuid,text,text,text,text,jsonb,jsonb)` | no | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, property role, staff role | yes | `pos_kitchen_orders` |
| `fn_create_laundry_order(uuid,uuid,uuid,text,jsonb,numeric,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `laundry_orders` |
| `fn_create_maintenance_ticket(uuid,uuid,text,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `maintenance_tickets` |
| `fn_create_purchase_order(uuid,uuid,jsonb,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `purchase_orders` |
| `fn_create_reservation_bundle(uuid,uuid[],uuid,text,text,date,date,text,text,text,integer,integer,jsonb,numeric,numeric,text)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `reservations` |
| `fn_create_stock_transfer(uuid,uuid,uuid,jsonb,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `stock_transfers` |
| `fn_current_pos_shift(uuid)` | YES | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `pos_shifts` |
| `fn_daily_hotel_metrics(uuid,date)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_daily_pos_summary(uuid,date)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_delete_planner_reservation(uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `void` |
| `fn_delete_pos_printer(uuid,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property role, staff role | yes | `boolean` |
| `fn_ensure_inventory_locations(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `inventory_locations` |
| `fn_get_business_date(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `date` |
| `fn_get_my_subscription_overview()` | YES | —/Y/Y | `search_path=public` | auth.uid, property role | no/indirect | `record` |
| `fn_get_subscription(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `property_subscriptions` |
| `fn_housekeeping_dashboard(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_housekeeping_list_tasks(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `record` |
| `fn_inspect_housekeeping_task(uuid,boolean,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `housekeeping_tasks` |
| `fn_inventory_reconciliation(uuid)` | no | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `record` |
| `fn_inventory_valuation(uuid)` | no | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `record` |
| `fn_list_active_kitchen_orders(uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `pos_kitchen_orders` |
| `fn_list_active_pos_table_sessions(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `pos_table_sessions` |
| `fn_list_pos_menu(uuid)` | YES | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `record` |
| `fn_list_pos_printers(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `pos_printers` |
| `fn_maintenance_dashboard(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_management_report(uuid,date,date)` | no | Y/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_management_sales_detail(uuid,date,date)` | no | Y/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_move_or_merge_pos_table(uuid,text,text,text,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property role, staff role | yes | `jsonb` |
| `fn_move_planner_reservation(uuid,uuid,date,date)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `reservations` |
| `fn_move_reservation_group(uuid,uuid,uuid,date,date)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `reservations` |
| `fn_night_audit_history(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `night_audits` |
| `fn_night_audit_precheck(uuid,date)` | YES | —/Y/Y | `search_path=public` | platform owner, property role, staff role | no/indirect | `jsonb` |
| `fn_open_cashier_shift(uuid,numeric)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, property role, staff role | yes | `cashier_shifts` |
| `fn_open_pos_shift(uuid,numeric,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property role, staff role | yes | `pos_shifts` |
| `fn_phase2_property_guard()` | YES | —/—/Y | `search_path=public` | **none detected** | no/indirect | `trigger` |
| `fn_phase2_touch_updated_at()` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `trigger` |
| `fn_pos_shift_reconciliation(uuid,uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_post_production(uuid,uuid,uuid,numeric,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `inventory_productions` |
| `fn_post_stock_adjustment(uuid,uuid,numeric,text,uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `stock_adjustments` |
| `fn_post_wastage(uuid,uuid,numeric,text,uuid,date)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `inventory_wastage` |
| `fn_public_booking_engine_config(uuid)` | YES | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `jsonb` |
| `fn_receive_purchase_order(uuid,jsonb)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `purchase_orders` |
| `fn_recent_dashboard_activity(uuid,integer)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `jsonb` |
| `fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text,text)` | YES | —/Y/Y | `search_path=""` | auth.uid, platform owner, property member, property role, staff role | yes | `cashier_adjustments` |
| `fn_record_front_desk_payment(uuid,uuid,numeric,text,uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `payments` |
| `fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, staff role | yes | `pos_receipts` |
| `fn_record_pos_split_payment(uuid,uuid,jsonb)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `pos_receipt_payments` |
| `fn_record_stock_usage(uuid,date,text,uuid,numeric,text,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `stock_usage` |
| `fn_record_subscription_event(uuid,text,text,text,jsonb)` | YES | —/Y/Y | `search_path=public` | platform owner | yes | `subscription_events` |
| `fn_refire_kitchen_order(uuid,uuid,text)` | no | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, property role, staff role | yes | `pos_kitchen_orders` |
| `fn_remove_pos_item(uuid,text,text,numeric,text,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property role, staff role | yes | `jsonb` |
| `fn_remove_reservation(uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `void` |
| `fn_reverse_pos_stock(uuid,jsonb,numeric,text)` | YES | —/—/Y | `search_path=public` | platform owner, property member | no/indirect | `void` |
| `fn_run_night_audit(uuid,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property role, staff role | yes | `night_audits` |
| `fn_split_reservation_group(uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `void` |
| `fn_staff_module_access(uuid,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, property role | no/indirect | `boolean` |
| `fn_subscription_access(uuid,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `jsonb` |
| `fn_subscription_module_allowed(uuid,text)` | YES | —/Y/Y | `search_path=public` | **none detected** | no/indirect | `boolean` |
| `fn_sync_booked_room_status()` | no | —/—/Y | `search_path=public` | **none detected** | yes | `trigger` |
| `fn_sync_product_default_location()` | YES | —/—/Y | `search_path=public` | **none detected** | yes | `trigger` |
| `fn_touch_maintenance_ticket()` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `trigger` |
| `fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `pos_table_sessions` |
| `fn_touch_products()` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `trigger` |
| `fn_update_fnb_print_job(uuid,uuid,text,text,uuid)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `fnb_print_jobs` |
| `fn_update_housekeeping_task(uuid,text,uuid,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `housekeeping_tasks` |
| `fn_update_kitchen_order(uuid,uuid,text,jsonb)` | no | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member, property role, staff role | yes | `pos_kitchen_orders` |
| `fn_update_laundry_order(uuid,text,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `laundry_orders` |
| `fn_update_maintenance_ticket(uuid,text,uuid,text,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `maintenance_tickets` |
| `fn_update_planner_reservation(uuid,uuid,date,date,text,text,text,text,integer,integer,jsonb,numeric,numeric,text)` | no | —/Y/Y | `search_path=public` | platform owner, property member | yes | `reservations` |
| `fn_upsert_guest(uuid,text,text)` | no | —/Y/Y | `search_path=public` | **none detected** | yes | `uuid` |
| `fn_upsert_pos_menu_item(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,text,integer,boolean)` | YES | —/Y/Y | `search_path=public` | POS menu guard | yes | `products` |
| `fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text,integer)` | YES | —/Y/Y | `search_path=public` | platform owner, property role, staff role | yes | `pos_printers` |
| `fn_upsert_recipe(uuid,text,numeric,jsonb,text)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | yes | `recipes` |
| `fn_upsert_subscription(uuid,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[])` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | yes | `property_subscriptions` |
| `fn_walk_in_check_in(uuid,uuid,text,text,date,date,integer,numeric)` | no | —/Y/Y | `search_path=public` | property member | yes | `reservations` |
| `handle_new_user()` | YES | —/Y/Y | `search_path=public,row_security=off` | **none detected** | yes | `trigger` |
| `is_hotel_admin(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property role | no/indirect | `boolean` |
| `is_member_of_property(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, property member | no/indirect | `boolean` |
| `is_platform_owner()` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | no/indirect | `boolean` |
| `list_room_charge_stays(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner, property member | no/indirect | `record` |
| `platform_list_property_members(uuid)` | YES | —/Y/Y | `search_path=public` | platform owner | no/indirect | `record` |
| `platform_package_modules(property_package)` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `text[]` |
| `platform_set_property_package(uuid,property_package)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | yes | `properties` |
| `platform_set_property_status(uuid,property_status)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | yes | `properties` |
| `platform_update_subscription(uuid,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[])` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner | yes | `property_subscriptions` |
| `property_role(uuid)` | YES | —/Y/Y | `search_path=public` | auth.uid, property role | no/indirect | `property_member_role` |
| `reset_staff_pin(uuid,text)` | YES | —/Y/Y | `search_path=public` | **none detected** | yes | `boolean` |
| `touch_active_staff_session()` | YES | —/Y/Y | `search_path=public` | auth.uid | yes | `boolean` |
| `touch_staff_updated_at()` | no | Y/Y/Y | `search_path=public` | **none detected** | no/indirect | `trigger` |
| `verify_staff_pin(uuid,text,text)` | YES | —/Y/Y | `search_path=public` | auth.uid, platform owner, property member | yes | `jsonb` |

### Function-level priority findings

- **SEC-001 — `create_pending_property_for_user(uuid,text,text,text)`:** `SECURITY DEFINER`, authenticated execution is enabled, accepts arbitrary `p_user_id`, and function body does not check `p_user_id = auth.uid()`. A read-only call by User A with User B's existing owner-property ID returned User B's property. Revoke client execution or make the function self-scoping; preserve trigger/service use as required. Regression tests must include existing-owner and no-existing-owner target accounts.
- **SEC-002 — `fn_list_pos_menu(uuid)`:** `SECURITY DEFINER`, authenticated execution enabled, no membership/role marker in body. A nonmember returned one row from another property's menu. Add server-side tenant/role check and a negative cross-tenant test.
- **SEC-003 — `fn_current_pos_shift(uuid)`:** `SECURITY DEFINER`, authenticated execution enabled, function filters only by supplied property ID and open/date status. No direct tenant/role guard is present. Current database had no open current-day shifts to prove row disclosure; treat as high-priority static finding.
- **SEC-004 — `fn_public_booking_engine_config(uuid)`:** the one anon-callable SECURITY DEFINER function; returns property name, currency, terms, cancellation policy, and payment instructions. Body does not check active property or `booking_engine_settings.enabled`. Current test properties had no settings, so populated-disabled-config exposure is untested.
- **SEC-005 — `properties_update_owner_admin` policy:** WITH CHECK uses scalar subqueries `properties_1.id = properties_1.id` instead of correlating to the updated row. A read-only probe of that expression produced SQLSTATE 21000 (more than one row). Correct with a forward-only migration and test owner/admin update plus unauthorized denial.
- **SEC-006 — anonymous RLS behavior:** anonymous direct table read produced `permission denied for function is_platform_owner` while evaluating a policy. This denies access but surfaces as an error; confirm intended public endpoint behavior before changing helper grants.

## RLS policy inventory

Current policy count: 209. Table/command groups with multiple policies: 0. Supabase advisor reported 20 multiple-permissive-policy warnings; the exact advisor grouping and OR semantics must be reconciled with these groups.

| Table | Policy | Permissive | Roles | Command | Same table/command count | USING (truncated to 180 chars) | WITH CHECK (truncated to 180 chars) |
|---|---|---|---|---|---:|---|---|
| `audit_logs` | `audit_logs_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(actor_id = ( SELECT auth.uid() AS uid))` |
| `audit_logs` | `audit_logs_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])))` | `` |
| `booking_engine_sessions` | `booking_engine_sessions_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `booking_engine_settings` | `booking_engine_settings_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `booking_engine_settings` | `booking_engine_settings_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `booking_engine_settings` | `booking_engine_settings_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `booking_engine_settings` | `booking_engine_settings_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `cashier_adjustments` | `cashier_adjustments_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `` |
| `cashier_refunds` | `cashier_refunds_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `cashier_shifts` | `cashier_shifts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (opened_by = ( ` | `` |
| `channel_connections` | `channel_connections_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `channel_connections` | `channel_connections_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `channel_connections` | `channel_connections_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `channel_connections` | `channel_connections_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `channel_room_mappings` | `channel_room_mappings_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(EXISTS ( SELECT 1    FROM channel_connections c   WHERE ((c.id = channel_room_mappings.connection_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` | `` |
| `channel_room_mappings` | `channel_room_mappings_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(EXISTS ( SELECT 1    FROM channel_connections c   WHERE ((c.id = channel_room_mappings.connection_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` | `` |
| `channel_room_mappings` | `channel_room_mappings_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(EXISTS ( SELECT 1    FROM channel_connections c   WHERE ((c.id = channel_room_mappings.connection_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` |
| `channel_room_mappings` | `channel_room_mappings_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(EXISTS ( SELECT 1    FROM channel_connections c   WHERE ((c.id = channel_room_mappings.connection_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` | `(EXISTS ( SELECT 1    FROM channel_connections c   WHERE ((c.id = channel_room_mappings.connection_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` |
| `channel_sync_events` | `channel_sync_events_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `fnb_print_jobs` | `fnb_print_jobs_insert` | PERMISSIVE | `{authenticated}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `fnb_print_jobs` | `fnb_print_jobs_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `fnb_print_jobs` | `fnb_print_jobs_update` | PERMISSIVE | `{authenticated}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `folio_charges` | `folio_charges_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `can_backoffice(property_id)` | `` |
| `folio_charges` | `folio_charges_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(can_backoffice(property_id) OR (property_role(property_id) = 'cashier'::property_member_role) OR (current_staff_role(property_id) = ANY (ARRAY['hotel_admin'::text, 'super_admin'::` |
| `folio_charges` | `folio_charges_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `folio_charges` | `folio_charges_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `goods_receipt_lines` | `goods_receipt_lines_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(EXISTS ( SELECT 1    FROM goods_receipts g   WHERE ((g.id = goods_receipt_lines.goods_receipt_id) AND (is_platform_owner() OR is_member_of_property(g.property_id)))))` | `` |
| `goods_receipts` | `goods_receipts_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `guest_loyalty_accounts` | `guest_loyalty_accounts_member` | PERMISSIVE | `{authenticated}` | ALL | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `guest_loyalty_transactions` | `guest_loyalty_transactions_member` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `guests` | `guests_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `can_backoffice(property_id)` | `` |
| `guests` | `guests_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `can_backoffice(property_id)` |
| `guests` | `guests_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `guests` | `guests_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `housekeeping_tasks` | `housekeeping_tasks_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `housekeeping_tasks` | `housekeeping_tasks_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `housekeeping_tasks` | `housekeeping_tasks_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `housekeeping_tasks` | `housekeeping_tasks_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_count_lines` | `inventory_count_lines_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(EXISTS ( SELECT 1    FROM inventory_counts c   WHERE ((c.id = inventory_count_lines.count_id) AND (is_platform_owner() OR is_member_of_property(c.property_id)))))` | `` |
| `inventory_counts` | `inventory_counts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_items` | `inventory_items_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_items` | `inventory_items_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `inventory_items` | `inventory_items_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_items` | `inventory_items_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_locations` | `inventory_locations_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_locations` | `inventory_locations_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_locations` | `inventory_locations_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `inventory_locations` | `inventory_locations_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `inventory_movements` | `inventory_movements_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `inventory_movements` | `inventory_movements_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_movements` | `inventory_movements_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_productions` | `inventory_productions_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `inventory_wastage` | `inventory_wastage_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `laundry_orders` | `laundry_orders_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `laundry_orders` | `laundry_orders_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `laundry_orders` | `laundry_orders_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `laundry_orders` | `laundry_orders_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `low_stock_alerts` | `low_stock_alerts_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `low_stock_alerts` | `low_stock_alerts_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `low_stock_alerts` | `low_stock_alerts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `low_stock_alerts` | `low_stock_alerts_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `maintenance_tickets` | `maintenance_tickets_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `maintenance_tickets` | `maintenance_tickets_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `maintenance_tickets` | `maintenance_tickets_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `maintenance_tickets` | `maintenance_tickets_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `night_audits` | `night_audits_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `payments` | `payments_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(can_backoffice(property_id) OR (property_role(property_id) = 'cashier'::property_member_role) OR (current_staff_role(property_id) = ANY (ARRAY['hotel_admin'::text, 'super_admin'::` |
| `payments` | `payments_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `payments` | `payments_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `pos_discounts` | `pos_discounts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_discounts` | `pos_discounts_write` | PERMISSIVE | `{public}` | ALL | 1 | `can_manage_phase2_catalogue(property_id)` | `can_manage_phase2_catalogue(property_id)` |
| `pos_kitchen_order_events` | `pos_kitchen_order_events_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_kitchen_orders` | `pos_kitchen_orders_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_kitchen_orders` | `pos_kitchen_orders_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_kitchen_orders` | `pos_kitchen_orders_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_menu_categories` | `pos_menu_categories_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `can_manage_pos_menu(property_id)` | `` |
| `pos_menu_categories` | `pos_menu_categories_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `can_manage_pos_menu(property_id)` |
| `pos_menu_categories` | `pos_menu_categories_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_menu_categories` | `pos_menu_categories_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_manage_pos_menu(property_id)` | `can_manage_pos_menu(property_id)` |
| `pos_menu_modifier_groups` | `pos_menu_modifier_groups_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_menu_modifier_groups` | `pos_menu_modifier_groups_write` | PERMISSIVE | `{public}` | ALL | 1 | `can_manage_phase2_catalogue(property_id)` | `can_manage_phase2_catalogue(property_id)` |
| `pos_modifier_groups` | `pos_modifier_groups_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_modifier_groups` | `pos_modifier_groups_write` | PERMISSIVE | `{public}` | ALL | 1 | `can_manage_phase2_catalogue(property_id)` | `can_manage_phase2_catalogue(property_id)` |
| `pos_modifier_options` | `pos_modifier_options_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_modifier_options` | `pos_modifier_options_write` | PERMISSIVE | `{public}` | ALL | 1 | `can_manage_phase2_catalogue(property_id)` | `can_manage_phase2_catalogue(property_id)` |
| `pos_order_audit` | `pos_order_audit_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `pos_order_audit` | `pos_order_audit_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_order_audit` | `pos_order_audit_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `pos_printers` | `pos_printers_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_printers` | `pos_printers_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `` |
| `pos_printers` | `pos_printers_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `pos_printers` | `pos_printers_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `pos_receipt_payments` | `pos receipt payments property access` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_receipts` | `pos_receipts_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(can_backoffice(property_id) OR (property_role(property_id) = ANY (ARRAY['cashier'::property_member_role, 'waiter'::property_member_role])) OR (current_staff_role(property_id) = AN` |
| `pos_receipts` | `pos_receipts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `pos_receipts` | `pos_receipts_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `pos_shift_payments` | `pos_shift_payments_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(EXISTS ( SELECT 1    FROM pos_shifts s   WHERE ((s.id = pos_shift_payments.shift_id) AND (is_platform_owner() OR is_member_of_property(s.property_id)))))` | `` |
| `pos_shift_payments` | `pos_shift_payments_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(EXISTS ( SELECT 1    FROM pos_shifts s   WHERE ((s.id = pos_shift_payments.shift_id) AND (is_platform_owner() OR (property_role(s.property_id) = ANY (ARRAY['owner'::property_membe` | `` |
| `pos_shift_payments` | `pos_shift_payments_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(EXISTS ( SELECT 1    FROM pos_shifts s   WHERE ((s.id = pos_shift_payments.shift_id) AND (is_platform_owner() OR (property_role(s.property_id) = ANY (ARRAY['owner'::property_membe` |
| `pos_shift_payments` | `pos_shift_payments_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(EXISTS ( SELECT 1    FROM pos_shifts s   WHERE ((s.id = pos_shift_payments.shift_id) AND (is_platform_owner() OR (property_role(s.property_id) = ANY (ARRAY['owner'::property_membe` | `(EXISTS ( SELECT 1    FROM pos_shifts s   WHERE ((s.id = pos_shift_payments.shift_id) AND (is_platform_owner() OR (property_role(s.property_id) = ANY (ARRAY['owner'::property_membe` |
| `pos_shifts` | `pos_shifts_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_shifts` | `pos_shifts_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_shifts` | `pos_shifts_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_table_sessions` | `pos_table_sessions_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `` |
| `pos_table_sessions` | `pos_table_sessions_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_table_sessions` | `pos_table_sessions_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_table_sessions` | `pos_table_sessions_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_void_items` | `pos_void_items_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `pos_void_items` | `pos_void_items_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `pos_void_items` | `pos_void_items_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` | `` |
| `pos_void_items` | `pos_void_items_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role, 'cashier'::property_` |
| `print_logs` | `print_logs_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `print_logs` | `print_logs_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `printer_assignments` | `printer_assignments_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `printer_assignments` | `printer_assignments_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `` |
| `printer_assignments` | `printer_assignments_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `printer_assignments` | `printer_assignments_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `product_stock_locations` | `product_stock_locations_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `product_stock_locations` | `product_stock_locations_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `product_stock_locations` | `product_stock_locations_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `product_stock_locations` | `product_stock_locations_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `products` | `products_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(can_store_write(property_id, category) OR (pos_enabled AND can_manage_pos_menu(property_id)))` | `` |
| `products` | `products_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(can_store_write(property_id, category) OR (pos_enabled AND can_manage_pos_menu(property_id)))` |
| `products` | `products_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `products` | `products_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(can_store_write(property_id, category) OR (pos_enabled AND can_manage_pos_menu(property_id)))` | `(can_store_write(property_id, category) OR (pos_enabled AND can_manage_pos_menu(property_id)))` |
| `profiles` | `profiles_select_own` | PERMISSIVE | `{public}` | SELECT | 1 | `(id = ( SELECT auth.uid() AS uid))` | `` |
| `profiles` | `profiles_update_own` | PERMISSIVE | `{public}` | UPDATE | 1 | `(id = ( SELECT auth.uid() AS uid))` | `((id = ( SELECT auth.uid() AS uid)) AND (platform_role = ( SELECT profiles_1.platform_role    FROM profiles profiles_1   WHERE (profiles_1.id = ( SELECT auth.uid() AS uid)))))` |
| `properties` | `properties_delete_owner_only` | PERMISSIVE | `{public}` | DELETE | 1 | `is_platform_owner()` | `` |
| `properties` | `properties_insert_self_service` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::property_status) AND (package = 'none'::property_package))` |
| `properties` | `properties_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(id))` | `` |
| `properties` | `properties_update_owner_admin` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])))` | `(is_platform_owner() OR ((property_role(id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])) AND (status = ( SELECT properties_1.status    FROM properti` |
| `property_business_dates` | `property_business_dates_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `property_dining_options` | `property_dining_options_member` | PERMISSIVE | `{authenticated}` | ALL | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `property_payment_types` | `property_payment_types_member` | PERMISSIVE | `{authenticated}` | ALL | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `property_printers` | `property_printers_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `property_printers` | `property_printers_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `` |
| `property_printers` | `property_printers_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `property_printers` | `property_printers_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `property_settings` | `property_settings_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `property_settings` | `property_settings_write_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `` |
| `property_settings` | `property_settings_write_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `property_settings` | `property_settings_write_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role, 'manager'::property_member_role])) OR (current_staff_` |
| `property_subscriptions` | `property_subscriptions_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `property_taxes` | `property_taxes_member` | PERMISSIVE | `{authenticated}` | ALL | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `property_users` | `property_users_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])))` | `` |
| `property_users` | `property_users_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (ro` |
| `property_users` | `property_users_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR (user_id = ( SELECT auth.uid() AS uid)) OR is_member_of_property(property_id))` | `` |
| `property_users` | `property_users_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR (property_role(property_id) = ANY (ARRAY['owner'::property_member_role, 'admin'::property_member_role])))` | `` |
| `purchase_orders` | `purchase_orders_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `purchase_orders` | `purchase_orders_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `purchase_orders` | `purchase_orders_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `purchase_orders` | `purchase_orders_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `rate_plans` | `rate_plans_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `rate_plans` | `rate_plans_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `rate_plans` | `rate_plans_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `rate_plans` | `rate_plans_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `recipe_ingredients` | `recipe_ingredients_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(EXISTS ( SELECT 1    FROM recipes r   WHERE ((r.id = recipe_ingredients.recipe_id) AND (is_platform_owner() OR is_member_of_property(r.property_id)))))` | `` |
| `recipe_ingredients` | `recipe_ingredients_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(EXISTS ( SELECT 1    FROM recipes r   WHERE ((r.id = recipe_ingredients.recipe_id) AND (is_platform_owner() OR is_member_of_property(r.property_id)))))` |
| `recipe_ingredients` | `recipe_ingredients_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(EXISTS ( SELECT 1    FROM recipes r   WHERE ((r.id = recipe_ingredients.recipe_id) AND (is_platform_owner() OR is_member_of_property(r.property_id)))))` | `` |
| `recipe_ingredients` | `recipe_ingredients_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(EXISTS ( SELECT 1    FROM recipes r   WHERE ((r.id = recipe_ingredients.recipe_id) AND (is_platform_owner() OR is_member_of_property(r.property_id)))))` | `(EXISTS ( SELECT 1    FROM recipes r   WHERE ((r.id = recipe_ingredients.recipe_id) AND (is_platform_owner() OR is_member_of_property(r.property_id)))))` |
| `recipes` | `recipes_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `recipes` | `recipes_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `recipes` | `recipes_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `recipes` | `recipes_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `reservations` | `reservations_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `can_backoffice(property_id)` | `` |
| `reservations` | `reservations_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `can_backoffice(property_id)` |
| `reservations` | `reservations_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `reservations` | `reservations_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `room_closures` | `room_closures_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `room_closures` | `room_closures_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `room_closures` | `room_closures_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `room_closures` | `room_closures_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `room_types` | `room_types_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `room_types` | `room_types_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `room_types` | `room_types_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `room_types` | `room_types_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `rooms` | `rooms_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `can_backoffice(property_id)` | `` |
| `rooms` | `rooms_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `can_backoffice(property_id)` |
| `rooms` | `rooms_select` | PERMISSIVE | `{public}` | SELECT | 1 | `can_backoffice(property_id)` | `` |
| `rooms` | `rooms_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `can_backoffice(property_id)` | `can_backoffice(property_id)` |
| `staff` | `staff_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `is_hotel_admin(property_id)` | `` |
| `staff` | `staff_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_hotel_admin(property_id) AND (created_by = ( SELECT auth.uid() AS uid)))` |
| `staff` | `staff_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `staff` | `staff_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `is_hotel_admin(property_id)` | `is_hotel_admin(property_id)` |
| `staff_logs` | `staff_logs_select` | PERMISSIVE | `{public}` | SELECT | 1 | `is_hotel_admin(property_id)` | `` |
| `staff_sessions` | `staff_sessions_delete_own` | PERMISSIVE | `{public}` | DELETE | 1 | `((( SELECT auth.uid() AS uid) = user_id) OR is_platform_owner())` | `` |
| `staff_sessions` | `staff_sessions_insert_own` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `((( SELECT auth.uid() AS uid) = user_id) OR is_platform_owner())` |
| `staff_sessions` | `staff_sessions_select_own` | PERMISSIVE | `{public}` | SELECT | 1 | `((( SELECT auth.uid() AS uid) = user_id) OR is_platform_owner())` | `` |
| `staff_sessions` | `staff_sessions_update_own` | PERMISSIVE | `{public}` | UPDATE | 1 | `((( SELECT auth.uid() AS uid) = user_id) OR is_platform_owner())` | `((( SELECT auth.uid() AS uid) = user_id) OR is_platform_owner())` |
| `staff_timecards` | `staff_timecards_insert` | PERMISSIVE | `{authenticated}` | INSERT | 1 | `` | `is_member_of_property(property_id)` |
| `staff_timecards` | `staff_timecards_select` | PERMISSIVE | `{authenticated}` | SELECT | 1 | `is_member_of_property(property_id)` | `` |
| `staff_timecards` | `staff_timecards_update` | PERMISSIVE | `{authenticated}` | UPDATE | 1 | `is_member_of_property(property_id)` | `is_member_of_property(property_id)` |
| `stock_adjustments` | `stock_adjustments_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_movements` | `stock_movements_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `stock_movements` | `stock_movements_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_movements` | `stock_movements_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `stock_transfers` | `stock_transfers_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_transfers` | `stock_transfers_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `stock_transfers` | `stock_transfers_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_transfers` | `stock_transfers_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `stock_usage` | `stock_usage_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_usage` | `stock_usage_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `stock_usage` | `stock_usage_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `stock_usage` | `stock_usage_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `subscription_events` | `subscription_events_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `suppliers` | `suppliers_delete` | PERMISSIVE | `{public}` | DELETE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `suppliers` | `suppliers_insert` | PERMISSIVE | `{public}` | INSERT | 1 | `` | `(is_platform_owner() OR is_member_of_property(property_id))` |
| `suppliers` | `suppliers_select` | PERMISSIVE | `{public}` | SELECT | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `` |
| `suppliers` | `suppliers_update` | PERMISSIVE | `{public}` | UPDATE | 1 | `(is_platform_owner() OR is_member_of_property(property_id))` | `(is_platform_owner() OR is_member_of_property(property_id))` |

## Role-simulation evidence

| Test | Result |
|---|---|
| User A → own property membership | `true` |
| User A → User B property membership | `false` |
| User A direct RLS select | own property: 1 row; other property: 0 rows; own reservations: 6; other reservations: 0 |
| User A calls `create_pending_property_for_user` with User B ID | returned User B's existing property ID — **negative test failed**; existing-owner branch was read-only |
| User B calls `fn_list_pos_menu` for User A property | membership false; RPC returned 1 row — **negative test failed** |
| `properties_update_owner_admin` scalar check expression | SQLSTATE 21000 on multiple rows |
| Anonymous direct table read | permission error on `is_platform_owner` helper; denied but surfaced as error |

## Policy-review rules and unresolved checks

1. For every policy, confirm table RLS is enabled, role list, command, USING, WITH CHECK, and whether another permissive policy ORs around it.
2. Prioritize `properties`, `property_users`, `profiles`, `staff`, `staff_sessions`, `reservations`, `payments`, `folio_charges`, `pos_receipts`, `pos_receipt_payments`, `pos_shifts`, `cashier_refunds`, `cashier_adjustments`, `products`, `inventory_movements`, `stock_transfers`, `stock_usage`, and `audit_logs`.
3. Verify role/package/tenant boundaries on every exposed SECURITY DEFINER function. A guard marker is not sufficient: inspect all branches, delegated calls, dynamic SQL, search_path, and table ownership.
4. Run write-denial and allowed-write tests only on a disposable Supabase branch with deterministic fixtures; no production mutation tests were attempted.
5. Do not revoke the 96 authenticated-callable SECURITY DEFINER functions wholesale. Review each caller and intended contract, then tighten grants or function bodies in reviewed migration batches.