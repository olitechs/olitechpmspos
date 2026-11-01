# Supabase printer and daily POS summary recovery runbook

## Scope and safety

This runbook addresses the malformed realtime-publication block in
`supabase/migrations/0061_printer_recode_settings.sql`. The migration defines
the workspace/store printer foundation, including `print_agents`,
`printers`, `printer_group_printers`, and `print_jobs`. Printer groups
themselves are first created by migration `0057_printer_groups.sql`.

No production SQL is run by this change. Do not apply a migration until a
database backup exists and the migration ledger has been checked. Do not use
`supabase db reset`, DROP, TRUNCATE, or destructive repair statements.

## 1. Back up first

1. Take a fresh Supabase database backup using the project's normal backup
   procedure.
2. Confirm that the backup completed and can be restored.
3. Record the current production migration ledger and the deployed project ref.

## 2. Check migration history before applying anything

Run this read-only query in the Supabase SQL Editor:

```sql
select version, name
from supabase_migrations.schema_migrations
where name ilike '%printer_recode_settings%'
   or version = '0061'
order by version;
```

Also inspect whether the expected objects exist:

```sql
select
  to_regclass('public.workspaces') as workspaces,
  to_regclass('public.workspace_members') as workspace_members,
  to_regclass('public.stores') as stores,
  to_regclass('public.store_members') as store_members,
  to_regclass('public.printer_groups') as printer_groups,
  to_regclass('public.printers') as printers,
  to_regclass('public.printer_group_printers') as printer_group_printers,
  to_regclass('public.print_agents') as print_agents,
  to_regclass('public.print_jobs') as print_jobs;
```

**Decision:**

- If migration 0061 is recorded as applied, do not attempt to replay it. A
  malformed source file cannot explain a successful execution recorded in the
  ledger. Compare the object inventory and migration ledger, then investigate
  schema drift or PostgREST cache state separately.
- If migration 0061 is not recorded as applied, check for later migrations
  already recorded. If later migrations exist, stop and reconcile migration
  history with the Supabase migration workflow before proceeding. Do not
  blindly run `supabase db push`.
- If 0061 is unapplied and no later migration has been applied, the corrected
  migration can be applied through the project's reviewed Supabase migration
  workflow after the backup. Review the complete migration diff before
  approving it; it includes the existing workspace/store backfill and RLS
  setup, not just the final publication statement.

## 3. Apply the corrected migration

Use the repository's standard migration process only after the checks above
confirm that 0061 is safely eligible to run. Prefer the normal migration
runner so the migration ledger is maintained. Do not paste only the final
`DO` block into production: the migration creates related tables, policies,
functions, indexes, and backfills workspace/store membership.

The corrected final block adds `public.print_jobs` to
`supabase_realtime`, while tolerating an already-present publication entry
or a project without that publication. The migration ends by notifying
PostgREST to reload its schema cache.

## 4. Verify printer objects and RLS

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'printer_groups', 'printers', 'printer_group_printers',
    'print_agents', 'print_jobs'
  )
order by c.relname;
```

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('printer_groups', 'printers', 'print_agents', 'print_jobs')
order by table_name, ordinal_position;
```

Check the policies:

```sql
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'printer_groups', 'printers', 'printer_group_printers',
    'print_agents', 'print_jobs'
  )
order by tablename, policyname;
```

After the migration has been safely applied, refresh the application and
confirm that the REST requests for `print_agents` and `printer_groups` no
longer return schema-cache 404/PGRST205 errors. Verify with an authenticated
user who belongs to the intended property/workspace; do not use service-role
credentials in the browser.

## 5. Verify the daily POS summary RPC

The repository's app call uses named arguments `p_property_id` and
`p_business_date`. The repository's latest reporting migration
(`0060_pos_phase4b_reporting.sql`) declares the same argument names and
types. This repository comparison does not prove the live database has the
same function definition.

Run:

```sql
select
  p.oid::regprocedure as signature,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'fn_daily_pos_summary';
```

Then inspect the exact function body:

```sql
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'fn_daily_pos_summary';
```

Do not replace this function or change its return shape based only on the
browser's HTTP 400. Capture the response JSON from the failing RPC request and
compare it with the live signature, function body, grants, dependencies, and
authenticated user's property access before deciding on a repair.

## 6. Rollback and recovery notes

This is a forward migration and is intentionally not paired with destructive
DROP statements. If the migration fails, stop and retain the complete SQL
error and migration ledger state. Do not manually delete migration records or
drop created objects to retry. Reconcile the migration state and restore from
the verified backup only through the project's approved recovery procedure.

If the migration has already succeeded but the REST API still reports missing
tables, verify object presence, grants, RLS policies, and PostgREST schema
reload status before considering any further schema change.
