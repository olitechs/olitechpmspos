-- Track the exact line quantities already fired to the kitchen/bar for each open table.
-- This prevents later sends from reprinting previously fired items and lets voids
-- reconcile the snapshot before a replacement/additional item is sent.
alter table public.pos_table_sessions
  add column if not exists kot_sent_order_lines jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
