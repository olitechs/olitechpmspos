-- Expanded READ-ONLY effective ACL and tenant-security inventory.
-- Run separately against production and an isolated test database.
-- This file contains SELECT statements only; it does not modify schema/data/history.

-- 1. Table and view effective privileges plus RLS flags.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls,
  c.reloptions AS relation_options,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
  has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
  has_table_privilege('service_role', c.oid, 'INSERT') AS service_insert,
  has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update,
  has_table_privilege('service_role', c.oid, 'DELETE') AS service_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relkind, c.relname;

-- 2. All public functions: effective execute privileges, owner, security mode,
-- function settings, signature, definition hash and full body for manual review.
-- PUBLIC-inherited execute is reflected by has_function_privilege.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prokind,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS function_settings,
  p.proacl AS explicit_acl,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  md5(pg_get_functiondef(p.oid)) AS definition_md5,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 3. Effective policy predicates. Multiple permissive policies are ORed together.
SELECT
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 4. UPDATE policies lacking WITH CHECK, to review against writable tenant keys,
-- triggers, constraints, and alternate RPC paths.
SELECT schemaname, tablename, policyname, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'UPDATE'
  AND with_check IS NULL
ORDER BY tablename, policyname;

-- 5. Public relations with property_id, useful for tenant-table classification.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('property_id', 'user_id', 'owner_id', 'created_by')
ORDER BY table_name, ordinal_position;

-- 6. Public schema and default privileges. Table-level effective grants alone
-- do not describe schema access or future-object defaults.
SELECT
  has_schema_privilege('anon', 'public', 'USAGE') AS anon_schema_usage,
  has_schema_privilege('authenticated', 'public', 'USAGE') AS authenticated_schema_usage,
  has_schema_privilege('service_role', 'public', 'USAGE') AS service_schema_usage;

SELECT
  d.defaclrole::regrole AS grantor,
  d.defaclnamespace::regnamespace AS schema_name,
  d.defaclobjtype AS object_type,
  d.defaclacl AS default_acl
FROM pg_default_acl d
WHERE d.defaclnamespace = 'public'::regnamespace
ORDER BY d.defaclobjtype;

-- 7. Migration ledger metadata only. This does not recover original SQL.
SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY version;
