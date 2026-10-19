-- READ-ONLY security inventory for Phase 1 reconciliation.
-- Safe for production inspection: SELECT statements only; no DDL/DML and no ledger writes.
-- Run separately against production and the existing disposable database.
-- Counts are evidence snapshots, not an authorization sign-off.

-- 1. Exposed public-schema tables: RLS state and effective authenticated grants.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- 2. Public functions, with explicit SECURITY DEFINER ACL/search_path evidence.
-- Read every SECURITY DEFINER body and validate callers before changing grants.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 3. Effective policy definitions. Multiple permissive policies are ORed together.
SELECT
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 4. UPDATE policies that lack WITH CHECK. Review column writability, triggers,
-- constraints, and related foreign keys before deciding whether remediation is needed.
SELECT schemaname, tablename, policyname, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'UPDATE'
  AND with_check IS NULL
ORDER BY tablename, policyname;

-- 5. Exposed public views. Review security_invoker / owner privilege behavior.
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  pg_get_viewdef(c.oid, true) AS view_definition,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
ORDER BY c.relname;

-- 6. Migration ledger metadata only. Does not reconstruct original applied SQL.
SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY version;
