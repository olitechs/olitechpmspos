CREATE OR REPLACE FUNCTION public.fn_approve_cashier_adjustment(p_adjustment_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS cashier_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cashier_adjustments; role_name text; manager boolean; r public.pos_receipts; p public.payments;
method text; res_id uuid; folio_id uuid; already numeric:=0; remaining numeric; allocation numeric; existing numeric:=0; refund_payment uuid;
begin
select ca.* into a from public.cashier_adjustments ca where ca.id=p_adjustment_id for update;
if a.id is null then raise exception 'Adjustment not found.'; end if;
if not public.fn_employee_has_permission(a.property_id,'pos.apply_discount') then raise exception 'Missing employee permission: pos.apply_discount'; end if;
role_name:=public.current_staff_role(a.property_id);
manager:=public.is_platform_owner() or public.property_role(a.property_id) in ('owner','admin','manager') or role_name in ('hotel_admin','super_admin','fb_manager');
if not manager then raise exception 'Manager approval is required.'; end if;
if a.status<>'pending' then raise exception 'Adjustment is already decided.'; end if;

if not p_approve then
 update public.cashier_adjustments set status='rejected',approved_by=auth.uid(),
 reason=case when coalesce(trim(p_reason),'')='' then reason else reason||' | Rejection: '||trim(p_reason) end
 where id=a.id returning cashier_adjustments.* into a;
 insert into public.audit_logs(actor_id,property_id,action,new_value) values(auth.uid(),a.property_id,'cashier_adjustment_rejected',to_jsonb(a));
 return a;
end if;

if a.adjustment_type='void' and a.target_type='pos_receipt' then
 select pr.* into r from public.pos_receipts pr where pr.id=a.target_id and pr.property_id=a.property_id for update;
 if r.id is null or r.status<>'posted' then raise exception 'Receipt is no longer posted.'; end if;
 perform public.fn_reverse_pos_stock(a.property_id,r.items,1,'POS Void '||coalesce(r.order_number,'Receipt'));
 if r.payment_method='split' then
  for method,allocation in select rp.payment_method,rp.amount from public.pos_receipt_payments rp where rp.receipt_id=r.id loop
   if method='room' then
    if r.reservation_id is null then raise exception 'Room-charge receipt has no reservation.'; end if;
    insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(a.property_id,r.reservation_id,'pos','POS void — '||coalesce(r.order_number,'Receipt'),-allocation);
   else
    insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,receipt_id,amount,method,reservation_id,approved_by,settlement_method) values(a.property_id,a.id,'pos_receipt',r.id,r.id,allocation,method,r.reservation_id,auth.uid(),method);
   end if;
  end loop;
 elsif r.payment_method='room' then
  if r.reservation_id is null then raise exception 'Room-charge receipt has no reservation.'; end if;
  insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(a.property_id,r.reservation_id,'pos','POS void — '||coalesce(r.order_number,'Receipt'),-r.total);
 else
  insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,receipt_id,amount,method,reservation_id,approved_by,settlement_method) values(a.property_id,a.id,'pos_receipt',r.id,r.id,r.total,r.payment_method,r.reservation_id,auth.uid(),r.payment_method);
 end if;
 update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=r.id;

elsif a.adjustment_type='refund' and a.target_type='pos_receipt' then
 select pr.* into r from public.pos_receipts pr where pr.id=a.target_id and pr.property_id=a.property_id for update;
 if r.id is null or r.status<>'posted' then raise exception 'Only a posted receipt can be refunded.'; end if;
 select coalesce(sum(cr.amount),0) into already from public.cashier_refunds cr where cr.receipt_id=r.id;
 remaining:=r.total-already;
 if a.amount>remaining then raise exception 'Refund exceeds remaining receipt balance.'; end if;
 method:=coalesce(a.refund_method,r.payment_method);
 if r.payment_method='split' then
  if a.refund_method is null then raise exception 'Select the payment method for a split refund.'; end if;
  select coalesce(sum(rp.amount),0) into allocation from public.pos_receipt_payments rp where rp.receipt_id=r.id and rp.payment_method=method;
  select coalesce(sum(cr.amount),0) into existing from public.cashier_refunds cr where cr.receipt_id=r.id and cr.settlement_method=method;
  if a.amount>allocation-existing then raise exception 'Refund exceeds remaining payment-method allocation.'; end if;
 end if;
 if method='room' then
  res_id:=r.reservation_id;
  if res_id is null then raise exception 'Room-charge refund has no reservation.'; end if;
  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
  values(a.property_id,res_id,'pos','POS refund — '||coalesce(r.order_number,'Receipt'),-a.amount) returning folio_charges.id into folio_id;
 end if;
 perform public.fn_reverse_pos_stock(a.property_id,r.items,a.amount/greatest(r.total,0.01),'POS Refund '||coalesce(r.order_number,'Receipt'));
 insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,receipt_id,amount,method,reservation_id,folio_charge_id,approved_by,settlement_method)
 values(a.property_id,a.id,'pos_receipt',r.id,r.id,a.amount,method,res_id,folio_id,auth.uid(),method);
 if a.amount=remaining then
  update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=r.id;
 end if;

elsif a.adjustment_type='refund' and a.target_type='payment' then
 select py.* into p from public.payments py where py.id=a.target_id and py.property_id=a.property_id for update;
 if p.id is null or p.status<>'posted' then raise exception 'Only a posted payment can be refunded.'; end if;
 select coalesce(sum(cr.amount),0) into already from public.cashier_refunds cr where cr.target_type='payment' and cr.target_id=p.id;
 remaining:=p.amount-already;
 if a.amount>remaining then raise exception 'Refund exceeds remaining payment balance.'; end if;
 insert into public.payments(property_id,reservation_id,amount,method,shift_id,status)
 values(a.property_id,p.reservation_id,-a.amount,p.method,p.shift_id,'posted') returning payments.id into refund_payment;
 insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,refund_payment_id,amount,method,reservation_id,approved_by,settlement_method)
 values(a.property_id,a.id,'payment',p.id,p.id,refund_payment,a.amount,p.method,p.reservation_id,auth.uid(),p.method);
 if a.amount=remaining then
  update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=p.id;
 end if;

elsif a.adjustment_type='void' and a.target_type='payment' then
 select py.* into p from public.payments py where py.id=a.target_id and py.property_id=a.property_id for update;
 if p.id is null or p.status<>'posted' then raise exception 'Payment is no longer posted.'; end if;
 insert into public.payments(property_id,reservation_id,amount,method,shift_id,status)
 values(a.property_id,p.reservation_id,-p.amount,p.method,p.shift_id,'posted') returning payments.id into refund_payment;
 insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,refund_payment_id,amount,method,reservation_id,approved_by,settlement_method)
 values(a.property_id,a.id,'payment',p.id,p.id,refund_payment,p.amount,p.method,p.reservation_id,auth.uid(),p.method);
 update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=p.id;
end if;

update public.cashier_adjustments set status='approved',approved_by=auth.uid(),
reason=case when coalesce(trim(p_reason),'')='' then reason else reason||' | Approval: '||trim(p_reason) end
where id=a.id returning cashier_adjustments.* into a;
insert into public.audit_logs(actor_id,property_id,action,new_value) values(auth.uid(),a.property_id,'cashier_adjustment_approved',to_jsonb(a));
return a;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_cashier_shift_summary(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.cashier_shifts; opening numeric; cash numeric; card numeric; mpesa numeric; bank numeric; room numeric; other numeric; refunds numeric; cash_refunds numeric; voids numeric; discounts numeric;
begin
select cs.* into s from public.cashier_shifts cs where cs.id=p_shift_id for update; if s.id is null then raise exception 'Cashier shift not found.'; end if;
  if not public.fn_employee_has_permission(s.property_id,'pos.close_shift') then raise exception 'Missing employee permission: pos.close_shift'; end if;
if not(public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then raise exception 'Not allowed.'; end if;
opening:=s.opening_float;
select coalesce(sum(r.total) filter(where r.payment_method='cash'),0),coalesce(sum(r.total) filter(where r.payment_method='card'),0),coalesce(sum(r.total) filter(where r.payment_method='mpesa'),0),coalesce(sum(r.total) filter(where r.payment_method='bank'),0),coalesce(sum(r.total) filter(where r.payment_method='room'),0),coalesce(sum(r.total) filter(where r.payment_method not in ('cash','card','mpesa','bank','room','split')),0)
into cash,card,mpesa,bank,room,other from public.pos_receipts r where r.shift_id=p_shift_id and r.status='posted';
select cash+coalesce(sum(rp.amount) filter(where rp.payment_method='cash'),0),card+coalesce(sum(rp.amount) filter(where rp.payment_method='card'),0),mpesa+coalesce(sum(rp.amount) filter(where rp.payment_method='mpesa'),0),bank+coalesce(sum(rp.amount) filter(where rp.payment_method='bank'),0),room+coalesce(sum(rp.amount) filter(where rp.payment_method='room'),0)
into cash,card,mpesa,bank,room from public.pos_receipt_payments rp join public.pos_receipts r on r.id=rp.receipt_id where r.shift_id=p_shift_id and r.status='posted';
select coalesce(sum(ca.amount),0) into refunds from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='refund' and ca.status='approved';
select coalesce(sum(cr.amount),0) into cash_refunds from public.cashier_refunds cr join public.cashier_adjustments ca on ca.id=cr.adjustment_id where ca.shift_id=p_shift_id and ca.status='approved' and cr.settlement_method='cash';
select coalesce(sum(ca.amount),0) into voids from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='void' and ca.status='approved';
select coalesce(sum(ca.amount),0) into discounts from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='discount' and ca.status='approved';
return jsonb_build_object('shift_id',p_shift_id,'opening_float',opening,'cash_sales',cash,'card_sales',card,'mpesa_sales',mpesa,'bank_sales',bank,'room_charges',room,'other_sales',other,'refunds',refunds,'cash_refunds',cash_refunds,'voids',voids,'discounts',discounts,'expected_cash',opening+cash-cash_refunds);
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_close_cashier_shift(p_shift_id uuid, p_closing_cash_count numeric, p_notes text DEFAULT NULL::text)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.cashier_shifts; x jsonb; v_expected numeric; v_variance numeric; v_manager boolean;
  v_open_n integer; v_open_list text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_closing_cash_count is null or p_closing_cash_count < 0 then raise exception 'Closing cash count cannot be negative.'; end if;

  select cs.* into s from public.cashier_shifts cs where cs.id = p_shift_id for update;
  if s.id is null then raise exception 'Shift not found.'; end if;
  if not public.fn_employee_has_permission(s.property_id,'pos.close_shift') then raise exception 'Missing employee permission: pos.close_shift'; end if;
  if s.status <> 'open' then raise exception 'Shift is already closed.'; end if;

  if not (public.is_platform_owner() or s.opened_by = auth.uid()
          or public.property_role(s.property_id) in ('owner','admin','manager','cashier')
          or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager','cashier')) then
    raise exception 'Not allowed.';
  end if;

  select count(*), string_agg('Table '||coalesce(t.table_number,'?')||' ('||t.status||')', ', ' order by t.table_number)
    into v_open_n, v_open_list
  from public.pos_table_sessions t where t.property_id = s.property_id and t.status <> 'closed';
  if v_open_n > 0 then
    raise exception 'Cannot close shift: % table(s) still open on the floor plan: %. Settle or void them first.', v_open_n, v_open_list;
  end if;

  x := public.fn_cashier_shift_summary(p_shift_id);
  v_expected := coalesce((x->>'expected_cash')::numeric, 0);
  v_variance := p_closing_cash_count - v_expected;
  v_manager := public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager')
               or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager');
  if abs(v_variance) > 500 and not v_manager then
    raise exception 'Manager approval is required for a cash variance above KES 500.';
  end if;

  update public.cashier_shifts cs set
    expected_cash = v_expected,
    closing_cash_count = p_closing_cash_count,
    variance = v_variance,
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closing_notes = p_notes,
    variance_approved_by = case when abs(v_variance) > 500 and v_manager then auth.uid() else cs.variance_approved_by end,
    variance_approved_at = case when abs(v_variance) > 500 and v_manager then now() else cs.variance_approved_at end
  where cs.id = p_shift_id returning cs.* into s;

  insert into public.audit_logs(actor_id, property_id, action, new_value)
  values (auth.uid(), s.property_id, 'cashier_shift_closed',
          jsonb_build_object('shift_id', s.id, 'shift_no', s.shift_no, 'expected_cash', v_expected,
                             'closing_cash', p_closing_cash_count, 'variance', v_variance,
                             'variance_approved_by', s.variance_approved_by));
  return s;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_record_cashier_adjustment(p_property_id uuid, p_shift_id uuid, p_adjustment_type text, p_target_type text, p_target_id uuid, p_amount numeric, p_reason text, p_refund_method text DEFAULT NULL::text)
 RETURNS cashier_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cashier_adjustments; v_role text; v_manager boolean; v_property uuid; v_total numeric; v_status text;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.apply_discount') then raise exception 'Missing employee permission: pos.apply_discount'; end if;
if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
if p_amount<=0 or coalesce(trim(p_reason),'')='' then raise exception 'Amount and reason are required.'; end if;
if p_adjustment_type not in ('refund','void') or p_target_type not in ('pos_receipt','payment') then raise exception 'Use refund or void for post-settlement financial corrections.'; end if;
v_role:=public.current_staff_role(p_property_id); v_manager:=public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or v_role in ('hotel_admin','super_admin','fb_manager');
if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then raise exception 'Cashier access required.'; end if;
if p_target_type='pos_receipt' then select pr.property_id,pr.total,pr.status into v_property,v_total,v_status from public.pos_receipts pr where pr.id=p_target_id for update; else select py.property_id,py.amount,py.status into v_property,v_total,v_status from public.payments py where py.id=p_target_id for update; end if;
if v_property is null or v_property<>p_property_id or v_status<>'posted' then raise exception 'Only a posted transaction can be adjusted.'; end if;
if p_amount>v_total then raise exception 'Adjustment exceeds transaction amount.'; end if;
if p_adjustment_type='refund' and p_refund_method is not null and p_refund_method not in ('cash','card','mpesa','bank','room') then raise exception 'Invalid refund method.'; end if;
insert into public.cashier_adjustments(property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,status,refund_method)
values(p_property_id,p_shift_id,p_adjustment_type,p_target_type,p_target_id,p_amount,p_reason,auth.uid(),'pending',p_refund_method) returning cashier_adjustments.* into a;
insert into public.audit_logs(actor_id,property_id,action,new_value) values(auth.uid(),p_property_id,'cashier_adjustment_requested',jsonb_build_object('id',a.id,'type',p_adjustment_type,'target_id',p_target_id,'amount',p_amount));
if v_manager then a:=public.fn_approve_cashier_adjustment(a.id,true,null); end if; return a;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_record_pos_sale(p_property_id uuid, p_table_number text, p_order_number text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_vat numeric, p_total numeric, p_payment_method text, p_reservation_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_waiter text DEFAULT NULL::text, p_discount_id uuid DEFAULT NULL::uuid, p_discount_name text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_payment_allocations jsonb DEFAULT NULL::jsonb)
 RETURNS pos_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_receipt public.pos_receipts; v_shift uuid; v_key text; v_folio_charge_id uuid;
 v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 item jsonb; a jsonb; v_product public.products; v_qty numeric; v_name text;
 v_method text; v_amount numeric; v_res uuid; v_sum numeric:=0; v_alloc_folio uuid;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then raise exception 'Missing employee permission: pos.process_sale'; end if;
  if coalesce(p_discount_amount,0)>0 and not public.fn_employee_has_permission(p_property_id,'pos.apply_discount') then raise exception 'Missing employee permission: pos.apply_discount'; end if;
  if p_payment_method='room' and not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then raise exception 'Missing employee permission: front_office.folio.post_charge'; end if;
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_payment_method not in ('cash','card','mpesa','bank','room','split') then raise exception 'Unknown payment method.'; end if;
 if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;
 v_key:=nullif(trim(p_idempotency_key),'');
 if v_key is not null then select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1; if v_receipt.id is not null then return v_receipt; end if; end if;
 v_shift:=p_shift_id;
 if v_shift is null then select id into v_shift from public.cashier_shifts where property_id=p_property_id and status='open' order by opened_at desc limit 1; end if;
 if v_shift is null or not exists(select 1 from public.cashier_shifts where id=v_shift and property_id=p_property_id and status='open') then raise exception 'No open shift. Open a shift from the Shifts menu before recording sales.'; end if;
 if p_discount_id is not null and not exists(select 1 from public.pos_discounts where id=p_discount_id and property_id=p_property_id and active) then raise exception 'Discount is not active or does not belong to this property.'; end if;
 if p_payment_method='room' then
   if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
   v_role:=public.current_staff_role(p_property_id);
   if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','manager','admin','owner','property_manager','general_manager','front_office_manager','fb_manager') then raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.'; end if;
   select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id and r.status='checked-in';
   if v_res_property is null or v_res_property<>p_property_id then raise exception 'Checked-in reservation not found.'; end if;
   insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total) returning id into v_folio_charge_id;
 end if;
 perform public.fn_consume_recipe_stock(p_property_id,p_items,coalesce(nullif(p_order_number,''),'POS sale'));
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
   v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0); v_name:=trim(coalesce(item->>'name',item->>'item_name',''));
   if v_qty>0 and nullif(item->>'product_id','') is not null then
     begin
       select * into v_product from public.products where id=(item->>'product_id')::uuid and property_id=p_property_id for update;
       if v_product.id is not null and not exists(select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)) then
         if v_product.current_stock<v_qty then raise exception 'Insufficient stock for % (available %, required %).',v_product.name,v_product.current_stock,v_qty; end if;
         perform public.fn_apply_stock_movement(v_product.id,-v_qty,'POS Sale '||coalesce(p_order_number,''),'pos_sale',null);
       end if;
     exception when invalid_text_representation then null; end;
   end if;
 end loop;
 insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,waiter,items,subtotal,discount_amount,discount_id,discount_name,vat,total,payment_method,folio_charge_id,created_by,shift_id,pos_shift_id,idempotency_key)
 values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,p_waiter,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),p_discount_id,p_discount_name,coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),v_shift,null,v_key)
 returning * into v_receipt;
 if p_payment_method='split' then
   if jsonb_typeof(coalesce(p_payment_allocations,'null'::jsonb))<>'array' then raise exception 'Split payment allocations are required.'; end if;
   delete from public.pos_receipt_payments where receipt_id=v_receipt.id;
   for a in select value from jsonb_array_elements(p_payment_allocations) loop
     v_method:=lower(trim(coalesce(a->>'method',''))); v_amount:=round(coalesce((a->>'amount')::numeric,0),2); v_res:=nullif(a->>'reservation_id','')::uuid;
     if v_method not in ('cash','card','mpesa','bank','room') then raise exception 'Invalid split payment method: %',v_method; end if;
     if v_amount<=0 then raise exception 'Split payment amounts must be greater than zero.'; end if;
     if v_method='room' then
       if v_res is null or not exists(select 1 from public.reservations where id=v_res and property_id=p_property_id and status='checked-in') then raise exception 'Checked-in reservation required for room-charge allocation.'; end if;
       insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,v_res,'pos','POS split payment '||coalesce(p_order_number,v_receipt.id::text),v_amount) returning id into v_alloc_folio;
     else v_alloc_folio:=null; end if;
     v_sum:=v_sum+v_amount;
     insert into public.pos_receipt_payments(receipt_id,property_id,payment_method,amount,reservation_id,folio_charge_id,created_by) values(v_receipt.id,p_property_id,v_method,v_amount,v_res,v_alloc_folio,auth.uid());
   end loop;
   if round(v_sum,2)<>round(p_total,2) then raise exception 'Split payments total % does not equal receipt total %.',v_sum,p_total; end if;
 end if;
 return v_receipt;
exception when unique_violation then
 select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1;
 if v_receipt.id is not null then return v_receipt; end if;
 raise;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_shift_overview(p_property_id uuid, p_from date DEFAULT (((now() AT TIME ZONE 'Africa/Nairobi'::text))::date - 30), p_to date DEFAULT ((now() AT TIME ZONE 'Africa/Nairobi'::text))::date)
 RETURNS TABLE(shift_id uuid, shift_no integer, status text, opened_at timestamp with time zone, closed_at timestamp with time zone, opened_by_name text, closed_by_name text, opening_float numeric, closing_cash_count numeric, expected_cash numeric, variance numeric, receipts_count bigint, total_sales numeric, open_tables_now bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.fn_employee_has_permission(p_property_id,'back_office.reports.view') then raise exception 'Missing employee permission: back_office.reports.view'; end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
          or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then
    raise exception 'Not allowed.';
  end if;
  return query
  select cs.id, cs.shift_no, cs.status, cs.opened_at, cs.closed_at,
         coalesce(po.full_name, po.email), coalesce(pc.full_name, pc.email),
         cs.opening_float, cs.closing_cash_count, cs.expected_cash, cs.variance,
         coalesce(r.n,0), coalesce(r.total,0),
         (select count(*) from public.pos_table_sessions t where t.property_id = p_property_id and t.status <> 'closed')
  from public.cashier_shifts cs
  left join public.profiles po on po.id = cs.opened_by
  left join public.profiles pc on pc.id = cs.closed_by
  left join lateral (select count(*) n, sum(x.total) total from public.pos_receipts x where x.shift_id = cs.id and x.status = 'posted') r on true
  where cs.property_id = p_property_id
    and (cs.status = 'open' or (cs.opened_at at time zone 'Africa/Nairobi')::date between p_from and p_to)
  order by cs.opened_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_verify_pos_access_pin(p_property_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_credential public.pos_access_credentials;
  v_attempt public.pos_access_pin_attempts;
  v_ok boolean := false;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.access') then raise exception 'Missing employee permission: pos.access'; end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff', 'fb_manager', 'receptionist', 'front_desk')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
    )
  ) then raise exception 'POS module access required.'; end if;

  delete from public.pos_access_pin_attempts
  where property_id = p_property_id
    and user_id = auth.uid()
    and locked_until is not null
    and locked_until <= now();

  select * into v_attempt
  from public.pos_access_pin_attempts
  where property_id = p_property_id and user_id = auth.uid()
  for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object('ok', false, 'locked_until', v_attempt.locked_until,
      'message', 'Too many incorrect PIN attempts. Try again after the lock expires.');
  end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  if v_credential.property_id is null then
    raise exception 'POS access PIN is not configured. Ask the property administrator.';
  end if;

  if p_pin ~ '^[0-9]{4}$' then
    v_ok := extensions.crypt(p_pin, v_credential.pin_hash) = v_credential.pin_hash;
  end if;

  if v_ok then
    delete from public.pos_access_pin_attempts
    where property_id = p_property_id and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'is_default', v_credential.is_default, 'must_change', v_credential.is_default);
  end if;

  insert into public.pos_access_pin_attempts(property_id, user_id, failed_attempts, locked_until, updated_at)
  values (p_property_id, auth.uid(), 1, null, now())
  on conflict (property_id, user_id) do update
  set failed_attempts = least(public.pos_access_pin_attempts.failed_attempts + 1, 5),
      locked_until = case
        when public.pos_access_pin_attempts.failed_attempts + 1 >= 5
          then now() + interval '15 minutes'
        else null
      end,
      updated_at = now()
  returning * into v_attempt;

  return jsonb_build_object(
    'ok', false,
    'attempts_remaining', greatest(0, 5 - v_attempt.failed_attempts),
    'locked_until', v_attempt.locked_until,
    'message', case when v_attempt.locked_until is not null
      then 'Too many incorrect PIN attempts. Try again in 15 minutes.'
      else 'Incorrect POS PIN. Try again.' end
  );
end;
$function$
;

notify pgrst, 'reload schema';
