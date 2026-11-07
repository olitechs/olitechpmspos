-- Fix POS sent-item void number generation.
-- The previous expression passed a text value as a second argument to MAX(),
-- which PostgreSQL interprets as an invalid aggregate signature.
-- Serialize number allocation per property to avoid concurrent duplicate numbers.

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
set search_path = public
as $$
declare
  v_session public.pos_table_sessions;
  v_lines jsonb;
  v_item jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_original numeric;
  v_removed numeric;
  v_new numeric;
  v_category text;
  v_void public.pos_void_items;
  v_void_number text;
begin
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager')
  ) then
    raise exception 'Not allowed.';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A removal reason is required.';
  end if;
  if coalesce(p_remove_qty, 0) <= 0 then
    raise exception 'Removal quantity must be greater than zero.';
  end if;

  -- A property-wide transaction lock keeps sequential void numbers unique
  -- even when different tables are voided at the same time.
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text, 0));

  select *
    into v_session
  from public.pos_table_sessions
  where property_id = p_property_id
    and table_key = p_table_key
    and status <> 'closed'
  for update;

  if v_session.id is null then
    raise exception 'Active table session not found.';
  end if;

  v_lines := coalesce(v_session.order_lines, '[]'::jsonb);

  for v_item in
    select value from jsonb_array_elements(v_lines)
  loop
    if (v_item->>'id') = p_item_id then
      v_original := greatest(coalesce((v_item->>'qty')::numeric, 0), 0);
      v_removed := least(v_original, p_remove_qty);
      v_new := greatest(v_original - v_removed, 0);
      v_category := case
        when lower(coalesce(v_item->>'category', '')) in ('drinks','drink','bibite')
          or lower(coalesce(v_item->>'center', '')) = 'bar' then 'drinks'
        else 'food'
      end;

      if v_removed <= 0 then
        raise exception 'Item quantity is already zero.';
      end if;

      if v_new > 0 then
        v_new_lines := v_new_lines || jsonb_build_array(
          jsonb_set(v_item, '{qty}', to_jsonb(v_new))
        );
      end if;
    else
      v_new_lines := v_new_lines || jsonb_build_array(v_item);
    end if;
  end loop;

  if v_original is null then
    raise exception 'Item not found on this table.';
  end if;

  update public.pos_table_sessions
  set order_lines = v_new_lines,
      updated_at = now()
  where id = v_session.id;

  select
    'V-' || lpad(
      (coalesce(
        max(nullif(regexp_replace(void_number, '[^0-9]', '', 'g'), '')::bigint),
        0
      ) + 1)::text,
      6,
      '0'
    )
  into v_void_number
  from public.pos_void_items
  where property_id = p_property_id;

  insert into public.pos_void_items(
    property_id, table_key, table_number, order_number, check_no, waiter,
    item_name, category, removed_qty, original_qty, new_qty, reason,
    removed_by, removed_by_name, status, void_number
  ) values (
    p_property_id, v_session.table_key, v_session.table_number,
    v_session.order_number, v_session.order_number, v_session.waiter,
    v_item->>'name', v_category, v_removed, v_original, v_new, p_reason,
    auth.uid(), coalesce(nullif(trim(p_removed_by_name), ''), v_session.waiter),
    'pending', v_void_number
  )
  returning * into v_void;

  insert into public.pos_order_audit(
    property_id, table_key, table_number, order_number, item_name,
    action, details, actor_id
  ) values (
    p_property_id, v_session.table_key, v_session.table_number,
    v_session.order_number, v_item->>'name', 'ITEM_REMOVED',
    jsonb_build_object(
      'void_id', v_void.id,
      'void_number', v_void.void_number,
      'category', v_category,
      'removed_qty', v_removed,
      'original_qty', v_original,
      'new_qty', v_new,
      'reason', p_reason,
      'printer_id', null
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'void', row_to_json(v_void),
    'session', row_to_json(v_session),
    'order_lines', v_new_lines
  );
end;
$$;

notify pgrst, 'reload schema';
