\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  v_property uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_result jsonb;
  v_session jsonb;
  v_lines jsonb;
  v_line_id text;
  v_qty numeric;
  v_void_count integer;
  v_audit_count integer;
  v_source_status text;
  v_move_session jsonb;
  v_kot jsonb;
begin
  -- A normal join: repeated identical item lines aggregate, while a price
  -- variant remains separate and every resulting line receives a unique id.
  insert into public.pos_table_sessions(
    property_id, table_key, table_number, status, guests, waiter, order_number,
    order_lines, kot_sent_at, vat_snapshot, kot_sent_order_lines
  ) values
  (v_property, 'T1', '1', 'occupied', 2, 'Asha', 'ORD-001',
   '[
     {"id":"tea","productId":"tea","baseProductId":"tea","name":"Tea","qty":2,"price":2.50,"modifiers":[],"category":"Drinks","center":"Bar"},
     {"id":"tea","productId":"tea","baseProductId":"tea","name":"Tea","qty":1,"price":3.00,"modifiers":[],"category":"Drinks","center":"Bar"}
   ]'::jsonb,
   now(), '{"rate":16}'::jsonb,
   '[{"id":"tea","productId":"tea","baseProductId":"tea","name":"Tea","qty":1,"price":2.50,"modifiers":[],"category":"Drinks","center":"Bar"}]'::jsonb),
  (v_property, 'T2', '2', 'occupied', 1, 'Ben', 'ORD-002',
   '[
     {"id":"tea","productId":"tea","baseProductId":"tea","name":"Tea","qty":3,"price":2.50,"modifiers":[],"category":"Drinks","center":"Bar"},
     {"id":"cake","productId":"cake","baseProductId":"cake","name":"Cake","qty":2,"price":5.00,"modifiers":[],"category":"Food","center":"Kitchen"}
   ]'::jsonb,
   now(), '{"rate":16}'::jsonb,
   '[{"id":"tea","productId":"tea","baseProductId":"tea","name":"Tea","qty":2,"price":2.50,"modifiers":[],"category":"Drinks","center":"Bar"}]'::jsonb);

  v_result := public.fn_move_or_merge_pos_table(v_property, 'T2', 'T1', '1', 'merge');
  v_session := v_result->'session';
  v_lines := v_session->'order_lines';
  if jsonb_array_length(v_lines) <> 3 then
    raise exception 'Expected 3 distinct joined lines, got %', jsonb_array_length(v_lines);
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(v_lines)) <> 3 then
    raise exception 'Joined lines do not have unique IDs.';
  end if;
  if (select sum((value->>'qty')::numeric) from jsonb_array_elements(v_lines)) <> 8 then
    raise exception 'Joined quantity total should be 8.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_lines) value
    where value->>'name'='Tea' and (value->>'price')::numeric=2.50 and (value->>'qty')::numeric=5
  ) then raise exception 'Matching tea lines were not combined to quantity 5.'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_lines) value
    where value->>'name'='Tea' and (value->>'price')::numeric=3.00 and (value->>'qty')::numeric=1
  ) then raise exception 'Different-price tea line was not preserved.'; end if;
  if coalesce(v_lines->0->>'productId','') = '' then
    raise exception 'Product reference was lost while assigning unique joined line IDs.';
  end if;
  v_kot := v_session->'kot_sent_order_lines';
  if jsonb_array_length(v_kot) <> 1 or (v_kot->0->>'qty')::numeric <> 3 then
    raise exception 'KOT sent snapshot was not combined independently from live order quantities.';
  end if;
  if v_session->'vat_snapshot' <> '{"rate":16}'::jsonb then
    raise exception 'VAT snapshot was not preserved on joined session.';
  end if;
  select status into v_source_status from public.pos_table_sessions where property_id=v_property and table_key='T2';
  if v_source_status <> 'closed' then raise exception 'Source table was not closed after join.'; end if;

  -- Conflicting immutable VAT snapshots must be rejected without closing either table.
  insert into public.pos_table_sessions(property_id,table_key,table_number,status,order_lines,vat_snapshot)
  values (v_property,'T3','3','occupied','[]'::jsonb,'{"rate":8}'::jsonb);
  begin
    perform public.fn_move_or_merge_pos_table(v_property,'T3','T1','1','merge');
    raise exception 'Expected VAT mismatch rejection.';
  exception when others then
    if sqlerrm not like 'These tables have different saved VAT settings%' then raise; end if;
  end;
  select status into v_source_status from public.pos_table_sessions where property_id=v_property and table_key='T3';
  if v_source_status <> 'occupied' then raise exception 'VAT mismatch changed the source session.'; end if;

  -- Moving a bill preserves VAT and KOT snapshots in the new table session.
  insert into public.pos_table_sessions(property_id,table_key,table_number,status,guests,order_number,order_lines,vat_snapshot,kot_sent_order_lines)
  values (v_property,'T4','4','unsettled',2,'ORD-004','[{"id":"juice","productId":"juice","name":"Juice","qty":2,"price":4}]'::jsonb,'{"rate":16}'::jsonb,'[{"id":"juice","productId":"juice","name":"Juice","qty":1,"price":4}]'::jsonb);
  v_result := public.fn_move_or_merge_pos_table(v_property,'T4','T5','5','move');
  v_move_session := v_result->'session';
  if v_move_session->>'status' <> 'unsettled' or v_move_session->'vat_snapshot' <> '{"rate":16}'::jsonb then
    raise exception 'Move did not preserve status and VAT snapshot.';
  end if;
  if jsonb_array_length(v_move_session->'kot_sent_order_lines') <> 1 then
    raise exception 'Move did not preserve the KOT snapshot.';
  end if;

  -- Partial void quantity, audit trail, and database-side over-void protection.
  select value->>'id' into v_line_id
  from jsonb_array_elements((select order_lines from public.pos_table_sessions where property_id=v_property and table_key='T1')) value
  where value->>'name'='Tea' and (value->>'price')::numeric=2.50;
  v_result := public.fn_remove_pos_item(v_property,'T1',v_line_id,2,'Guest changed mind','Test Cashier');
  if (v_result->'void'->>'removed_qty')::numeric <> 2 then raise exception 'Void record has incorrect removed quantity.'; end if;
  select (value->>'qty')::numeric into v_qty
  from jsonb_array_elements(v_result->'order_lines') value
  where value->>'id'=v_line_id;
  if v_qty <> 3 then raise exception 'Partial void should leave quantity 3, got %', v_qty; end if;
  select (value->>'qty')::numeric into v_qty
  from jsonb_array_elements((select kot_sent_order_lines from public.pos_table_sessions where property_id=v_property and table_key='T1')) value
  where value->>'id'=v_line_id;
  if v_qty <> 1 then raise exception 'Voiding 2 sent units should leave 1 sent unit in the KOT snapshot, got %', v_qty; end if;
  select count(*) into v_void_count from public.pos_void_items where property_id=v_property;
  select count(*) into v_audit_count from public.pos_order_audit where property_id=v_property and action='ITEM_REMOVED';
  if v_void_count <> 1 or v_audit_count <> 1 then raise exception 'Void and audit rows were not recorded atomically.'; end if;

  begin
    -- The current line still has 3 units, but only 1 remains in the sent snapshot.
    perform public.fn_remove_pos_item(v_property,'T1',v_line_id,2,'Unsent quantity must not be voided','Test Cashier');
    raise exception 'Expected unsent quantity to be protected from voiding.';
  exception when others then
    if sqlerrm not like 'Cannot void more than the quantity already sent to production%' then raise; end if;
  end;

  begin
    perform public.fn_remove_pos_item(v_property,'T1',v_line_id,4,'Over quantity test','Test Cashier');
    raise exception 'Expected excessive void quantity rejection.';
  exception when others then
    if sqlerrm not like 'Cannot void more items than the current quantity%' then raise; end if;
  end;
  select count(*) into v_void_count from public.pos_void_items where property_id=v_property;
  if v_void_count <> 1 then raise exception 'Rejected over-void created an extra void row.'; end if;

  begin
    perform public.fn_remove_pos_item(v_property,'T1',v_line_id,0,'Zero quantity test','Test Cashier');
    raise exception 'Expected zero quantity rejection.';
  exception when others then
    if sqlerrm not like 'Removal quantity must be greater than zero%' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.fn_move_or_merge_pos_table(uuid,text,text,text,text)', 'EXECUTE') then
    raise exception 'anon must not execute table move/join RPC.';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_move_or_merge_pos_table(uuid,text,text,text,text)', 'EXECUTE') then
    raise exception 'authenticated must execute table move/join RPC.';
  end if;
  if has_function_privilege('anon', 'public.fn_remove_pos_item(uuid,text,text,numeric,text,text)', 'EXECUTE') then
    raise exception 'anon must not execute item void RPC.';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_remove_pos_item(uuid,text,text,numeric,text,text)', 'EXECUTE') then
    raise exception 'authenticated must execute item void RPC.';
  end if;
end;
$$;

select 'POS table join and quantity-void regression passed' as result;
