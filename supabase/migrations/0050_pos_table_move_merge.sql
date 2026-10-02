-- OliTechs PMS/POS v2 — atomic table bill move / table merge
-- Moves an active table session to a free table, or joins it to another active table.

create or replace function public.fn_move_or_merge_pos_table(
  p_property_id uuid,
  p_source_table_key text,
  p_target_table_key text,
  p_target_table_number text,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.pos_table_sessions;
  v_target public.pos_table_sessions;
  v_source_lines jsonb;
  v_target_lines jsonb;
  v_merged_lines jsonb;
  v_status text;
  v_guests integer;
  v_waiter text;
  v_order_number text;
  v_kot_sent_at timestamptz;
  v_session jsonb;
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

  -- Lock both sessions in deterministic key order to avoid concurrent
  -- move/merge operations racing each other.
  if p_source_table_key < p_target_table_key then
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_source_table_key and status <> 'closed'
      for update;
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_target_table_key and status <> 'closed'
      for update;
  else
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_target_table_key and status <> 'closed'
      for update;
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_source_table_key and status <> 'closed'
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

    -- Keep the source row closed and create a new target session. This makes
    -- Supabase realtime emit a clean UPDATE(old table -> closed) + INSERT(new
    -- table) sequence, so every POS terminal converges on the same floor state.
    insert into public.pos_table_sessions(
      property_id, table_key, table_number, zone_id, status, guests, waiter,
      order_number, order_lines, opened_by, opened_at, updated_at, closed_at, kot_sent_at
    ) values (
      p_property_id,
      p_target_table_key,
      coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
      v_source.zone_id,
      v_source.status,
      v_source.guests,
      v_source.waiter,
      v_source.order_number,
      v_source.order_lines,
      v_source.opened_by,
      v_source.opened_at,
      now(),
      null,
      v_source.kot_sent_at
    );

    update public.pos_table_sessions
       set status = 'closed',
           closed_at = now(),
           updated_at = now()
     where id = v_source.id;

    insert into public.pos_order_audit(
      property_id, table_key, table_number, order_number, item_name, action, details, actor_id
    ) values (
      p_property_id, p_target_table_key,
      coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
      v_source.order_number, null, 'TABLE_MOVED',
      jsonb_build_object(
        'from_table_key', p_source_table_key,
        'from_table_number', v_source.table_number,
        'to_table_key', p_target_table_key,
        'to_table_number', coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
        'order_number', v_source.order_number
      ), auth.uid()
    );

    select to_jsonb(s) into v_session
      from public.pos_table_sessions s
      where s.id = v_source.id;

    return jsonb_build_object(
      'mode','move',
      'source_table_key',p_source_table_key,
      'target_table_key',p_target_table_key,
      'source_closed',false,
      'session',v_session
    );
  end if;

  if v_target.id is null then
    raise exception 'Target table must already have an ongoing bill for Join Tables.';
  end if;

  v_target_lines := coalesce(v_target.order_lines, '[]'::jsonb);

  -- Combine matching menu lines by id/name and add quantities. Keep the
  -- destination line metadata/order while retaining all unique source items.
  select coalesce(
    jsonb_agg(
      jsonb_set(
        (array_agg(q.line order by q.ord))[1],
        '{qty}',
        to_jsonb(sum(coalesce((q.line->>'qty')::numeric, (q.line->>'quantity')::numeric, 0)))
      )
      order by min(q.ord)
    ),
    '[]'::jsonb
  )
  into v_merged_lines
  from (
    select value as line, ordinality::numeric as ord
      from jsonb_array_elements(v_target_lines) with ordinality
    union all
    select value as line, (100000 + ordinality)::numeric as ord
      from jsonb_array_elements(v_source_lines) with ordinality
  ) q
  group by coalesce(q.line->>'id', q.line->>'name');

  v_status := case
    when v_source.status = 'unsettled' or v_target.status = 'unsettled' then 'unsettled'
    else 'occupied'
  end;
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

  select to_jsonb(s) into v_session
    from public.pos_table_sessions s
    where s.id = v_target.id;

  return jsonb_build_object(
    'mode','merge',
    'source_table_key',p_source_table_key,
    'target_table_key',p_target_table_key,
    'source_closed',true,
    'session',v_session
  );
end;
$$;

grant execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
