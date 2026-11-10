-- Repair atomic POS table joins and enforce explicit item-void quantities.
-- This migration replaces the existing RPCs in place; it does not create a second
-- table-session or void ledger.

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
  v_source public.pos_table_sessions;
  v_target public.pos_table_sessions;
  v_source_lines jsonb;
  v_target_lines jsonb;
  v_merged_lines jsonb;
  v_merged_kot_lines jsonb;
  v_status text;
  v_guests integer;
  v_waiter text;
  v_order_number text;
  v_kot_sent_at timestamptz;
  v_session jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

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

  -- Lock both active sessions in deterministic order to avoid concurrent
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

    -- Move the full session state, including immutable VAT and KOT snapshots.
    insert into public.pos_table_sessions(
      property_id, table_key, table_number, zone_id, status, guests, waiter,
      order_number, order_lines, opened_by, opened_at, updated_at, closed_at,
      kot_sent_at, vat_snapshot, kot_sent_order_lines
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
      v_source.kot_sent_at,
      v_source.vat_snapshot,
      coalesce(v_source.kot_sent_order_lines, '[]'::jsonb)
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
      where s.property_id = p_property_id
        and s.table_key = p_target_table_key
        and s.status <> 'closed';

    return jsonb_build_object(
      'mode','move',
      'source_table_key',p_source_table_key,
      'target_table_key',p_target_table_key,
      'source_closed',true,
      'session',v_session
    );
  end if;

  if v_target.id is null then
    raise exception 'Target table must already have an ongoing bill for Join Tables.';
  end if;

  -- A joined bill can only have one immutable tax treatment. Refuse a join
  -- when both checks were opened under different VAT settings rather than
  -- silently recalculating either table's tax.
  if v_source.vat_snapshot is not null
     and v_target.vat_snapshot is not null
     and v_source.vat_snapshot is distinct from v_target.vat_snapshot then
    raise exception 'These tables have different saved VAT settings. Settle the bills separately before joining.';
  end if;

  v_target_lines := coalesce(v_target.order_lines, '[]'::jsonb);

  -- Aggregate each matching line in an inner query, then aggregate those
  -- groups in the outer query. The previous function grouped the outer SELECT
  -- itself, returning one row per distinct item and failing for normal orders.
  select coalesce(jsonb_agg(merged.line order by merged.first_ord), '[]'::jsonb)
    into v_merged_lines
  from (
    select
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              grouped.first_line,
              '{qty}',
              to_jsonb(grouped.total_qty),
              true
            ),
            '{id}',
            to_jsonb(coalesce(nullif(grouped.first_line->>'id',''),'joined') || '::join::' || md5((grouped.first_line - 'qty' - 'quantity')::text)),
            true
          ),
          '{productId}',
          to_jsonb(coalesce(nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'id',''))),
          true
        ),
        '{baseProductId}',
        to_jsonb(coalesce(nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'id',''))),
        true
      ) as line,
      grouped.first_ord
    from (
      select
        (array_agg(q.line order by q.ord))[1] as first_line,
        sum(coalesce((q.line->>'qty')::numeric, (q.line->>'quantity')::numeric, 0)) as total_qty,
        min(q.ord) as first_ord
      from (
        select value as line, ordinality::numeric as ord
          from jsonb_array_elements(v_target_lines) with ordinality
        union all
        select value as line, (100000 + ordinality)::numeric as ord
          from jsonb_array_elements(v_source_lines) with ordinality
      ) q
      group by md5((q.line - 'qty' - 'quantity')::text)
    ) grouped
  ) merged;

  -- Keep the already-sent KOT snapshot separate from the live order lines.
  -- This prevents unsent items from being treated as already fired.
  select coalesce(jsonb_agg(merged.line order by merged.first_ord), '[]'::jsonb)
    into v_merged_kot_lines
  from (
    select
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              grouped.first_line,
              '{qty}',
              to_jsonb(grouped.total_qty),
              true
            ),
            '{id}',
            to_jsonb(coalesce(nullif(grouped.first_line->>'id',''),'joined') || '::join::' || md5((grouped.first_line - 'qty' - 'quantity')::text)),
            true
          ),
          '{productId}',
          to_jsonb(coalesce(nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'id',''))),
          true
        ),
        '{baseProductId}',
        to_jsonb(coalesce(nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'id',''))),
        true
      ) as line,
      grouped.first_ord
    from (
      select
        (array_agg(q.line order by q.ord))[1] as first_line,
        sum(coalesce((q.line->>'qty')::numeric, (q.line->>'quantity')::numeric, 0)) as total_qty,
        min(q.ord) as first_ord
      from (
        select value as line, ordinality::numeric as ord
          from jsonb_array_elements(coalesce(v_target.kot_sent_order_lines, '[]'::jsonb)) with ordinality
        union all
        select value as line, (100000 + ordinality)::numeric as ord
          from jsonb_array_elements(coalesce(v_source.kot_sent_order_lines, '[]'::jsonb)) with ordinality
      ) q
      group by md5((q.line - 'qty' - 'quantity')::text)
    ) grouped
  ) merged;

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
         kot_sent_order_lines = v_merged_kot_lines,
         vat_snapshot = coalesce(v_target.vat_snapshot, v_source.vat_snapshot),
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

create or replace function public.fn_remove_pos_item(
  p_property_id uuid,
  p_table_key text,
  p_item_id text,
  p_remove_qty numeric,
  p_reason text,
  p_removed_by_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.pos_table_sessions;
  v_lines jsonb;
  v_item jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_new_kot_lines jsonb := '[]'::jsonb;
  v_sent_item jsonb;
  v_sent_original numeric := 0;
  v_sent_current numeric;
  v_sent_remaining numeric;
  v_original numeric;
  v_removed numeric;
  v_new numeric;
  v_category text;
  v_void public.pos_void_items;
  v_void_number text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager')
  ) then
    raise exception 'Not allowed.';
  end if;

  if coalesce(trim(p_reason),'') = '' then
    raise exception 'A removal reason is required.';
  end if;
  if coalesce(p_remove_qty,0) <= 0 then
    raise exception 'Removal quantity must be greater than zero.';
  end if;

  -- Serialize void-number generation and lock the selected table session.
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text, 0));

  select * into v_session
  from public.pos_table_sessions
  where property_id=p_property_id and table_key=p_table_key and status <> 'closed'
  for update;

  if v_session.id is null then
    raise exception 'Active table session not found.';
  end if;

  v_lines := coalesce(v_session.order_lines,'[]'::jsonb);

  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    if (v_item->>'id') = p_item_id then
      v_original := greatest(coalesce((v_item->>'qty')::numeric,(v_item->>'quantity')::numeric,0),0);
      if v_original <= 0 then
        raise exception 'Item quantity is already zero.';
      end if;
      if p_remove_qty > v_original then
        raise exception 'Cannot void more items than the current quantity (%).', v_original;
      end if;

      v_removed := p_remove_qty;
      v_new := v_original - v_removed;
      v_category := case
        when lower(coalesce(v_item->>'category','')) in ('drinks','drink','bibite')
          or lower(coalesce(v_item->>'center',''))='bar' then 'drinks'
        else 'food'
      end;

      if v_new > 0 then
        v_new_lines := v_new_lines || jsonb_build_array(jsonb_set(v_item,'{qty}',to_jsonb(v_new)));
      end if;
    else
      v_new_lines := v_new_lines || jsonb_build_array(v_item);
    end if;
  end loop;

  if v_original is null then
    raise exception 'Item not found on this table.';
  end if;

  -- A bill already printed is treated as sent in full. Otherwise, only the
  -- quantity in the immutable KOT snapshot can be voided; later additions are
  -- still unsent and must be removed without creating a void record.
  if v_session.status = 'unsettled' then
    v_sent_original := v_original;
  else
    select coalesce(sum(greatest(coalesce((value->>'qty')::numeric, (value->>'quantity')::numeric, 0), 0)), 0)
      into v_sent_original
    from jsonb_array_elements(coalesce(v_session.kot_sent_order_lines, '[]'::jsonb)) value
    where value->>'id' = p_item_id;
  end if;

  if p_remove_qty > v_sent_original then
    raise exception 'Cannot void more than the quantity already sent to production (%).', v_sent_original;
  end if;

  if v_session.status = 'unsettled' then
    -- The printed bill includes the whole remaining order, so keep the sent
    -- snapshot aligned with the new billed lines after the void.
    v_new_kot_lines := v_new_lines;
  else
    for v_sent_item in
      select value from jsonb_array_elements(coalesce(v_session.kot_sent_order_lines, '[]'::jsonb))
    loop
      if v_sent_item->>'id' = p_item_id then
        v_sent_current := greatest(coalesce((v_sent_item->>'qty')::numeric, (v_sent_item->>'quantity')::numeric, 0), 0);
        v_sent_remaining := v_sent_current - p_remove_qty;
        if v_sent_remaining > 0 then
          v_new_kot_lines := v_new_kot_lines || jsonb_build_array(jsonb_set(v_sent_item, '{qty}', to_jsonb(v_sent_remaining)));
        end if;
      else
        v_new_kot_lines := v_new_kot_lines || jsonb_build_array(v_sent_item);
      end if;
    end loop;
  end if;

  update public.pos_table_sessions
    set order_lines=v_new_lines,
        kot_sent_order_lines=v_new_kot_lines,
        updated_at=now()
  where id=v_session.id;

  select 'V-' || lpad((coalesce(max(nullif(regexp_replace(void_number,'[^0-9]','','g'), '')::bigint), 0)+1)::text,6,'0')
    into v_void_number
  from public.pos_void_items
  where property_id=p_property_id;

  insert into public.pos_void_items(
    property_id,table_key,table_number,order_number,check_no,waiter,item_name,category,
    removed_qty,original_qty,new_qty,reason,removed_by,removed_by_name,status,void_number
  ) values (
    p_property_id,v_session.table_key,v_session.table_number,v_session.order_number,v_session.order_number,
    v_session.waiter,v_item->>'name',v_category,v_removed,v_original,v_new,p_reason,auth.uid(),
    coalesce(nullif(trim(p_removed_by_name),''),v_session.waiter),'pending',v_void_number
  ) returning * into v_void;

  insert into public.pos_order_audit(
    property_id,table_key,table_number,order_number,item_name,action,details,actor_id
  ) values (
    p_property_id,v_session.table_key,v_session.table_number,v_session.order_number,v_item->>'name',
    'ITEM_REMOVED',
    jsonb_build_object(
      'void_id',v_void.id,'void_number',v_void.void_number,'category',v_category,
      'removed_qty',v_removed,'original_qty',v_original,'new_qty',v_new,'reason',p_reason,
      'printer_id',null
    ),auth.uid()
  );

  -- Return the post-update row so clients do not hydrate a stale session.
  select * into v_session from public.pos_table_sessions where id=v_session.id;

  return jsonb_build_object(
    'void',row_to_json(v_void),
    'session',row_to_json(v_session),
    'order_lines',v_new_lines,
    'kot_sent_order_lines',v_new_kot_lines
  );
end;
$$;

revoke execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text,text) from public, anon;
grant execute on function public.fn_move_or_merge_pos_table(uuid,text,text,text,text) to authenticated;
revoke execute on function public.fn_remove_pos_item(uuid,text,text,numeric,text,text) from public, anon;
grant execute on function public.fn_remove_pos_item(uuid,text,text,numeric,text,text) to authenticated;

notify pgrst, 'reload schema';
