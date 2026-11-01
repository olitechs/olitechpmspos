# Production schema reconciliation — 2026-11-01

## Scope and safety

This document records a read-only inspection of the connected production Supabase project on 2026-11-01. No production DDL, DML, migration application, migration-ledger edits, or data changes were performed.

Do not apply repository migrations `0057_printer_groups.sql`, `0060_pos_phase4b_reporting.sql`, or `0061_printer_recode_settings.sql` blindly to this project. The production migration ledger uses timestamped migration versions and contains a different printer architecture. In particular, `0061` creates a separate workspace/store model and assumes a legacy `printer_groups` table; this does not match the inspected production schema.

## Observed production migration history

The connected production ledger contains timestamped migrations through:

- `20261013194249_pos_device_registry`
- `20261013194854_restore_property_scoped_stores`

It also contains migrations for property-scoped physical printers, POS printer upsert transport, Phase 5 store/POS source of truth, and removal of a duplicate printer index. The ledger does not contain the repository's numbered migration filenames as versions.

## Observed production printer schema

The following relations exist:

- `property_printers`: property-scoped physical printer configuration. Columns include `property_id`, `name`, `type`, `connection_type`, `ip_address`, `port`, `paper_width`, `is_online`, `is_default`, `last_status`, agent/device fields and timestamps.
- `printer_assignments`: property-scoped routing assignments. `assignment_type` is constrained to `food_orders`, `drinks_orders`, `void_food_orders`, `void_drinks_orders`, `unsettled_bills`, `final_receipts`, `reports`, `shift_reports`, or `refund_slips`.
- `pos_printers`: property-scoped client printer registry with a unique `(property_id, client_key)`, `connection_type`, `host`, `port`, `agent_url`, JSON `purposes`, `center`, and `baud_rate`.
- `print_logs`: property-scoped print history.
- `fnb_print_jobs`: property-scoped queue/recovery records, linked to `property_printers`.

The above relations have RLS enabled. Their inspected policies scope access through `is_member_of_property(property_id)` or property owner/admin/manager/staff-role checks. Do not weaken or replace these policies to make a client query work.

The following relations expected by the current store/workspace printer implementation are absent:

- `printer_groups`
- `printer_group_categories`
- `printer_group_printers`
- `printers`
- `print_agents`
- `stores` is present, but it is the property-scoped store model and should not be assumed compatible with the workspace/store model introduced by repository migration `0061`.

Production RPCs observed for POS printer registry:

- `fn_list_pos_printers(uuid)`
- `fn_upsert_pos_printer(uuid,text,text,text,text,text,text,jsonb,text,integer)`
- `fn_delete_pos_printer(uuid,text)`

The app should use the production property-scoped printer contracts, or a deliberately reviewed additive migration that extends those contracts. It must not silently create a parallel workspace/store printer subsystem.

## Daily POS summary

Production exposes:

`public.fn_daily_pos_summary(p_property_id uuid, p_business_date date default ...)`

The signature matches the current client call in `pmsService.getDailyPosSummary`. The inspected live body returns:

- `business_date`
- `total_revenue`
- `transactions`
- `average_check`
- `payment_breakdown`
- `top_items`
- `hourly_revenue`

It does not return the additional `discount_total`, `discounted_subtotal`, `modifier_revenue`, or `top_modifiers` fields introduced in repository migration `0060`.

The live body reads `pos_receipts` and checks `is_platform_owner()` or `is_member_of_property(p_property_id)`. The function signature itself matches the browser RPC argument names, so the observed HTTP 400 cannot be attributed to an RPC argument-name/signature mismatch. The exact request-time PostgreSQL exception was not present in the available log window; do not infer it from the status code alone.

The live `pos_receipts` schema includes `discount_amount`, `subtotal`, `total`, `items`, `status`, and `property_id`. A future reporting migration should be based on the live function body and actual JSON item/modifier representation, preserve tenant authorization, preserve existing return keys, and be tested against representative receipts before deployment.

## Required implementation sequence

1. Align printer UI/service code with the live property-scoped printer registry and assignment contracts. Avoid querying missing `printer_groups`, `print_agents`, or workspace/store printer tables.
2. Keep failed F&B print-job recovery on `fnb_print_jobs`; preserve property filters and existing RLS.
3. Reproduce the dashboard RPC failure with an authenticated property user and capture the complete PostgREST error body/request ID. The signature is already confirmed to match.
4. Prepare a separate additive reporting migration only after confirming the exact error and inspecting representative `pos_receipts.items` modifier JSON. Keep the `uuid,date` function signature and tenant authorization check.
5. Apply migrations only after a database backup and an explicit deployment approval. Do not edit production migration history manually.

## Verification still required

- Authenticated test of `fn_daily_pos_summary` for a property member and a user without property access.
- Test printer list/upsert/delete using the current property-scoped RPCs.
- Test category/production-center routing and failed print-job retry using existing production relations.
- Validate all new code against the live constraints and RLS policies.
- Run repository lint, tests, and production build; exercise the printer page and dashboard with a real property session.

