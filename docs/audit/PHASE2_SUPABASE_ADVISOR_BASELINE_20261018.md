# Phase 2 — Supabase advisor baseline (2026-10-18)

Read-only advisor snapshot from Supabase MCP. No schema or Auth settings were changed.

## Production project `mszogmazldxjsiytrlxr`

### Security
- 96 authenticated-executable SECURITY DEFINER functions flagged (WARN). This is a broad existing baseline; each function requires intent/authorization review rather than blanket revocation.
- 1 anon-executable SECURITY DEFINER function: `fn_public_booking_engine_config(uuid)` (possibly intentional public booking config; review separately).
- `staff_pin_attempts` has RLS enabled with no policies (INFO; likely service-only but ACL/intent must be verified).
- Leaked-password protection is disabled (WARN; Auth setting, not changed by this inventory PR).

### Performance
- 45 unindexed foreign keys (INFO).
- 103 unused indexes (INFO; do not drop without workload evidence).
- 20 multiple-permissive-policy findings (WARN).

## Existing disposable project `rmkcwminrizloosvegzp`

This project is **not production-equivalent** and must not be treated as a valid runtime test target yet.

- It is named `olitech-phase-0-disposable-test` and has PostgreSQL 17.11, while production is PostgreSQL 17.6.
- The inventory function signature probe found only `fn_complete_stock_transfer`, `fn_consume_recipe_stock`, `fn_receive_purchase_order`, and an older `fn_record_pos_sale` signature. It is missing production signatures for `fn_apply_stock_movement`, `fn_post_stock_adjustment`, `fn_approve_inventory_count`, `fn_post_wastage`, `fn_post_production`, and `fn_inventory_valuation`.
- Security advisor findings include RLS disabled on `public.pos_shifts` (ERROR), a SECURITY DEFINER view `public.my_properties` (ERROR), 56 anon-executable and 82 authenticated-executable SECURITY DEFINER functions (WARN), plus mutable search paths and missing RLS policies. These are not all inventory-specific but make it unsafe to use as a faithful clone without a separate reconciliation/reset plan.
- Performance baseline: 54 unindexed foreign keys, 41 unused indexes, 20 multiple-permissive-policy findings and 8 auth-initplan findings.

## Decision

Do not apply the inventory correction to either database as a shortcut. The production advisor output is the baseline; the disposable project needs controlled schema parity first. A forward-only candidate may be drafted for review, but it is not eligible to apply until its preflight assertions, role/tenant runtime tests, stock-location invariants and app compatibility checks pass against a production-equivalent fixture.
