-- Production reconciliation: performance-safe RLS policies and FK indexes.
-- Applied to the live project before this migration was committed to source control.
--
-- This migration intentionally does not change SECURITY DEFINER execution grants.
-- Those functions are used by authenticated PMS/POS workflows and require
-- separate authorization review before moving them to an unexposed schema.

drop index if exists public.pos_receipts_shift_idx;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and (
        (tablename='cashier_shifts' and policyname='cashier_shifts_select') or
        (tablename='staff' and policyname='staff_insert') or
        (tablename='profiles' and policyname in ('profiles_select_own','profiles_update_own')) or
        (tablename='properties' and policyname='properties_insert_self_service') or
        (tablename='property_users' and policyname in ('property_users_select','property_users_insert')) or
        (tablename='audit_logs' and policyname='audit_logs_insert') or
        (tablename='staff_sessions')
      )
  loop
    if r.qual is not null then
      execute format(
        'alter policy %I on %I.%I using (%s)',
        r.policyname, r.schemaname, r.tablename,
        replace(r.qual, 'auth.uid()', '(select auth.uid())')
      );
    end if;
    if r.with_check is not null then
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        r.policyname, r.schemaname, r.tablename,
        replace(r.with_check, 'auth.uid()', '(select auth.uid())')
      );
    end if;
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and cmd='ALL'
      and policyname like '%_write'
      and tablename <> 'pos_void_items'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for insert to public with check (%s)',
      r.policyname || '_insert', r.tablename, r.with_check
    );
    execute format(
      'create policy %I on public.%I for update to public using (%s) with check (%s)',
      r.policyname || '_update', r.tablename, r.qual, r.with_check
    );
    execute format(
      'create policy %I on public.%I for delete to public using (%s)',
      r.policyname || '_delete', r.tablename, r.qual
    );
  end loop;
end $$;

do $$
declare
  w record;
  p record;
begin
  select * into w
  from pg_policies
  where schemaname='public' and tablename='pos_void_items'
    and policyname='pos_void_items_write';

  select * into p
  from pg_policies
  where schemaname='public' and tablename='pos_void_items'
    and policyname='pos_void_items_print_update';

  if w.policyname is not null and p.policyname is not null then
    execute 'drop policy if exists pos_void_items_write on public.pos_void_items';
    execute 'drop policy if exists pos_void_items_print_update on public.pos_void_items';
    execute format(
      'create policy pos_void_items_write_insert on public.pos_void_items for insert to public with check (%s)',
      w.with_check
    );
    execute format(
      'create policy pos_void_items_write_delete on public.pos_void_items for delete to public using (%s)',
      w.qual
    );
    execute format(
      'create policy pos_void_items_update on public.pos_void_items for update to public using ((%s) or (%s)) with check ((%s) or (%s))',
      w.qual, p.qual, w.with_check, p.with_check
    );
  end if;
end $$;

do $$
declare
  r record;
  idx_name text;
  col_sql text;
begin
  for r in
    with fk as (
      select
        con.oid,
        rel.oid as rel_oid,
        n.nspname as schema_name,
        rel.relname as table_name,
        con.conname,
        array_agg(att.attname order by u.ord) as cols
      from pg_constraint con
      join pg_class rel on rel.oid=con.conrelid
      join pg_namespace n on n.oid=rel.relnamespace
      join unnest(con.conkey) with ordinality u(attnum,ord) on true
      join pg_attribute att on att.attrelid=rel.oid and att.attnum=u.attnum
      where con.contype='f' and n.nspname='public'
      group by con.oid, rel.oid, n.nspname, rel.relname, con.conname
    ),
    idx as (
      select
        i.indrelid,
        array_agg(a.attname order by x.ord) as cols
      from pg_index i
      join unnest(i.indkey) with ordinality x(attnum,ord) on true
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=x.attnum
      where i.indisvalid and i.indpred is null
      group by i.indrelid,i.indexrelid
    )
    select fk.*
    from fk
    where not exists (
      select 1 from idx
      where idx.indrelid=fk.rel_oid
        and idx.cols[1:array_length(fk.cols,1)] = fk.cols
    )
  loop
    select string_agg(format('%I', a.attname), ', ' order by u.ord)
      into col_sql
    from unnest(r.cols) with ordinality u(attname,ord)
    join pg_attribute a
      on a.attrelid=r.rel_oid and a.attname=u.attname;

    idx_name := left('fkidx_' || r.conname, 55) || '_' || substr(md5(r.conname),1,6);

    execute format(
      'create index if not exists %I on public.%I (%s)',
      idx_name, r.table_name, col_sql
    );
  end loop;
end $$;
