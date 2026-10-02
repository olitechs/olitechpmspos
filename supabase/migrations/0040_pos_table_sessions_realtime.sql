-- OliTechs PMS/POS v2 — realtime POS table session synchronization
-- Applies independently of the original 0033 session migration so existing
-- environments receive the realtime publication change.

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pos_table_sessions'
  ) then
    alter publication supabase_realtime add table public.pos_table_sessions;
  end if;
end
$$;

notify pgrst, 'reload schema';
