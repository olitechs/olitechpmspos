-- Serialize POS table session writes against table moves/joins and reject
-- delayed writes for a check that has already been transferred.
--
-- The existing implementations are retained as private helpers so the current
-- merge logic (including KOT/VAT snapshots and full line metadata) is preserved.

alter function public.fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)
  rename to fn_touch_pos_table_session_unfenced;

alter function public.fn_move_or_merge_pos_table(uuid,text,text,text,text)
  rename to fn_move_or_merge_pos_table_unfenced;

revoke execute on function public.fn_touch_pos_table_session_unfenced(uuid,text,text,text,text,integer,text,text,jsonb)
  from public, anon, authenticated;
revoke execute on function public.fn_move_or_merge_pos_table_unfenced(uuid,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.fn_touch_pos_table_session(
  p_property_id uuid,
  p_table_key text,
  p_table_number text,
  p_zone_id text,
  p_status text,
  p_guests integer,
  p_waiter text,
  p_order_number text,
  p_order_lines jsonb
) returns public.pos_table_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.pos_table_sessions;
  v_order_number text := nullif(trim(p_order_number), '');
  v_transferred boolean := false;
begin
  if p_property_id is null or nullif(trim(p_table_key), '') is null then
    raise exception 'A property and table are required.';
  end if;

  if p_status not in ('occupied','unsettled','closed') then
    raise exception 'Invalid POS table status.';
  end if;

  -- Same lock key is acquired by the transfer wrapper. If a save started first,
  -- the transfer waits for it; if a transfer started first, this save waits
  -- and then observes the committed transfer audit before it can write.
  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || p_table_key, 0)
  );

  if v_order_number is not null then
    select exists (
      select 1
      from public.pos_order_audit a
      where a.property_id = p_property_id
        and a.action in ('TABLE_MOVED','TABLE_MERGED')
        and a.details->>'from_table_key' = p_table_key
        and coalesce(nullif(a.details->>'source_order_number',''), a.order_number) = v_order_number
    ) into v_transferred;
  end if;

  if v_transferred then
    if p_status = 'closed' then
      -- A delayed close for the transferred check must not close a new check
      -- later opened at the same table key.
      return null;
    end if;
    raise exception 'This table check has already been moved or joined. Refresh the POS floor before saving it again.';
  end if;

  return public.fn_touch_pos_table_session_unfenced(
    p_property_id,
    p_table_key,
    p_table_number,
    p_zone_id,
    p_status,
    p_guests,
    p_waiter,
    v_order_number,
    p_order_lines
  );
end;
$$;

create or replace function public.fn_move_or_merge_pos_table(
  p_property_id uuid,
  p_source_table_key text,
  p_target_table_key text,
  p_target_table_number text,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
  v_source_session jsonb;
  v_first_key text;
  v_second_key text;
begin
  if p_property_id is null or p_source_table_key is null or p_target_table_key is null then
    raise exception 'A property, source table and destination table are required.';
  end if;

  -- Acquire exactly the same per-table advisory locks as fn_touch, in a stable
  -- order. This closes the cross-terminal race that an in-browser queue alone
  -- cannot prevent.
  if p_source_table_key < p_target_table_key then
    v_first_key := p_source_table_key;
    v_second_key := p_target_table_key;
  else
    v_first_key := p_target_table_key;
    v_second_key := p_source_table_key;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || v_first_key, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || v_second_key, 0)
  );

  -- The original atomic implementation remains responsible for all financial,
  -- line-item, KOT, VAT and audit mutations.
  v_result := public.fn_move_or_merge_pos_table_unfenced(
    p_property_id,
    p_source_table_key,
    p_target_table_key,
    p_target_table_number,
    p_mode
  );

  select to_jsonb(s)
    into v_source_session
  from public.pos_table_sessions s
  where s.property_id = p_property_id
    and s.table_key = p_source_table_key
    and s.status = 'closed'
  order by s.updated_at desc
  limit 1;

  if v_source_session is null then
    raise exception 'The transfer did not leave a closed source session.';
  end if;

  return v_result || jsonb_build_object('source_session', v_source_session);
end;
$$;

revoke execute on function public.fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)
  from public, anon;
grant execute on function public.fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)
  to authenticated;

revoke execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text,text)
  to authenticated;

notify pgrst, 'reload schema';
