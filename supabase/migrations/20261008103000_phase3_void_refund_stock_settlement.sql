-- Phase 3: complete POS void/refund settlement and reconciliation
alter table public.cashier_adjustments add column if not exists refund_method text;
alter table public.cashier_refunds add column if not exists settlement_method text;

create or replace function public.fn_reverse_pos_stock(
 p_property_id uuid,p_items jsonb,p_ratio numeric,p_reference text
) returns void language plpgsql security definer set search_path=public as $$
declare item jsonb; ing record; v_name text; v_qty numeric; v_needed numeric; v_product public.products;
begin
 if p_ratio <= 0 then return; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
   v_name:=trim(coalesce(item->>'name',item->>'item_name',''));
   v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0)*p_ratio;
   if v_name='' or v_qty<=0 then continue; end if;
   if exists(select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)) then
     for ing in
       select ri.product_id,ri.qty,r.yield_qty from public.recipes r join public.recipe_ingredients ri on ri.recipe_id=r.id
       where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)
     loop
       v_needed:=ing.qty*(v_qty/greatest(ing.yield_qty,0.001));
       update public.products set current_stock=current_stock+v_needed,updated_at=now() where id=ing.product_id and property_id=p_property_id;
       if not found then raise exception 'Stock product for recipe reversal not found.'; end if;
       insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id)
       values(p_property_id,ing.product_id,'in',v_needed,p_reference,auth.uid());
     end loop;
   elsif nullif(item->>'product_id','') is not null then
     select * into v_product from public.products where id=(item->>'product_id')::uuid and property_id=p_property_id for update;
     if v_product.id is not null then
       update public.products set current_stock=current_stock+v_qty,updated_at=now() where id=v_product.id;
       insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id)
       values(p_property_id,v_product.id,'in',v_qty,p_reference,auth.uid());
     end if;
   end if;
 end loop;
end; $$;

create or replace function public.fn_record_cashier_adjustment(
 p_property_id uuid,p_shift_id uuid,p_adjustment_type text,p_target_type text,p_target_id uuid,
 p_amount numeric,p_reason text,p_refund_method text default null
) returns public.cashier_adjustments language plpgsql security definer set search_path=public as $$
declare a public.cashier_adjustments; v_role text; v_manager boolean; v_property uuid; v_total numeric; v_status text;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'Amount and reason are required.'; end if;
 if p_adjustment_type not in ('refund','void','discount') or p_target_type not in ('pos_receipt','payment') then raise exception 'Invalid adjustment.'; end if;
 v_role:=public.current_staff_role(p_property_id);
 v_manager:=public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or v_role in ('hotel_admin','super_admin','fb_manager');
 if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then raise exception 'Only authorised cashier staff can request transaction adjustments.'; end if;
 if p_target_type='pos_receipt' then select property_id,total,status into v_property,v_total,v_status from public.pos_receipts where id=p_target_id;
 else select property_id,amount,status into v_property,v_total,v_status from public.payments where id=p_target_id; end if;
 if v_property is null or v_property<>p_property_id or v_status<>'posted' then raise exception 'Only posted transaction can be adjusted.'; end if;
 if p_amount>v_total then raise exception 'Adjustment exceeds transaction amount.'; end if;
 if p_adjustment_type='refund' and p_target_type='pos_receipt' and p_refund_method is not null and p_refund_method not in ('cash','card','mpesa','bank','room') then raise exception 'Invalid refund method.'; end if;
 insert into public.cashier_adjustments(property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by,status,refund_method)
 values(p_property_id,p_shift_id,p_adjustment_type,p_target_type,p_target_id,p_amount,p_reason,auth.uid(),case when v_manager then auth.uid() end,case when v_manager then 'approved' else 'pending' end,p_refund_method)
 returning * into a;
 if v_manager then
   a:=public.fn_approve_cashier_adjustment(a.id,true,null);
 end if;
 return a;
end; $$;
revoke all on function public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text) from anon,public;
revoke all on function public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text,text) from anon,public;
grant execute on function public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text,text) to authenticated;

create or replace function public.fn_approve_cashier_adjustment(p_adjustment_id uuid,p_approve boolean,p_reason text default null)
returns public.cashier_adjustments language plpgsql security definer set search_path=public as $$
declare a public.cashier_adjustments; role_name text; manager boolean; receipt public.pos_receipts; payment_row public.payments;
 v_method text; v_reservation uuid; v_folio_id uuid; already numeric:=0; remaining numeric; ratio numeric; allocation numeric;
begin
 select * into a from public.cashier_adjustments where id=p_adjustment_id for update;
 if a.id is null then raise exception 'Adjustment not found.'; end if;
 role_name:=public.current_staff_role(a.property_id);
 manager:=public.is_platform_owner() or public.property_role(a.property_id) in ('owner','admin','manager') or role_name in ('hotel_admin','super_admin','fb_manager');
 if not manager then raise exception 'Manager approval is required.'; end if;
 if a.status<>'pending' then raise exception 'Adjustment is already decided.'; end if;
 update public.cashier_adjustments set status=case when p_approve then 'approved' else 'rejected' end,approved_by=case when p_approve then auth.uid() end,
 reason=case when nullif(trim(coalesce(p_reason,'')),'') is not null then reason||' | Approval note: '||trim(p_reason) else reason end
 where id=a.id returning * into a;
 if not p_approve then return a; end if;

 if a.adjustment_type='void' and a.target_type='pos_receipt' then
   select * into receipt from public.pos_receipts where id=a.target_id and property_id=a.property_id for update;
   if receipt.id is null or receipt.status<>'posted' then raise exception 'Receipt is no longer posted.'; end if;
   perform public.fn_reverse_pos_stock(a.property_id,receipt.items,1,'POS Void '||coalesce(receipt.order_number,'Receipt'));
   if receipt.payment_method='room' then
     if receipt.reservation_id is null then raise exception 'Room-charge receipt has no reservation.'; end if;
     insert into public.folio_charges(property_id,reservation_id,source,description,amount)
     values(a.property_id,receipt.reservation_id,'pos','POS void — '||coalesce(receipt.order_number,'Receipt'),-receipt.total) returning id into v_folio_id;
   end if;
   update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=receipt.id;
 elsif a.adjustment_type='void' and a.target_type='payment' then
   update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=a.target_id and status='posted';
   if not found then raise exception 'Payment is no longer posted.'; end if;
 elsif a.adjustment_type='refund' and a.target_type='pos_receipt' then
   select * into receipt from public.pos_receipts where id=a.target_id and property_id=a.property_id for update;
   if receipt.id is null or receipt.status<>'posted' then raise exception 'Only a posted receipt can be refunded.'; end if;
   select coalesce(sum(amount),0) into already from public.cashier_refunds where target_type='pos_receipt' and target_id=receipt.id;
   remaining:=receipt.total-already;
   if a.amount>remaining then raise exception 'Refund exceeds the remaining refundable receipt balance.'; end if;
   v_method:=coalesce(a.refund_method,receipt.payment_method);
   if receipt.payment_method='split' then
     if a.refund_method is null then raise exception 'Select the payment method to refund on a split receipt.'; end if;
     select coalesce(sum(amount),0) into allocation from public.pos_receipt_payments where receipt_id=receipt.id and payment_method=a.refund_method;
     if a.amount>(allocation-coalesce((select sum(amount) from public.cashier_refunds where receipt_id=receipt.id and settlement_method=a.refund_method),0)) then raise exception 'Refund exceeds the remaining balance for this payment method.'; end if;
   end if;
   if v_method='room' then
     v_reservation:=receipt.reservation_id; if v_reservation is null then raise exception 'Room-charge refund has no reservation.'; end if;
     insert into public.folio_charges(property_id,reservation_id,source,description,amount)
     values(a.property_id,v_reservation,'pos','POS refund — '||coalesce(receipt.order_number,'Receipt'),-a.amount) returning id into v_folio_id;
   end if;
   ratio:=a.amount/greatest(receipt.total,0.01);
   perform public.fn_reverse_pos_stock(a.property_id,receipt.items,ratio,'POS Refund '||coalesce(receipt.order_number,'Receipt'));
   insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,receipt_id,amount,method,reservation_id,folio_charge_id,approved_by,settlement_method)
   values(a.property_id,a.id,'pos_receipt',receipt.id,receipt.id,a.amount,v_method,v_reservation,v_folio_id,auth.uid(),v_method);
   if a.amount=remaining then update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=receipt.id; end if;
 elsif a.adjustment_type='refund' and a.target_type='payment' then
   select * into payment_row from public.payments where id=a.target_id and property_id=a.property_id for update;
   if payment_row.id is null or payment_row.status<>'posted' then raise exception 'Only a posted payment can be refunded.'; end if;
   select coalesce(sum(amount),0) into already from public.cashier_refunds where target_type='payment' and target_id=payment_row.id;
   remaining:=payment_row.amount-already; if a.amount>remaining then raise exception 'Refund exceeds remaining payment balance.'; end if;
   insert into public.payments(property_id,reservation_id,amount,method,shift_id,status) values(a.property_id,payment_row.reservation_id,-a.amount,payment_row.method,payment_row.shift_id,'posted');
   insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,amount,method,reservation_id,approved_by,settlement_method)
   values(a.property_id,a.id,'payment',payment_row.id,a.id,a.amount,payment_row.method,payment_row.reservation_id,auth.uid(),payment_row.method);
   if a.amount=remaining then update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=payment_row.id; end if;
 end if;
 return a;
end; $$;
revoke all on function public.fn_approve_cashier_adjustment(uuid,boolean,text) from anon,public;
grant execute on function public.fn_approve_cashier_adjustment(uuid,boolean,text) to authenticated;

create or replace function public.fn_pos_shift_reconciliation(p_property_id uuid,p_pos_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.pos_shifts; gross numeric:=0; voided numeric:=0; refunds numeric:=0; net numeric:=0; cash numeric:=0; card numeric:=0; mpesa numeric:=0; bank numeric:=0; room numeric:=0; count_all integer:=0; void_count integer:=0;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select * into s from public.pos_shifts where id=p_pos_shift_id and property_id=p_property_id;
 if s.id is null then raise exception 'POS shift not found.'; end if;
 select count(*),coalesce(sum(total),0),coalesce(sum(total) filter(where status='voided'),0),count(*) filter(where status='voided')
 into count_all,gross,voided,void_count from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id;
 select coalesce(sum(cr.amount) filter(where r.status='posted'),0) into refunds
 from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id
 where cr.property_id=p_property_id and r.pos_shift_id=p_pos_shift_id;
 net:=greatest(0,gross-voided-refunds);
 select coalesce(sum(case when r.payment_method='cash' then r.total else 0 end),0),
 coalesce(sum(case when r.payment_method='card' then r.total else 0 end),0),
 coalesce(sum(case when r.payment_method='mpesa' then r.total else 0 end),0),
 coalesce(sum(case when r.payment_method='bank' then r.total else 0 end),0),
 coalesce(sum(case when r.payment_method='room' then r.total else 0 end),0)
 into cash,card,mpesa,bank,room from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(case when cr.settlement_method='cash' then cr.amount else 0 end),0) into cash from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(case when cr.settlement_method='card' then cr.amount else 0 end),0) into card from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(case when cr.settlement_method='mpesa' then cr.amount else 0 end),0) into mpesa from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(case when cr.settlement_method='bank' then cr.amount else 0 end),0) into bank from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(case when cr.settlement_method='room' then cr.amount else 0 end),0) into room from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 return jsonb_build_object('shift_id',p_pos_shift_id,'shift_no',s.shift_no,'status',s.status,'opening_cash',s.opening_cash,'receipt_count',count_all,'gross_revenue',gross,'posted_revenue',net,'refunds',refunds,'voided_value',voided,'voided_receipts',void_count,'cash',cash,'card',card,'mpesa',mpesa,'bank',bank,'room_charge',room,'reconciled',true);
end; $$;
revoke all on function public.fn_pos_shift_reconciliation(uuid,uuid) from anon,public;
grant execute on function public.fn_pos_shift_reconciliation(uuid,uuid) to authenticated;
notify pgrst,'reload schema';