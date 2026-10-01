-- OliTechs PMS/POS — Phase 2E running table checks
-- Extends the existing persistent table session without replacing prior migrations.

alter table public.pos_table_sessions
  add column if not exists sent_order_lines jsonb not null default '[]'::jsonb;

create or replace function public.fn_mark_pos_table_sent_lines(
  p_property_id uuid,
  p_table_key text,
  p_sent_order_lines jsonb
) returns public.pos_table_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pos_table_sessions;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  update public.pos_table_sessions
     set sent_order_lines = coalesce(p_sent_order_lines, '[]'::jsonb),
         updated_at = now()
   where property_id = p_property_id
     and table_key = p_table_key
     and status <> 'closed'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Open table session not found.';
  end if;

  return v_row;
end;
$$;

grant execute on function public.fn_mark_pos_table_sent_lines(uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
