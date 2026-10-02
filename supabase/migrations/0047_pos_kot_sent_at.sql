-- Track whether an active table's KOT/BOT has already been sent to production.
alter table public.pos_table_sessions
  add column if not exists kot_sent_at timestamptz;

create index if not exists pos_table_sessions_kot_sent_idx
  on public.pos_table_sessions(property_id, kot_sent_at desc)
  where kot_sent_at is not null;

notify pgrst, 'reload schema';
