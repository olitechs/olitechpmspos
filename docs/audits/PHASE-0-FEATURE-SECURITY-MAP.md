# Phase 0 — Feature, RPC, and RLS Security Map

**Repository baseline:** `8fc2dba43204efb8e2a6048a5dfbd78b4c366d2a`  
**Live Supabase project:** `mszogmazldxjsiytrlxr`  
**Review date:** 2026-10-11  
**Scope:** static source/SQL inspection plus read-only role simulation against the live database. No runtime, DDL, grants, RLS, migration, or data changes were made.

## Executive findings

| ID | Severity | Finding | Evidence | Gate |
|---|---|---|---|---|
| SEC-001 | **High** | `create_pending_property_for_user(p_user_id, ...)` is `SECURITY DEFINER`, executable by `authenticated`, accepts a caller-supplied user ID, and does not verify that it equals `auth.uid()`. If that user already owns a property, the function returns the existing `properties` row. | Read-only test simulated User A and called the function with User B's ID; it returned User B's property ID. The call followed the existing-owner branch and did not create rows. | Must be fixed and regression-tested before security sign-off. |
| SEC-002 | **High** | `fn_list_pos_menu(p_property_id)` is `SECURITY DEFINER` and does not itself check property membership or menu permission. | Read-only test simulated a user who is not a member of the target property; `is_member_of_property=false` while the RPC returned 1 menu row. | Must enforce tenant/role scope server-side and add cross-tenant negative test. |
| SEC-003 | **High** | `fn_current_pos_shift(p_property_id)` is `SECURITY DEFINER` and returns the open shift for the supplied property without a visible membership/role check in the function body. | Static function-body review. No open shift rows existed for the current business date, so a live cross-tenant return could not be demonstrated. | Treat as exposed until function authorization is fixed or explicitly proven by an approved wrapper. |
| SEC-004 | **High / functional** | `properties_update_owner_admin` has a WITH CHECK scalar subquery using `properties_1.id = properties_1.id` rather than correlating to the row being updated. | Read-only scalar-subquery probe failed with PostgreSQL `21000: more than one row returned by a subquery used as an expression`. | Correct policy expression in a new migration and test update/denial cases. |
| SEC-005 | **Medium–High** | `fn_public_booking_engine_config` is public-callable and `SECURITY DEFINER`; it returns property name, currency, terms, cancellation policy, and payment instructions, but the function body does not check property status or `booking_engine_settings.enabled`. | Function body and grants inspected. Current test properties had no booking settings, so exposure of populated disabled settings was not tested. | Decide intended public fields and require active + enabled configuration before returning payment instructions. |
| SEC-006 | **Medium** | Anonymous direct table reads can fail with `permission denied for function is_platform_owner` because RLS expressions call a helper not executable by `anon`. | Simulated `anon` read returned permission error instead of rows. | Verify public-facing UX separately; do not grant helper execution broadly without security review. |

These are not speculative advisor-only warnings: SEC-001, SEC-002, and SEC-004 have concrete database evidence. SEC-003 and SEC-005 are static high-priority risks requiring correction or a documented authorization proof.

## Read-only authorization tests performed

All tests used `BEGIN` / `ROLLBACK` and did not persist changes.

| Test | Simulated principal / operation | Result | Interpretation |
|---|---|---|---|
| AUTH-T01 | User A checks membership in own property | `true` | Positive membership check works. |
| AUTH-T02 | User A checks membership in User B's property | `false` | Negative membership check works. |
| AUTH-T03 | User A selects properties/reservations through RLS | Own property: 1 property row and 6 reservation rows; other property: 0 rows | Table RLS constrained direct reads for this test identity. |
| AUTH-T04 | User A calls `create_pending_property_for_user` with User B's ID, where B already owns a property | Returned B's property ID | **Negative authorization test failed**: cross-user property data is returned. No insert branch was reached. |
| AUTH-T05 | User B calls `fn_list_pos_menu` with User A's property ID | Membership: `false`; RPC rows: 1 | **Negative authorization test failed**: cross-property menu data is returned. |
| AUTH-T06 | Nonmember calls `fn_current_pos_shift` for a property with no current open shift | No suitable row available | Inconclusive runtime test; static missing-guard concern remains. |
| AUTH-T07 | Anonymous direct select against RLS-protected tables | Permission error on `is_platform_owner` | Denied, but API behavior is an error rather than an empty result. |
| AUTH-T08 | Scalar expression matching `properties_update_owner_admin` check | SQLSTATE `21000` | Confirms the uncorrelated scalar subquery errors when multiple properties exist. |
| AUTH-T09 | Anonymous call to public booking-config RPC for an active property with no settings row | Function returned a JSON object | Confirms public callable path; does **not** prove populated payment instructions are exposed because no settings row exists. |

### Required authorization regression cases

Use two dedicated seeded test tenants, two authenticated users, and an anonymous role in a disposable Supabase branch. Do not use production data for mutation tests.

1. User A can read their own property and records.
2. User A cannot read User B's property, reservations, guest folios, POS menu, shifts, reports, inventory, or staff.
3. User A cannot create, update, or retrieve a property for User B through any RPC.
4. A nonmember cannot retrieve menu/shift/report RPC output for another tenant, even when given a valid property UUID.
5. A front-desk role cannot call cashier/manager-only RPCs; a permitted manager can.
6. A disabled booking engine returns no public payment instructions; an enabled active booking engine returns only fields intended for public display.
7. Property owner/admin can update allowed fields; nonmembers cannot; package/status fields remain platform-owner controlled.
8. Unauthorized attempts fail with a stable permission error and no persisted writes.

## Navigation → page → service → RPC/table → RLS map

This map links registered routes to source components and the principal data/service boundaries found in the repository. A route's existence is not evidence that all actions on the page work. RPC and table inventories below are source-level call references; final authorization still depends on the live function body, execute grants, RLS policy, and property scoping.

| Workspace / route | Page or component | Service boundary | Main RPC / table family | RLS / authorization family | Status |
|---|---|---|---|---|---|
| `/backoffice` | `POSApp(initialModule="dashboard")` | `pmsService`, `reportingService`, `backOfficeService` | Dashboard activity, business date, subscription and management reporting RPCs | `properties`, `property_users`, `audit_logs`, POS/financial table policies | Route exists; needs route/browser smoke test. |
| `/backoffice/items/list` | `Store(initialTab="products")` | `inventoryService` | `fn_bulk_upsert_store_products`, product/menu RPCs; `products`, `suppliers` | `products` policies; `can_store_write` / `can_manage_pos_menu` | Cross-tenant menu RPC defect found in `fn_list_pos_menu`. |
| `/backoffice/items/categories` | `CategoriesPage` | Settings/category service and direct table access | POS menu categories | `pos_menu_categories` policies | Route registered; workflow test pending. |
| `/backoffice/items/modifiers`, `/backoffice/items/discounts` | `Phase2CataloguePage` | `phase2CatalogueService` | `pos_modifier_groups`, `pos_modifier_options`, `pos_discounts` | Modifier/discount policies and property guard trigger | Validate cross-property foreign-key relationships and role gating. |
| `/backoffice/reports/sales` | `Reports` | `reportingService` | `fn_management_report`, `fn_management_sales_detail` | Function authorization + financial-table policies | RPCs are invoker security and contain membership checks; positive/negative report tests pending. |
| `/backoffice/reports/inventory` | `InventoryReports` | `inventoryService` | Inventory valuation/reconciliation RPCs; products and movement ledgers | Inventory table policies and inventory RPC guards | Route exists; calculations and role tests pending. |
| `/backoffice/reports/employees` | `TimecardsPage` | `backOfficeService` | `fn_clock_staff`, `staff_timecards` | Membership check in RPC; staff/timecard policies | Route label says report but renders timecards page; confirm intended UX. |
| `/backoffice/inventory/purchase-orders` | `Purchasing` | `inventoryService` / `pmsService` | `fn_create_purchase_order`, `fn_receive_purchase_order`, `fn_create_and_receive_purchase`; `purchase_orders`, `goods_receipts` | Purchase/GRN policies and property-membership checks | Requires positive/negative tenant and stock-ledger tests. |
| `/backoffice/inventory/stock-adjustments`, `counts`, `productions`, `history`, `valuation` | `InventoryOperations` | `inventoryService` | `fn_post_stock_adjustment`, `fn_create_inventory_count`, `fn_approve_inventory_count`, `fn_post_wastage`, `fn_post_production`, `fn_record_stock_usage` | `products`, inventory ledger/count/production/wastage policies; role checks | Five routes share one component without explicit section prop in route declaration; route context and action separation need testing. |
| `/backoffice/employees/list` | `EmployeeListPage` | `authService` / staff service | `create_staff_member`, `reset_staff_pin`, `verify_staff_pin`; `staff`, `staff_sessions`, `staff_logs` | `is_hotel_admin`, membership, module entitlements | Route exists; negative role tests pending. |
| `/backoffice/employees/access-rights` | `Roles` | Role/entitlement service | Role declarations and property membership | `property_users`, `staff`, server-side entitlement helpers | Sidebar currently links Access rights to `/backoffice/employees/list`, not this route. |
| `/backoffice/employees/timecards`, `hours` | `TimecardsPage` | `backOfficeService` | `fn_clock_staff`, `staff_timecards` | Membership + staff role | Two routes share component; verify unique heading/filter behavior. |
| `/backoffice/customers` | `GuestList` | `pmsService` | `guests`, guest summary/loyalty RPCs | Guest policies scoped by property | Needs tenant and mutation tests. |
| `/backoffice/integrations` | `BookingEngine` | `pmsService` | `fn_public_booking_engine_config`, `fn_channel_connection_upsert`; `channel_connections`, `booking_engine_settings` | Public config RPC plus member-only channel writes | SEC-005; public function needs explicit enabled/status behavior. |
| `/backoffice/settings/:slug` | `BackOfficeSettingsPage` | `settingsService`, `printService`, `phase2CatalogueService`, platform settings | Payment types, taxes, dining options, receipt settings, printer configuration, subscriptions | Settings/printing policies; property admin/manager guards | Unknown slug falls back to generic `ModuleStatusPage`; inventory every reachable slug. |
| `/frontoffice` | `POSApp(initialModule="dashboard")` | `pmsService` | Dashboard/activity/business date; reservation/room data | Property membership and front-office roles | Shell count/direct-route test pending. |
| `/frontoffice/room-planner`, `/frontoffice/rooms` | `POSApp(initialModule="rooms")` | `pmsService` | Reservation bundle/planner CRUD, availability, room closures; `rooms`, `reservations` | Room/reservation policies; `fn_update_planner_reservation` and related RPC checks | Dedicated shell exists; direct URL/history/one-shell tests pending. |
| `/frontoffice/reservations` | `POSApp(initialModule="reservations")` | `pmsService` | `fn_create_reservation_bundle`, `fn_check_in_reservation`, `fn_remove_reservation`, `fn_record_front_desk_payment` | `reservations`, `payments`, `guests`, folio policies | Financial/idempotency tests pending. |
| `/frontoffice/folio` | `POSApp(initialModule="folio")` | `pmsService` | `fn_add_folio_charge`, `charge_restaurant_to_room`, `fn_check_out_room`; `folio_charges`, `folio_totals`, `payments` | Financial policies and membership/role checks | Critical money invariants require disposable-branch tests. |
| `/frontoffice/housekeeping` | `POSApp(initialModule="housekeeping")` | `pmsService` | `fn_housekeeping_list_tasks`, `fn_create_housekeeping_task`, `fn_update_housekeeping_task`, `fn_inspect_housekeeping_task` | `housekeeping_tasks` policies + membership | Test assigned-worker boundaries and task transitions. |
| `/frontoffice/night-audit` | `POSApp(initialModule="night-audit")` | `pmsService` | `fn_night_audit_precheck`, `fn_run_night_audit`, `fn_night_audit_history`, daily metrics | `night_audits`, POS/folio ledgers; owner/admin/cashier checks | Test repeat-run idempotency and unauthorized close. |
| `/stores`, `/stores/settings` | `StoresPage` | `inventoryService` | Products, suppliers, inventory locations, stock movements, imports | Inventory/property-scoped RLS | Both routes use the same component/default props; verify route-specific view. |
| `/stores/printers`, `/stores/kds` | `KitchenPrintersPage`, `KitchenDisplay` | `posService`, `printService` | Printer configuration, KDS orders, print jobs and logs | Printer/KDS policies; manager/cashier RPC guards | Test printer property integrity, re-fire and void/refund print recovery. |
| `/stores/pos-devices` | `ModuleStatusPage` | None yet | No operational device workflow | Not applicable | Explicit Phase 6 placeholder; must not be represented as completed. |
| `/admin/*` | Admin pages/layout | `platformService`, `authService` | `admin_list_properties`, `admin_property_users`, `platform_set_property_package/status`, audit/subscription RPCs | `is_platform_owner` and platform-owner policies | Authenticated execute grants are broad at the SQL role level; each function must retain internal owner guard. |

## Source service → RPC and table inventory

| Service | RPCs observed in source | Direct tables observed in source |
|---|---|---|
| `authService.js` | `ensure_my_pending_property`, `fn_get_subscription`, `clear_active_staff_session`, `create_staff_member`, `reset_staff_pin`, `touch_active_staff_session`, `verify_staff_pin` | `profiles`, `property_users`, `staff`, `staff_logs` |
| `backOfficeService.js` | `fn_clock_staff`, `fn_adjust_guest_loyalty_points` | `property_payment_types`, `property_taxes`, `property_dining_options`, `pos_table_sessions`, guest loyalty tables, `staff_timecards` |
| `inventoryService.js` | `fn_list_pos_menu`, `fn_upsert_pos_menu_item`, `fn_bulk_upsert_pos_menu`, `fn_inventory_reconciliation`, `fn_create_purchase_order`, `fn_receive_purchase_order`, `fn_inventory_valuation`, `fn_inventory_valuation_summary`, `fn_post_stock_adjustment`, `fn_create_inventory_count`, `fn_approve_inventory_count`, `fn_post_wastage`, `fn_post_production`, `fn_record_stock_usage`, `fn_create_and_receive_purchase`, `fn_adjust_product_stock`, `fn_bulk_upsert_store_products` | `products`, `pos_menu_categories`, `recipes`, `goods_receipts`, `purchase_orders`, inventory history/expiry/supplier/stock tables |
| `pmsService.js` | Reservation/planner, check-in/out, folio, housekeeping, maintenance, booking engine, subscription, night-audit, POS sale, cashier shift/adjustment RPCs (see route table above) | `rooms`, `room_types`, `rate_plans`, `reservations`, `guests`, folio, POS receipt, cashier and operations tables |
| `posService.js` | `fn_list_pos_printers`, `fn_upsert_pos_printer`, `fn_delete_pos_printer`, `fn_list_active_pos_table_sessions`, `fn_touch_pos_table_session`, `fn_move_or_merge_pos_table`, KDS order RPCs, `fn_pos_shift_reconciliation` | `pos_table_sessions` |
| `printService.js` | `fn_update_fnb_print_job` | `property_printers`, `printer_assignments`, `fnb_print_jobs`, `print_logs`, `pos_void_items`, `pos_order_audit`, `property_settings` |
| `platformService.js` | Platform property/member/status/package/subscription and audit RPCs | `properties`, `audit_logs` |
| `reportingService.js` | `fn_management_report`, `fn_management_sales_detail` | Reads underlying financial/operations tables through RPCs |
| `shiftService.js` | `fn_current_pos_shift`, `fn_open_pos_shift`, `fn_close_pos_shift` | `pos_shifts`, `pos_receipts` |

## Live schema and policy snapshot

- Live migration ledger: 34 versions, from `20261003114141` through `20261008145428`.
- Public tables inspected: all base tables in `public` had RLS enabled at the time of this query; no public base table without RLS was returned.
- Public policy inventory: 209 policies. The advisor reported 20 multiple-permissive-policy warnings; overlapping permissive policies combine with OR semantics, so each affected table/command pair must be reviewed together.
- Public functions inspected: 134; 100 are `SECURITY DEFINER`. The advisor reports 96 authenticated-callable definer functions and one anonymous-callable definer function. This is not by itself proof of a vulnerability; internal guard and data scope are the deciding controls.
- The anonymous-executable `SECURITY DEFINER` function is `fn_public_booking_engine_config(uuid)`.
- Live Edge Function: `print-proxy`, version 4, `verify_jwt=true`.

## Next security actions

1. Add authorization checks to SEC-001 and SEC-002; confirm SEC-003 and SEC-005 against product requirements.
2. Correct the uncorrelated property-update policy through a forward-only migration.
3. Generate role × package × tenant tests on a disposable Supabase branch. Include both positive and negative tests for all write RPC families.
4. For each of the 100 definer functions, record direct guard, delegated guard, trigger-only status, exposed execute roles, and affected tables. A guard token's presence is only a triage hint, not proof.
5. Review each of the 209 policies by table and command; investigate all 20 overlapping permissive-policy findings and confirm no broad OR path bypasses role or tenant boundaries.
6. Never modify the live database during this audit; implement fixes in branch migrations and deploy only after review and tests.
