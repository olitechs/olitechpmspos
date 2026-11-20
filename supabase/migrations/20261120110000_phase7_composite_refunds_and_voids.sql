-- Phase 7: receipt-linked component movements and quantity-based composite reversals.
-- All stock restoration is ledger-backed and runs in the same transaction as the
-- receipt refund/void. No production migration is applied by this change.
begin;

-- The recipe consumer runs before the POS receipt INSERT. Carry its exact movement
-- IDs in a transaction-local setting; this trigger attaches them to the new receipt.
create or replace function public.trg_link_pos_composite_movements_to_receipt()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_ids jsonb;
begin
  v_ids:=coalesce(nullif(current_setting('olitechs.pos_composite_movement_ids',true),''),'[]')::jsonb;
  if jsonb_typeof(v_ids)='array' and jsonb_array_length(v_ids)>0 then
    update public.stock_movements
      set source_id=new.id
    where property_id=new.property_id
      and source_type='pos_recipe'
      and id in (select value::uuid from jsonb_array_elements_text(v_ids));
  end if;
  perform set_config('olitechs.pos_composite_movement_ids','[]',true);
  return new;
end;
$function$;

drop trigger if exists pos_receipts_link_composite_movements on public.pos_receipts;
create trigger pos_receipts_link_composite_movements
after insert on public.pos_receipts
for each row execute function public.trg_link_pos_composite_movements_to_receipt();

-- p_items is [{ "line_index": 1, "qty": 1.5 }, ...], with 1-based indexes
-- matching the original receipt.items array. Quantities are sellable menu units.
create or replace function public.fn_reverse_pos_composite_stock(
  p_property_id uuid,
  p_receipt_id uuid,
  p_items jsonb,
  p_reason text,
  p_idempotency_key text,
  p_allow_remaining boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_receipt public.pos_receipts;
  v_request jsonb;
  v_line integer;
  v_refund_qty numeric;
  v_original_qty numeric;
  v_component_per_unit numeric;
  v_already_reversed numeric;
  v_restore numeric;
  v_remaining numeric;
  v_movement record;
  v_product public.products;
  v_reason text;
  v_key text;
  v_result jsonb:='[]'::jsonb;
begin
  if not public.fn_has_permission(p_property_id,'receipts.void') then
    raise exception 'Receipt void permission required for composite stock refunds.' using errcode='42501';
  end if;
  v_reason:=nullif(trim(p_reason),'');
  if v_reason is null then raise exception 'A refund reason is required.' using errcode='22023'; end if;
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception 'A refund idempotency key is required.' using errcode='22023';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'Refund lines must be a JSON array.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_items) as item(value)
    group by (value->>'line_index') having count(*)>1
  ) then
    raise exception 'Submit each receipt line once per refund request.' using errcode='22023';
  end if;

  select * into v_receipt from public.pos_receipts
  where id=p_receipt_id and property_id=p_property_id for update;
  if v_receipt.id is null then raise exception 'Receipt not found.'; end if;
  if v_receipt.receipt_status='void' then raise exception 'Receipt is already void.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':composite-refund:'||p_receipt_id::text,0));

  for v_request in select value from jsonb_array_elements(p_items) loop
    v_line:=coalesce(nullif(v_request->>'line_index','')::integer,0);
    v_refund_qty:=coalesce(nullif(v_request->>'qty','')::numeric,0);
    if v_line<1 or v_line>jsonb_array_length(coalesce(v_receipt.items,'[]'::jsonb)) then
      raise exception 'Refund line index % is outside the original receipt.',v_line using errcode='22023';
    end if;
    if v_refund_qty<=0 then raise exception 'Refund quantity must be greater than zero.' using errcode='22023'; end if;

    v_original_qty:=coalesce(
      nullif(v_receipt.items->(v_line-1)->>'qty','')::numeric,
      nullif(v_receipt.items->(v_line-1)->>'quantity','')::numeric,0
    );
    if v_original_qty<=0 then raise exception 'Original receipt line % has an invalid quantity.',v_line; end if;
    if v_refund_qty>v_original_qty then raise exception 'Refund quantity exceeds the original sold quantity on line %.',v_line; end if;

    for v_movement in
      select sm.*
      from public.stock_movements sm
      where sm.property_id=p_property_id
        and sm.source_id=p_receipt_id
        and sm.source_type='pos_recipe'
        and sm.source_line_key like v_line::text||':%'
      order by sm.id
      for update
    loop
      v_key:=trim(p_idempotency_key)||':'||v_movement.id::text;
      if exists(select 1 from public.stock_movements where property_id=p_property_id and idempotency_key=v_key) then
        continue;
      end if;

      v_component_per_unit:=coalesce(v_movement.base_qty,v_movement.qty)/v_original_qty;
      if v_component_per_unit<=0 then raise exception 'Original component movement has an invalid quantity.'; end if;

      select coalesce(sum(coalesce(rv.base_qty,rv.qty)),0)
        into v_already_reversed
      from public.stock_movements rv
      where rv.property_id=p_property_id
        and rv.reversal_of_id=v_movement.id
        and rv.source_type='pos_recipe_refund';

      v_remaining:=greatest(coalesce(v_movement.base_qty,v_movement.qty)-v_already_reversed,0);
      v_restore:=round(v_component_per_unit*v_refund_qty,6);
      if p_allow_remaining then
        v_restore:=least(v_restore,v_remaining);
      elsif v_restore>v_remaining+0.000001 then
        raise exception 'Refund exceeds the remaining unrefunded component quantity on receipt line %.',v_line;
      end if;
      if v_restore<=0 then continue; end if;

      select * into v_product from public.products
      where id=v_movement.product_id and property_id=p_property_id for update;
      if not found then raise exception 'Original component product is no longer in this property.'; end if;

      update public.products set current_stock=coalesce(current_stock,0)+v_restore,updated_at=now()
      where id=v_product.id and property_id=p_property_id;

      insert into public.stock_movements(
        property_id,product_id,type,qty,reason,user_id,source_type,source_id,
        source_line_key,idempotency_key,unit_code,base_qty,unit_cost,recipe_id,recipe_version,reversal_of_id
      ) values(
        p_property_id,v_product.id,'in',v_restore,
        'POS composite refund/void: '||v_reason,auth.uid(),'pos_recipe_refund',p_receipt_id,
        v_movement.source_line_key,v_key,v_movement.unit_code,v_restore,v_movement.unit_cost,
        v_movement.recipe_id,v_movement.recipe_version,v_movement.id
      );

      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'original_movement_id',v_movement.id,'component_product_id',v_product.id,
        'restored_qty',v_restore,'unit',v_movement.unit_code,'receipt_line_index',v_line
      ));
    end loop;
  end loop;
  if jsonb_array_length(v_result)>0 then
    insert into public.audit_logs(
      actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id
    ) values(
      auth.uid(),p_property_id,
      case when p_allow_remaining then 'pos_composite_stock_void_reversal' else 'pos_composite_stock_refunded' end,
      jsonb_build_object('receipt_id',v_receipt.id,'receipt_number',v_receipt.receipt_number),
      jsonb_build_object('reason',v_reason,'idempotency_key',p_idempotency_key,'restored_components',v_result),
      'pos_receipt',v_receipt.id,v_receipt.reservation_id
    );
  end if;
  return v_result;
end;
$function$;

-- A full receipt void restores only the still-unrefunded component balance.
create or replace function public.fn_void_pos_receipt(
  p_property_id uuid,p_receipt_id uuid,p_reason text
) returns public.pos_receipts
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  r public.pos_receipts;
  v_reason text;
  v_lines jsonb;
begin
  if not public.fn_has_permission(p_property_id,'receipts.void') then
    raise exception 'Receipt void permission required.';
  end if;
  v_reason:=nullif(trim(p_reason),'');
  if v_reason is null then raise exception 'A reason is required to void a receipt.'; end if;

  select * into r from public.pos_receipts
  where id=p_receipt_id and property_id=p_property_id for update;
  if r.id is null then raise exception 'Receipt not found.'; end if;
  if r.receipt_status='void' then raise exception 'Receipt is already void.'; end if;
  if r.folio_charge_id is not null then
    raise exception 'Reverse the folio charge before voiding this receipt.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_index',x.ordinality,'qty',coalesce(nullif(x.item->>'qty','')::numeric,nullif(x.item->>'quantity','')::numeric,0)
  )),'[]'::jsonb)
  into v_lines
  from jsonb_array_elements(coalesce(r.items,'[]'::jsonb)) with ordinality as x(item,ordinality)
  where coalesce(nullif(x.item->>'qty','')::numeric,nullif(x.item->>'quantity','')::numeric,0)>0;

  perform public.fn_reverse_pos_composite_stock(
    p_property_id,r.id,v_lines,v_reason,'receipt-void:'||r.id::text,true
  );

  update public.pos_receipts
    set receipt_status='void',void_reason=v_reason,voided_by=auth.uid(),voided_at=now()
  where id=r.id returning * into r;

  insert into public.audit_logs(
    actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id
  ) values(
    auth.uid(),p_property_id,'pos_receipt_voided',
    jsonb_build_object('receipt_number',r.receipt_number,'total',r.total,'status','posted'),
    jsonb_build_object('receipt_number',r.receipt_number,'total',r.total,'status','void','reason',v_reason),
    'pos_receipt',r.id,r.reservation_id
  );
  return r;
end;
$function$;

revoke all on function public.trg_link_pos_composite_movements_to_receipt() from public,anon,authenticated;
revoke all on function public.fn_reverse_pos_composite_stock(uuid,uuid,jsonb,text,text,boolean) from public,anon;
grant execute on function public.fn_reverse_pos_composite_stock(uuid,uuid,jsonb,text,text,boolean) to authenticated;
revoke all on function public.fn_void_pos_receipt(uuid,uuid,text) from public,anon;
grant execute on function public.fn_void_pos_receipt(uuid,uuid,text) to authenticated;

commit;
notify pgrst,'reload schema';
