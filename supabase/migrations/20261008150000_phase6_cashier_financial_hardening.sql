-- Phase 6: cashier and financial controls hardening
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS variance_approved_by uuid REFERENCES public.profiles(id), ADD COLUMN IF NOT EXISTS variance_approved_at timestamptz;
DROP FUNCTION IF EXISTS public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text);
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


CREATE OR REPLACE FUNCTION public.fn_cashier_shift_summary(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.cashier_shifts; opening numeric; cash numeric; card numeric; mpesa numeric; bank numeric; room numeric; other numeric; refunds numeric; voids numeric; discounts numeric;
begin
select cs.* into s from public.cashier_shifts cs where cs.id=p_shift_id for update; if s.id is null then raise exception 'Cashier shift not found.'; end if;
if not(public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then raise exception 'Not allowed.'; end if;
opening:=s.opening_float;
select coalesce(sum(r.total) filter(where r.payment_method='cash'),0),coalesce(sum(r.total) filter(where r.payment_method='card'),0),coalesce(sum(r.total) filter(where r.payment_method='mpesa'),0),coalesce(sum(r.total) filter(where r.payment_method='bank'),0),coalesce(sum(r.total) filter(where r.payment_method='room'),0),coalesce(sum(r.total) filter(where r.payment_method not in ('cash','card','mpesa','bank','room','split')),0)
into cash,card,mpesa,bank,room,other from public.pos_receipts r where r.shift_id=p_shift_id and r.status='posted';
select cash+coalesce(sum(rp.amount) filter(where rp.payment_method='cash'),0),card+coalesce(sum(rp.amount) filter(where rp.payment_method='card'),0),mpesa+coalesce(sum(rp.amount) filter(where rp.payment_method='mpesa'),0),bank+coalesce(sum(rp.amount) filter(where rp.payment_method='bank'),0),room+coalesce(sum(rp.amount) filter(where rp.payment_method='room'),0)
into cash,card,mpesa,bank,room from public.pos_receipt_payments rp join public.pos_receipts r on r.id=rp.receipt_id where r.shift_id=p_shift_id and r.status='posted';
select coalesce(sum(ca.amount),0) into refunds from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='refund' and ca.status='approved';
select coalesce(sum(ca.amount),0) into voids from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='void' and ca.status='approved';
select coalesce(sum(ca.amount),0) into discounts from public.cashier_adjustments ca where ca.shift_id=p_shift_id and ca.adjustment_type='discount' and ca.status='approved';
return jsonb_build_object('shift_id',p_shift_id,'opening_float',opening,'cash_sales',cash,'card_sales',card,'mpesa_sales',mpesa,'bank_sales',bank,'room_charges',room,'other_sales',other,'refunds',refunds,'voids',voids,'discounts',discounts,'expected_cash',opening+cash-refunds);
end $function$


CREATE OR REPLACE FUNCTION public.fn_close_cashier_shift(p_shift_id uuid, p_closing_cash_count numeric, p_notes text DEFAULT NULL::text)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s public.cashier_shifts; x jsonb; expected numeric; variance numeric; manager boolean;
begin
if p_closing_cash_count<0 then raise exception 'Closing cash count cannot be negative.'; end if;
select cs.* into s from public.cashier_shifts cs where cs.id=p_shift_id for update; if s.id is null then raise exception 'Cashier shift not found.'; end if;
if s.status<>'open' then raise exception 'Cashier shift is already closed.'; end if;
if not(public.is_platform_owner() or s.opened_by=auth.uid() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager')) then raise exception 'Not allowed.'; end if;
x:=public.fn_cashier_shift_summary(p_shift_id); expected:=coalesce((x->>'expected_cash')::numeric,0); variance:=p_closing_cash_count-expected;
manager:=public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager');
if abs(variance)>500 and not manager then raise exception 'Manager approval is required for a cash variance above KES 500.'; end if;
update public.cashier_shifts set expected_cash=expected,closing_cash_count=p_closing_cash_count,variance=variance,status='closed',closed_at=now(),closing_notes=p_notes,
variance_approved_by=case when abs(variance)>500 and manager then auth.uid() else variance_approved_by end,
variance_approved_at=case when abs(variance)>500 and manager then now() else variance_approved_at end
where id=p_shift_id returning cashier_shifts.* into s;
insert into public.audit_logs(actor_id,property_id,action,new_value) values(auth.uid(),s.property_id,'cashier_shift_closed',jsonb_build_object('shift_id',s.id,'expected_cash',expected,'closing_cash',p_closing_cash_count,'variance',variance,'variance_approved_by',s.variance_approved_by));
return s;
end $function$


CREATE OR REPLACE FUNCTION public.fn_record_cashier_adjustment(p_property_id uuid, p_shift_id uuid, p_adjustment_type text, p_target_type text, p_target_id uuid, p_amount numeric, p_reason text)
 RETURNS cashier_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adjustment public.cashier_adjustments;
  v_role text;
  v_property uuid;
  v_total numeric;
  v_is_manager boolean := false;
  v_target_status text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_amount <= 0 or nullif(trim(p_reason),'') is null then raise exception 'Amount and reason are required.'; end if;
  if p_adjustment_type not in ('refund','void','discount') then raise exception 'Invalid adjustment type.'; end if;
  if p_target_type not in ('pos_receipt','payment') then raise exception 'Invalid target type.'; end if;

  v_role := public.current_staff_role(p_property_id);
  v_is_manager := public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or v_role in ('hotel_admin','super_admin','fb_manager');

  if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then
    raise exception 'Only authorised cashier staff can request transaction adjustments.';
  elsif v_role is null and not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can request transaction adjustments.';
  end if;

  if p_target_type = 'pos_receipt' then
    select property_id, total, status into v_property, v_total, v_target_status
    from public.pos_receipts where id = p_target_id;
  else
    select property_id, amount, status into v_property, v_total, v_target_status
    from public.payments where id = p_target_id;
  end if;

  if v_property is null or v_property <> p_property_id then raise exception 'Transaction not found.'; end if;
  if v_target_status <> 'posted' then raise exception 'Only posted transactions can be adjusted.'; end if;
  if p_amount > v_total then raise exception 'Adjustment exceeds transaction amount.'; end if;

  insert into public.cashier_adjustments(
    property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by,status
  ) values(
    p_property_id,p_shift_id,p_adjustment_type,p_target_type,p_target_id,p_amount,p_reason,auth.uid(),
    case when v_is_manager then auth.uid() else null end,
    case when v_is_manager then 'approved' else 'pending' end
  ) returning * into v_adjustment;

  if v_is_manager and p_adjustment_type = 'void' then
    if p_target_type = 'pos_receipt' then
      update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=p_reason where id=p_target_id and status='posted';
    else
      update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=p_reason where id=p_target_id and status='posted';
    end if;
  end if;

  return v_adjustment;
end;
$function$


CREATE OR REPLACE FUNCTION public.fn_record_cashier_adjustment(p_property_id uuid, p_shift_id uuid, p_adjustment_type text, p_target_type text, p_target_id uuid, p_amount numeric, p_reason text, p_refund_method text DEFAULT NULL::text)
 RETURNS cashier_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cashier_adjustments; v_role text; v_manager boolean; v_property uuid; v_total numeric; v_status text;
begin
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

REVOKE EXECUTE ON FUNCTION public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_approve_cashier_adjustment(uuid,boolean,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_cashier_adjustment(uuid,boolean,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cashier_shift_summary(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_shift_summary(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_close_cashier_shift(uuid,numeric,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.fn_close_cashier_shift(uuid,numeric,text) TO authenticated;
NOTIFY pgrst,'reload schema';
