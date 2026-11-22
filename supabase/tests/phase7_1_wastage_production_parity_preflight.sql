-- Read-only preflight for the Phase 7.1 wastage approval migration.
-- Safe to run against production: this file performs SELECTs only.
-- Expected state after applying 20261120130000_phase7_1_wastage_approval_workflow.sql.
-- A failed check means rollout is incomplete; it does not authorize automatic repair.

WITH expected_functions AS (
  SELECT
    'public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date)'::text AS signature,
    to_regprocedure('public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date)') AS function_oid,
    'authenticated must be able to submit a request'::text AS expectation
  UNION ALL
  SELECT
    'public.fn_decide_inventory_wastage(uuid,text,text)',
    to_regprocedure('public.fn_decide_inventory_wastage(uuid,text,text)'),
    'authenticated must be able to decide a request'
),
checks AS (
  SELECT
    'migration_record'::text AS check_name,
    EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261120130000'
    ) AS passed,
    '20261120130000_phase7_1_wastage_approval_workflow'::text AS observed,
    'migration version 20261120130000 recorded'::text AS expected

  UNION ALL
  SELECT 'submit_rpc',
    to_regprocedure('public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date)') IS NOT NULL,
    COALESCE(to_regprocedure('public.fn_submit_inventory_wastage(uuid,uuid,numeric,text,text,uuid,date)')::text, 'missing'),
    'submission RPC exists'

  UNION ALL
  SELECT 'decision_rpc',
    to_regprocedure('public.fn_decide_inventory_wastage(uuid,text,text)') IS NOT NULL,
    COALESCE(to_regprocedure('public.fn_decide_inventory_wastage(uuid,text,text)')::text, 'missing'),
    'decision RPC exists'

  UNION ALL
  SELECT 'authenticated_rpc_grants',
    COALESCE((
      SELECT bool_and(has_function_privilege('authenticated', function_oid, 'EXECUTE'))
      FROM expected_functions
      WHERE function_oid IS NOT NULL
    ), false)
    AND (SELECT count(*) = 2 FROM expected_functions WHERE function_oid IS NOT NULL),
    'submission and decision functions must both exist and be executable',
    'authenticated EXECUTE on both RPCs'

  UNION ALL
  SELECT 'legacy_direct_post_revoked',
    EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.fn_post_wastage(uuid,uuid,numeric,text,uuid,date)')
    )
    AND NOT has_function_privilege(
      'authenticated',
      to_regprocedure('public.fn_post_wastage(uuid,uuid,numeric,text,uuid,date)'),
      'EXECUTE'
    ),
    'legacy RPC retained as a deprecated, non-executable compatibility stub',
    'authenticated cannot execute legacy direct-post RPC'

  UNION ALL
  SELECT 'wastage_lifecycle_columns',
    (
      SELECT count(*) = 7
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory_wastage'
        AND column_name IN (
          'status', 'request_key', 'request_fingerprint',
          'decided_by', 'decided_at', 'decision_reason', 'stock_movement_id'
        )
    ),
    (
      SELECT string_agg(column_name, ', ' ORDER BY column_name)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory_wastage'
        AND column_name IN (
          'status', 'request_key', 'request_fingerprint',
          'decided_by', 'decided_at', 'decision_reason', 'stock_movement_id'
        )
    ),
    'all seven approval and idempotency columns exist'

  UNION ALL
  SELECT 'location_posting_context',
    to_regclass('stock_internal.location_posting_context') IS NOT NULL,
    COALESCE(to_regclass('stock_internal.location_posting_context')::text, 'missing'),
    'private transaction context table exists'

  UNION ALL
  SELECT 'default_location_trigger_enabled',
    EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'products'
        AND t.tgname = 'products_sync_default_location'
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A')
    ),
    'products_sync_default_location',
    'legacy-compatible default-location trigger remains enabled'

  UNION ALL
  SELECT 'wastage_direct_dml_revoked',
    NOT has_table_privilege('authenticated', 'public.inventory_wastage', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.inventory_wastage', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.inventory_wastage', 'DELETE'),
    'authenticated direct DML must be denied',
    'wastage writes go through permissioned RPCs'

  UNION ALL
  SELECT 'wastage_permissions_seeded',
    EXISTS (SELECT 1 FROM public.employee_permission_codes WHERE code = 'stores.stock.wastage.submit')
    AND EXISTS (SELECT 1 FROM public.employee_permission_codes WHERE code = 'stores.stock.wastage.approve'),
    'stores.stock.wastage.submit; stores.stock.wastage.approve',
    'both permission codes exist'
)
SELECT check_name, passed, observed, expected
FROM checks
ORDER BY check_name;
