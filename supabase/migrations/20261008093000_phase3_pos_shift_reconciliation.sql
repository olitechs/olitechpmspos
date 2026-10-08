-- Phase 3 POS financial reconciliation
create or replace function public.fn_pos_shift_reconciliation(p_property_id uuid,p_pos_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_shift public.pos_shifts; v_total numeric:=0; v_void numeric:=0; v_cash numeric:=0; v_card numeric:=0; v_mpesa numeric:=0; v_bank numeric:=0; v_room numeric:=0; v_split numeric:=0; v_alloc numeric:=0; v_unallocated numeric:=0; v_count integer:=0; v_void_count integer:=0;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select * into v_shift from public.pos_shifts where id=p_pos_shift_id and property_id=p_property_id;
 if v_shift.id is null then raise exception 'POS shift not found.'; end if;
 select count(*),coalesce(sum(total) filter(where status='posted'),0),coalesce(sum(total) filter(where status='voided'),0),count(*) filter(where status='voided')
 into v_count,v_total,v_void,v_void_count from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id;
 select coalesce(sum(amount) filter(where payment_method='cash'),0),coalesce(sum(amount) filter(where payment_method='card'),0),coalesce(sum(amount) filter(where payment_method='mpesa'),0),coalesce(sum(amount) filter(where payment_method='bank'),0),coalesce(sum(amount) filter(where payment_method='room'),0)
 into v_cash,v_card,v_mpesa,v_bank,v_room from public.pos_receipt_payments rp join public.pos_receipts r on r.id=rp.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(total) filter(where payment_method='split'),0) into v_split from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id and status='posted';
 select coalesce(sum(x.allocated),0) into v_alloc from (select rp.receipt_id,sum(rp.amount) allocated from public.pos_receipt_payments rp join public.pos_receipts r on r.id=rp.receipt_id where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted' group by rp.receipt_id) x;
 v_unallocated:=greatest(0,v_total-v_alloc);
 return jsonb_build_object('shift_id',p_pos_shift_id,'shift_no',v_shift.shift_no,'status',v_shift.status,'opening_cash',v_shift.opening_cash,'receipt_count',v_count,'posted_revenue',v_total,'voided_value',v_void,'voided_receipts',v_void_count,'cash',v_cash,'card',v_card,'mpesa',v_mpesa,'bank',v_bank,'room_charge',v_room,'split_receipts',v_split,'allocated_payments',v_alloc,'unallocated_revenue',v_unallocated,'reconciled',round(v_alloc,2)=round(v_total,2));
end; $$;
revoke all on function public.fn_pos_shift_reconciliation(uuid,uuid) from anon,public;
grant execute on function public.fn_pos_shift_reconciliation(uuid,uuid) to authenticated;
create index if not exists pos_receipt_payments_receipt_method_idx on public.pos_receipt_payments(receipt_id,payment_method);
create index if not exists pos_receipts_pos_shift_status_idx on public.pos_receipts(pos_shift_id,status,created_at desc);
notify pgrst,'reload schema';

-- Phase 3 reconciliation/security correction
create or replace function public.fn_pos_shift_reconciliation(p_property_id uuid,p_pos_shift_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_shift public.pos_shifts; v_total numeric:=0; v_void numeric:=0; v_cash numeric:=0; v_card numeric:=0; v_mpesa numeric:=0; v_bank numeric:=0; v_room numeric:=0; v_alloc numeric:=0; v_unallocated numeric:=0; v_count integer:=0; v_void_count integer:=0;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select * into v_shift from public.pos_shifts where id=p_pos_shift_id and property_id=p_property_id;
 if v_shift.id is null then raise exception 'POS shift not found.'; end if;
 select count(*),coalesce(sum(total) filter(where status='posted'),0),coalesce(sum(total) filter(where status='voided'),0),count(*) filter(where status='voided') into v_count,v_total,v_void,v_void_count from public.pos_receipts where pos_shift_id=p_pos_shift_id and property_id=p_property_id;
 select coalesce(sum(r.total) filter(where r.payment_method='cash'),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='cash'),0),
 coalesce(sum(r.total) filter(where r.payment_method='card'),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='card'),0),
 coalesce(sum(r.total) filter(where r.payment_method='mpesa'),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='mpesa'),0),
 coalesce(sum(r.total) filter(where r.payment_method='bank'),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='bank'),0),
 coalesce(sum(r.total) filter(where r.payment_method='room'),0)+coalesce((select sum(rp.amount) from public.pos_receipt_payments rp join public.pos_receipts rr on rr.id=rp.receipt_id where rr.pos_shift_id=p_pos_shift_id and rr.property_id=p_property_id and rr.status='posted' and rr.payment_method='split' and rp.payment_method='room'),0)
 into v_cash,v_card,v_mpesa,v_bank,v_room from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 select coalesce(sum(r.total),0) into v_alloc from public.pos_receipts r where r.pos_shift_id=p_pos_shift_id and r.property_id=p_property_id and r.status='posted';
 v_unallocated:=greatest(0,v_total-v_alloc);
 return jsonb_build_object('shift_id',p_pos_shift_id,'shift_no',v_shift.shift_no,'status',v_shift.status,'opening_cash',v_shift.opening_cash,'receipt_count',v_count,'posted_revenue',v_total,'voided_value',v_void,'voided_receipts',v_void_count,'cash',v_cash,'card',v_card,'mpesa',v_mpesa,'bank',v_bank,'room_charge',v_room,'allocated_payments',v_alloc,'unallocated_revenue',v_unallocated,'reconciled',round(v_alloc,2)=round(v_total,2));
end; $$;
revoke all on function public.fn_pos_shift_reconciliation(uuid,uuid) from anon,public;
grant execute on function public.fn_pos_shift_reconciliation(uuid,uuid) to authenticated;
revoke execute on function public.fn_adjust_stock(uuid,numeric,text) from anon,public;
grant execute on function public.fn_adjust_stock(uuid,numeric,text) to authenticated;
notify pgrst,'reload schema';