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
  v_order_number text := nullif(trim(p_order_number), '');
  v_latest_transfer_from_key text;
begin
  if p_property_id is null or nullif(trim(p_table_key), '') is null then
    raise exception 'A property and table are required.';
  end if;
  if p_status not in ('occupied','unsettled','closed') then
    raise exception 'Invalid POS table status.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || p_table_key, 0)
  );

  -- The newest move/join involving this table determines whether it is still
  -- the source (stale client) or has since become the destination (current
  -- owner). Null order numbers still use the table's latest transfer event.
  select a.details->>'from_table_key'
    into v_latest_transfer_from_key
  from public.pos_order_audit a
  where a.property_id = p_property_id
    and a.action in ('TABLE_MOVED','TABLE_MERGED')
    and (
      a.details->>'from_table_key' = p_table_key
      or a.details->>'to_table_key' = p_table_key
    )
    and (
      v_order_number is null
      or (
        a.details->>'from_table_key' = p_table_key
        and coalesce(nullif(a.details->>'source_order_number',''), a.order_number) = v_order_number
      )
      or (
        a.details->>'to_table_key' = p_table_key
        and coalesce(nullif(a.details->>'target_order_number',''), a.order_number) = v_order_number
      )
    )
  order by a.created_at desc, a.id desc
  limit 1;

  if v_latest_transfer_from_key = p_table_key then
    if p_status = 'closed' then
      return null;
    end if;
    raise exception 'This table check has already been moved or joined. Refresh the POS floor before saving it again.';
  end if;

  return public.fn_touch_pos_table_session_unfenced(
    p_property_id,p_table_key,p_table_number,p_zone_id,p_status,p_guests,
    p_waiter,v_order_number,p_order_lines
  );
end;
$$;

revoke execute on function public.fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)
  from public, anon;
grant execute on function public.fn_touch_pos_table_session(uuid,text,text,text,text,integer,text,text,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
