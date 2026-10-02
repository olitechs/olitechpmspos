-- OliTechs PMS/POS v2 — atomic table bill move / table merge
-- Moves an active table session to a free table, or joins it to another active table.
-- Existing order lines, check number, waiter, KOT state and unsettled state are preserved.

create or replace function public.fn_move_or_merge_pos_table(
  p_property_id uuid,
  p_source_table_key text,
  p_target_table_key text,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.pos_table_sessions;
  v_target public.pos_table_sessions;
  v_target_lines jsonb;
  v_source_lines jsonb;
  v_merged_lines jsonb;
  v_status text;
  v_guests integer;
  v_waiter text;
  v_order_number text;
  v_kot_sent_at timestamptz;
  v_result jsonb;
begin
  if p_source_table_key is null or p_target_table_key is null
     or trim(p_source_table_key) = trim(p_target_table_key) then
    raise exception 'Choose a different target table.';
  end if;

  if p_mode not in ('move','merge') then
    raise exception 'Invalid table transfer mode.';
  end if;

  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(p_property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager',
      'front_office_manager','property_manager','general_manager','manager'
    )
  ) then
    raise exception 'Not allowed to move or join POS tables.';
  end if;

  -- Lock in deterministic key order to prevent two terminals from deadlocking
  -- while attempting reciprocal table moves/merges.
  if p_source_table_key < p_target_table_key then
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id
        and table_key = p_source_table_key
        and status <> 'closed'
      for update;
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id
        and table_key = p_target_table_key
        and status <> 'closed'
      for update;
  else
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id
        and table_key = p_target_table_key
        and status <> 'closed'
      for update;
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id
        and table_key = p_source_table_key
        and status <> 'closed'
      for update;
  end if;

  if v_source.id is null then
    raise exception 'Source table is no longer open.';
  end if;

  v_source_lines := coalesce(v_source.order_lines, '[]'::jsonb);

  if p_mode = 'move' then
    if v_target.id is not null then
      raise exception 'Target table is already occupied. Use Join Tables to combine the bills.';
    end if;

    update public.pos_table_sessions
       set table_key = p_target_table_key,
           table_number = (
             select coalesce(t.table_number, p_target_table_key)
             from public.pos_table_sessions t
             where false
           ),
           updated_at = now()
     where false;

    -- Table master data is client-owned, so only the session identity is changed
    -- here. The caller supplies the real target table number after the transaction.
    -- We use the target key as a safe fallback when no separate table-number map
    -- exists in the database.
    update public.pos_table_sessions
       set table_key = p_target_table_key,
           table_number = p_target_table_key,
           updated_at = now()
     where id = v_source.id;

    insert into public.pos_order_audit(
      property_id, table_key, table_number, order_number, item_name, action, details, actor_id
    ) values (
      p_property_id, p_target_table_key, p_target_table_key, v_source.order_number,
      null, 'TABLE_MOVED',
      jsonb_build_object(
        'from_table_key', p_source_table_key,
        'to_table_key', p_target_table_key,
        'order_number', v_source.order_number,
        'guests', v_source.guests
      ), auth.uid()
    );

    v_result := jsonb_build_object(
      'mode','move',
      'source_table_key',p_source_table_key,
      'target_table_key',p_target_table_key,
      'source_closed',false,
      'session',to_jsonb(v_source)
    );
    -- Correct the returned session identity to the target.
    v_result := jsonb_set(v_result, '{session,table_key}', to_jsonb(p_target_table_key));
    v_result := jsonb_set(v_result, '{session,table_number}', to_jsonb(p_target_table_key));
    return v_result;
  end if;

  if v_target.id is null then
    raise exception 'Target table must be an ongoing table for Join Tables.';
  end if;

  v_target_lines := coalesce(v_target.order_lines, '[]'::jsonb);
  v_merged_lines := (
    select coalesce(jsonb_agg(x.line order by x.first_pos), '[]'::jsonb)
    from (
      select line, min(first_pos) as first_pos
      from (
        select value as line, ordinality::integer as first_pos,
               coalesce(value->>'id','') as item_id
        from jsonb_array_elements(v_target_lines) with ordinality
        union all
        select value as line, (100000 + ordinality::integer) as first_pos,
               coalesce(value->>'id','') as item_id
        from jsonb_array_elements(v_source_lines) with ordinality
      ) raw
      group by line, item_id
    ) x
  );

  -- The JSON aggregation above preserves both rows. Normalize identical menu
  -- item ids into one line and add quantities so the joined bill is clean.
  v_merged_lines := (
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(
          base.line,
          '{qty}',
          to_jsonb(base.qty)
        ),
        '{quantity}',
        to_jsonb(base.qty)
      ) order by base.first_pos
    ), '[]'::jsonb)
    from (
      select
        min(ord)::integer as first_pos,
        max(line) filter (where ord = min(ord) over (partition by coalesce(line->>'id',''), coalesce(line->>'name',''))) as line,
        sum(coalesce((line->>'qty')::numeric, (line->>'quantity')::numeric, 0)) as qty
      from (
        select value as line, ordinality::numeric as ord
        from jsonb_array_elements(v_target_lines) with ordinality
        union all
        select value as line, (100000 + ordinality)::numeric as ord
        from jsonb_array_elements(v_source_lines) with ordinality
      ) q
      group by coalesce(line->>'id',''), coalesce(line->>'name','')
    ) base
  );

  v_status := case when v_source.status = 'unsettled' or v_target.status = 'unsettled'
                   then 'unsettled' else 'occupied' end;
  v_guests := greatest(coalesce(v_target.guests,1),1) + greatest(coalesce(v_source.guests,1),1);
  v_waiter := coalesce(nullif(trim(v_target.waiter),''), nullif(trim(v_source.waiter),''));
  v_order_number := coalesce(v_target.order_number, v_source.order_number);
  v_kot_sent_at := case
    when v_source.kot_sent_at is null then v_target.kot_sent_at
    when v_target.kot_sent_at is null then v_source.kot_sent_at
    when v_source.kot_sent_at > v_target.kot_sent_at then v_source.kot_sent_at
    else v_target.kot_sent_at
  end;

  update public.pos_table_sessions
     set status = v_status,
         guests = v_guests,
         waiter = v_waiter,
         order_number = v_order_number,
         order_lines = v_merged_lines,
         kot_sent_at = v_kot_sent_at,
         updated_at = now()
   where id = v_target.id;

  update public.pos_table_sessions
     set status = 'closed',
         closed_at = now(),
         updated_at = now()
   where id = v_source.id;

  insert into public.pos_order_audit(
    property_id, table_key, table_number, order_number, item_name, action, details, actor_id
  ) values (
    p_property_id, v_target.table_key, v_target.table_number, v_order_number,
    null, 'TABLE_MERGED',
    jsonb_build_object(
      'from_table_key', p_source_table_key,
      'from_table_number', v_source.table_number,
      'to_table_key', p_target_table_key,
      'to_table_number', v_target.table_number,
      'source_order_number', v_source.order_number,
      'target_order_number', v_target.order_number,
      'source_guests', v_source.guests,
      'target_guests', v_target.guests
    ), auth.uid()
  );

  select to_jsonb(s) into v_result
  from public.pos_table_sessions s
  where s.id = v_target.id;

  return jsonb_build_object(
    'mode','merge',
    'source_table_key',p_source_table_key,
    'target_table_key',p_target_table_key,
    'source_closed',true,
    'session',v_result
  );
end;
$$;

grant execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text) to authenticated;

notify pgrst, 'reload schema';
