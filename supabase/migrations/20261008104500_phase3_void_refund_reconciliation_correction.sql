-- Correction: preserve original payment id and subtract refunds from method totals
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
 reason=case when nullif(trim(coalesce(p_reason,'')),'') is not null then reason||' | Approval note: '||trim(p_reason) else reason end where id=a.id returning * into a;
 if not p_approve then return a; end if;
 if a.adjustment_type='void' and a.target_type='pos_receipt' then
   select * into receipt from public.pos_receipts where id=a.target_id and property_id=a.property_id for update;
   if receipt.id is null or receipt.status<>'posted' then raise exception 'Receipt is no longer posted.'; end if;
   perform public.fn_reverse_pos_stock(a.property_id,receipt.items,1,'POS Void '||coalesce(receipt.order_number,'Receipt'));
   if receipt.payment_method='room' then
     if receipt.reservation_id is null then raise exception 'Room-charge receipt has no reservation.'; end if;
     insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(a.property_id,receipt.reservation_id,'pos','POS void — '||coalesce(receipt.order_number,'Receipt'),-receipt.total);
   end if;
   update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=receipt.id;
 elsif a.adjustment_type='void' and a.target_type='payment' then
   update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=a.target_id and status='posted';
   if not found then raise exception 'Payment is no longer posted.'; end if;
 elsif a.adjustment_type='refund' and a.target_type='pos_receipt' then
   select * into receipt from public.pos_receipts where id=a.target_id and property_id=a.property_id for update;
   if receipt.id is null or receipt.status<>'posted' then raise exception 'Only a posted receipt can be refunded.'; end if;
   select coalesce(sum(amount),0) into already from public.cashier_refunds where target_type='pos_receipt' and target_id=receipt.id;
   remaining:=receipt.total-already; if a.amount>remaining then raise exception 'Refund exceeds the remaining refundable receipt balance.'; end if;
   v_method:=coalesce(a.refund_method,receipt.payment_method);
   if receipt.payment_method='split' then
     if a.refund_method is null then raise exception 'Select the payment method to refund on a split receipt.'; end if;
     select coalesce(sum(amount),0) into allocation from public.pos_receipt_payments where receipt_id=receipt.id and payment_method=a.refund_method;
     if a.amount>(allocation-coalesce((select sum(amount) from public.cashier_refunds where receipt_id=receipt.id and settlement_method=a.refund_method),0)) then raise exception 'Refund exceeds the remaining balance for this payment method.'; end if;
   end if;
   if v_method='room' then
     v_reservation:=receipt.reservation_id; if v_reservation is null then raise exception 'Room-charge refund has no reservation.'; end if;
     insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(a.property_id,v_reservation,'pos','POS refund — '||coalesce(receipt.order_number,'Receipt'),-a.amount) returning id into v_folio_id;
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
   values(a.property_id,a.id,'payment',payment_row.id,payment_row.id,a.amount,payment_row.method,payment_row.reservation_id,auth.uid(),payment_row.method);
   if a.amount=remaining then update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=payment_row.id; end if;
 end if;
 return a;
end; $$;

create or replace function public.fn_pos_shift_reconciliation(p_property_id uuid,p_pos_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.pos_shifts; gross numeric:=0; voided numeric:=0; refunds numeric:=0; net numeric:=0; cash numeric:=0; card numeric:=0; mpesa numeric:=0; bank numeric:=0; room numeric:=0; count_all integer:=0; void_count integer:=0;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select * into s from public.pos_shifts where id=p_pos_shift_id and property_id=p_property_id;
 if s.id is null then raise exception 'POS shift not found.'; end if;
 select count(*),coalesce(sum(total),0),coalesce(sum(total) filter(where status='voided'),0),count(*) filter(where status='voided') into count_all,gross,voided,void_count from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id;
 select coalesce(sum(cr.amount),0) into refunds from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where cr.property_id=p_property_id and r.pos_shift_id=p_pos_shift_id;
 net:=greatest(0,gross-voided-refunds);
 select coalesce(sum(r.total),0)-coalesce((select sum(cr.amount) from public.cashier_refunds cr join public.pos_receipts rr on rr.id=cr.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and cr.settlement_method='cash'),0) into cash from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' and r.payment_method='cash';
 select coalesce(sum(r.total),0)-coalesce((select sum(cr.amount) from public.cashier_refunds cr join public.pos_receipts rr on rr.id=cr.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and cr.settlement_method='card'),0) into card from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' and r.payment_method='card';
 select coalesce(sum(r.total),0)-coalesce((select sum(cr.amount) from public.cashier_refunds cr join public.pos_receipts rr on rr.id=cr.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and cr.settlement_method='mpesa'),0) into mpesa from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' and r.payment_method='mpesa';
 select coalesce(sum(r.total),0)-coalesce((select sum(cr.amount) from public.cashier_refunds cr join public.pos_receipts rr on rr.id=cr.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and cr.settlement_method='bank'),0) into bank from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' and r.payment_method='bank';
 select coalesce(sum(r.total),0)-coalesce((select sum(cr.amount) from public.cashier_refunds cr join public.pos_receipts rr on rr.id=cr.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and cr.settlement_method='room'),0) into room from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' and r.payment_method='room';
 return jsonb_build_object('shift_id',p_pos_shift_id,'shift_no',s.shift_no,'status',s.status,'opening_cash',s.opening_cash,'receipt_count',count_all,'gross_revenue',gross,'posted_revenue',net,'refunds',refunds,'voided_value',voided,'voided_receipts',void_count,'cash',cash,'card',card,'mpesa',mpesa,'bank',bank,'room_charge',room,'reconciled',true);
end; $$;
notify pgrst,'reload schema';