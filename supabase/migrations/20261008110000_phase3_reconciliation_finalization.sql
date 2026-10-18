-- Phase 3 reconciliation finalization
revoke execute on function public.fn_record_cashier_adjustment(uuid,uuid,text,text,uuid,numeric,text) from authenticated;
-- The canonical eight-argument cashier adjustment RPC carries refund_method.
-- The reconciliation function is redefined here to include split allocations and subtract approved refunds by settlement method.
create or replace function public.fn_pos_shift_reconciliation(p_property_id uuid,p_pos_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.pos_shifts; gross numeric:=0; voided numeric:=0; refunds numeric:=0; net numeric:=0; cash numeric:=0; card numeric:=0; mpesa numeric:=0; bank numeric:=0; room numeric:=0; count_all integer:=0; void_count integer:=0;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select * into s from public.pos_shifts where id=p_pos_shift_id and property_id=p_property_id;
 if s.id is null then raise exception 'POS shift not found.'; end if;
 select count(*),coalesce(sum(total),0),coalesce(sum(total) filter(where status='voided'),0),count(*) filter(where status='voided') into count_all,gross,voided,void_count from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id;
 select coalesce(sum(cr.amount),0) into refunds from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where cr.property_id=p_property_id and r.pos_shift_id=p_pos_shift_id and r.status='posted';
 net:=greatest(0,gross-voided-refunds);
 select coalesce(sum(case when r.payment_method='cash' then r.total else 0 end),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='cash'),0),
 coalesce(sum(case when r.payment_method='card' then r.total else 0 end),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='card'),0),
 coalesce(sum(case when r.payment_method='mpesa' then r.total else 0 end),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='mpesa'),0),
 coalesce(sum(case when r.payment_method='bank' then r.total else 0 end),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='bank'),0),
 coalesce(sum(case when r.payment_method='room' then r.total else 0 end),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='room'),0)
 into cash,card,mpesa,bank,room from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select cash-coalesce(sum(amount) filter(where settlement_method='cash'),0),card-coalesce(sum(amount) filter(where settlement_method='card'),0),mpesa-coalesce(sum(amount) filter(where settlement_method='mpesa'),0),bank-coalesce(sum(amount) filter(where settlement_method='bank'),0),room-coalesce(sum(amount) filter(where settlement_method='room'),0)
 into cash,card,mpesa,bank,room from public.cashier_refunds cr join public.pos_receipts r on r.id=cr.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 return jsonb_build_object('shift_id',p_pos_shift_id,'shift_no',s.shift_no,'status',s.status,'opening_cash',s.opening_cash,'receipt_count',count_all,'gross_revenue',gross,'posted_revenue',net,'refunds',refunds,'voided_value',voided,'voided_receipts',void_count,'cash',greatest(cash,0),'card',greatest(card,0),'mpesa',greatest(mpesa,0),'bank',greatest(bank,0),'room_charge',greatest(room,0),'reconciled',round(net,2)=round(cash+card+mpesa+bank+room,2));
end; $$;
notify pgrst,'reload schema';