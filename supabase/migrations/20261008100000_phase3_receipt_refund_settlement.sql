-- Phase 3 receipt history and real refund settlement
create table if not exists public.cashier_refunds (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 adjustment_id uuid not null unique references public.cashier_adjustments(id) on delete restrict,
 target_type text not null check(target_type in ('pos_receipt','payment')), target_id uuid not null,
 receipt_id uuid references public.pos_receipts(id) on delete set null, original_payment_id uuid references public.payments(id) on delete set null,
 amount numeric(12,2) not null check(amount>0), method text not null, reservation_id uuid references public.reservations(id) on delete set null,
 folio_charge_id uuid references public.folio_charges(id) on delete set null, refund_payment_id uuid references public.payments(id) on delete set null,
 approved_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists cashier_refunds_property_idx on public.cashier_refunds(property_id,created_at desc);
create index if not exists cashier_refunds_target_idx on public.cashier_refunds(target_type,target_id);
alter table public.cashier_refunds enable row level security;
drop policy if exists cashier_refunds_select on public.cashier_refunds;
create policy cashier_refunds_select on public.cashier_refunds for select to authenticated using(public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_approve_cashier_adjustment(p_adjustment_id uuid,p_approve boolean,p_reason text default null)
returns public.cashier_adjustments language plpgsql security definer set search_path=public as $$
declare a public.cashier_adjustments; v_role text; v_manager boolean; v_receipt public.pos_receipts; v_payment public.payments; v_method text; v_reservation uuid; v_folio_id uuid; v_refund_payment_id uuid; v_already numeric:=0; v_remaining numeric;
begin
 select * into a from public.cashier_adjustments where id=p_adjustment_id for update;
 if a.id is null then raise exception 'Adjustment not found.'; end if;
 v_role:=public.current_staff_role(a.property_id);
 v_manager:=public.is_platform_owner() or public.property_role(a.property_id) in ('owner','admin','manager') or v_role in ('hotel_admin','super_admin','fb_manager');
 if not v_manager then raise exception 'Manager approval is required.'; end if;
 if a.status <> 'pending' then raise exception 'Adjustment is already decided.'; end if;
 update public.cashier_adjustments set status=case when p_approve then 'approved' else 'rejected' end, approved_by=case when p_approve then auth.uid() else null end, reason=case when nullif(trim(coalesce(p_reason,'')),'') is not null then reason || ' | Approval note: ' || trim(p_reason) else reason end where id=a.id returning * into a;
 if not p_approve then return a; end if;
 if a.adjustment_type='void' then
   if a.target_type='pos_receipt' then update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=a.target_id and status='posted'; if not found then raise exception 'Receipt is no longer posted.'; end if;
   else update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason=a.reason where id=a.target_id and status='posted'; if not found then raise exception 'Payment is no longer posted.'; end if; end if;
 elsif a.adjustment_type='refund' then
   if a.target_type='pos_receipt' then
     select * into v_receipt from public.pos_receipts where id=a.target_id and property_id=a.property_id for update;
     if v_receipt.id is null then raise exception 'Receipt not found.'; end if;
     if v_receipt.status <> 'posted' then raise exception 'Only a posted receipt can be refunded.'; end if;
     select coalesce(sum(amount),0) into v_already from public.cashier_refunds where target_type='pos_receipt' and target_id=v_receipt.id;
     v_remaining:=v_receipt.total-v_already; if a.amount>v_remaining then raise exception 'Refund exceeds the remaining refundable receipt balance.'; end if;
     v_method:=v_receipt.payment_method; v_reservation:=v_receipt.reservation_id;
     if v_method='room' then
       if v_reservation is null then raise exception 'Room-charge receipt has no reservation.'; end if;
       insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(a.property_id,v_reservation,'pos','POS refund — '||coalesce(v_receipt.order_number,'Receipt'),-a.amount) returning id into v_folio_id;
     end if;
     insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,receipt_id,amount,method,reservation_id,folio_charge_id,approved_by) values(a.property_id,a.id,'pos_receipt',v_receipt.id,v_receipt.id,a.amount,v_method,v_reservation,v_folio_id,auth.uid());
     if a.amount=v_remaining then update public.pos_receipts set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=v_receipt.id; end if;
   else
     select * into v_payment from public.payments where id=a.target_id and property_id=a.property_id for update;
     if v_payment.id is null then raise exception 'Payment not found.'; end if;
     if v_payment.status <> 'posted' then raise exception 'Only a posted payment can be refunded.'; end if;
     select coalesce(sum(amount),0) into v_already from public.cashier_refunds where target_type='payment' and target_id=v_payment.id;
     v_remaining:=v_payment.amount-v_already; if a.amount>v_remaining then raise exception 'Refund exceeds the remaining refundable payment balance.'; end if;
     insert into public.payments(property_id,reservation_id,amount,method,shift_id,status) values(a.property_id,v_payment.reservation_id,-a.amount,v_payment.method,v_payment.shift_id,'posted') returning id into v_refund_payment_id;
     insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,amount,method,reservation_id,refund_payment_id,approved_by) values(a.property_id,a.id,'payment',v_payment.id,v_payment.id,a.amount,v_payment.method,v_payment.reservation_id,v_refund_payment_id,auth.uid());
     if a.amount=v_remaining then update public.payments set status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Refunded: '||a.reason where id=v_payment.id; end if;
   end if;
 end if;
 return a;
end; $$;
revoke all on function public.fn_approve_cashier_adjustment(uuid,boolean,text) from anon,public;
grant execute on function public.fn_approve_cashier_adjustment(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';