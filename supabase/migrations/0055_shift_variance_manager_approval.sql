-- Enforce the large-variance manager approval in the database as well as the UI.
drop function if exists public.fn_close_pos_shift(uuid,numeric,text);
create or replace function public.fn_close_pos_shift(p_shift_id uuid,p_counted_cash numeric,p_notes text default null,p_manager_approved boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_shift public.pos_shifts; v_cash numeric:=0; v_mpesa numeric:=0; v_card numeric:=0; v_room numeric:=0; v_bank numeric:=0; v_other numeric:=0; v_total numeric:=0; v_count integer:=0; v_expected numeric:=0; v_variance numeric:=0;
begin
 if p_counted_cash<0 then raise exception 'Counted cash cannot be negative.'; end if;
 select * into v_shift from public.pos_shifts where id=p_shift_id for update;
 if v_shift.id is null then raise exception 'Shift not found.'; end if;
 if not(public.is_platform_owner() or public.property_role(v_shift.property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(v_shift.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then raise exception 'Only cashier, manager or admin can close a shift.'; end if;
 if v_shift.status<>'open' then raise exception 'Shift is already closed.'; end if;
 select coalesce(sum(case when payment_method='cash' then total else 0 end),0),coalesce(sum(case when payment_method='mpesa' then total else 0 end),0),coalesce(sum(case when payment_method='card' then total else 0 end),0),coalesce(sum(case when payment_method='room' then total else 0 end),0),coalesce(sum(case when payment_method='bank' then total else 0 end),0),coalesce(sum(total),0),count(*) into v_cash,v_mpesa,v_card,v_room,v_bank,v_total,v_count from public.pos_receipts where shift_id=p_shift_id and status='posted';
 v_expected:=v_shift.opening_cash+v_cash; v_variance:=p_counted_cash-v_expected;
 if abs(v_variance)>500 and not p_manager_approved then raise exception 'Manager approval is required for a cash variance above KES 500.'; end if;
 update public.pos_shifts set closed_by=auth.uid(),closed_at=now(),status='closed',notes=coalesce(p_notes,notes) where id=p_shift_id returning * into v_shift;
 delete from public.pos_shift_payments where shift_id=p_shift_id;
 insert into public.pos_shift_payments(shift_id,payment_method,amount,transaction_count) values
 (p_shift_id,'cash',v_cash,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='cash')),
 (p_shift_id,'mpesa',v_mpesa,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='mpesa')),
 (p_shift_id,'card',v_card,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='card')),
 (p_shift_id,'room_charge',v_room,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='room')),
 (p_shift_id,'bank',v_bank,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='bank')),
 (p_shift_id,'other',v_other,0);
 return jsonb_build_object('shift',to_jsonb(v_shift),'opening_cash',v_shift.opening_cash,'cash',v_cash,'mpesa',v_mpesa,'card',v_card,'bank',v_bank,'room_charge',v_room,'other',v_other,'total_sales',v_total,'total_transactions',v_count,'expected_cash',v_expected,'counted_cash',p_counted_cash,'variance',v_variance);
end $$;
grant execute on function public.fn_close_pos_shift(uuid,numeric,text,boolean) to authenticated;
notify pgrst,'reload schema';