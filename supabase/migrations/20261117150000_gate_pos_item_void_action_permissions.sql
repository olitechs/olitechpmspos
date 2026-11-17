CREATE OR REPLACE FUNCTION public.fn_remove_pos_item(p_property_id uuid, p_table_key text, p_item_id text, p_remove_qty numeric, p_reason text, p_removed_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if not public.fn_employee_has_permission(p_property_id,'pos.apply_discount') then
    raise exception 'Missing employee permission: pos.apply_discount';
  end if;

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
        v_new_lines := v_new_lines || jsonb_build_array(jsonb_set(v_item - 'quantity','{qty}',to_jsonb(v_new)));
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
          v_new_kot_lines := v_new_kot_lines || jsonb_build_array(jsonb_set(v_sent_item - 'quantity', '{qty}', to_jsonb(v_sent_remaining)));
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
$function$
;

notify pgrst, 'reload schema';
