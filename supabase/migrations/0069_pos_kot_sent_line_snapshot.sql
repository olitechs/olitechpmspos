-- Track the exact line quantities already fired to the kitchen/bar for each open table.
-- This prevents later sends from reprinting previously fired items and lets voids
-- reconcile the snapshot before a replacement/additional item is sent.
alter table public.pos_table_sessions
  add column if not exists kot_sent_order_lines jsonb not null default '[]'::jsonb;

-- Existing sessions already marked as fired must not reprint their current
-- contents the first time they use the incremental ticket flow.
update public.pos_table_sessions
set kot_sent_order_lines = coalesce(order_lines, '[]'::jsonb)
where kot_sent_at is not null
  and coalesce(kot_sent_order_lines, '[]'::jsonb) = '[]'::jsonb;

notify pgrst, 'reload schema';
