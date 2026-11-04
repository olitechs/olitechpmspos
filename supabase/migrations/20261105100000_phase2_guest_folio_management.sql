-- Phase 2: extend the existing guest folio and payment ledgers. No duplicate ledger tables.
alter table public.folio_charges
  add column if not exists category text not null default 'other_services',
  add column if not exists quantity numeric(12,3) not null default 1,
  add column if not exists unit_price numeric(12,2),
  add column if not exists reference text,
  add column if not exists source_module text not null default 'frontoffice',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists reversal_of_id uuid references public.folio_charges(id) on delete restrict,
  add column if not exists idempotency_key text;

alter table public.folio_charges drop constraint if exists folio_charges_source_check;
alter table public.folio_charges add constraint folio_charges_source_check
  check (source in ('room','pos','other','adjustment'));
alter table public.folio_charges drop constraint if exists folio_charges_category_check;
alter table public.folio_charges add constraint folio_charges_category_check
  check (category in ('accommodation','restaurant','bar','laundry','airport_transfer','excursion','room_service','other_services','tax_adjustment','discount'));

alter table public.payments
  add column if not exists reference text,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists refund_of_id uuid references public.payments(id) on delete restrict,
  add column if not exists folio_charge_id uuid references public.folio_charges(id) on delete restrict;

create unique index if not exists folio_charges_property_idempotency_uidx
  on public.folio_charges(property_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_property_idempotency_uidx
  on public.payments(property_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists folio_charges_single_reversal_uidx
  on public.folio_charges(reversal_of_id) where reversal_of_id is not null;
create index if not exists folio_charges_reservation_category_created_idx
  on public.folio_charges(reservation_id,category,created_at desc);
create index if not exists payments_reservation_created_idx
  on public.payments(reservation_id,created_at desc);

create or replace function public.fn_post_folio_charge(
  p_property_id uuid,p_reservation_id uuid,p_category text,p_description text,
  p_quantity numeric,p_unit_price numeric,p_reference text default null,p_idempotency_key text default null
) returns public.folio_charges
language plpgsql security invoker set search_path=public
as $$
declare r public.reservations; c public.folio_charges; q numeric; price numeric; amount numeric; key text;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if public.current_staff_role(p_property_id) is not null and public.current_staff_role(p_property_id) not in ('hotel_admin','super_admin','cashier','fb_manager','front_office_manager','general_manager','property_manager','reception') then raise exception 'Folio charge permission required.'; end if;
 key:=nullif(trim(p_idempotency_key),'');
 if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-charge:'||key,0));
 select * into c from public.folio_charges where property_id=p_property_id and idempotency_key=key;
 if c.id is not null then return c; end if;
 q:=coalesce(p_quantity,1); price:=coalesce(p_unit_price,0); amount:=round(q*price,2);
 if p_category not in ('accommodation','restaurant','bar','laundry','airport_transfer','excursion','room_service','other_services','tax_adjustment') then raise exception 'Invalid folio transaction category.'; end if;
 if q<=0 or price<=0 or amount<=0 then raise exception 'Quantity and unit price must be greater than zero.'; end if;
 if nullif(trim(p_description),'') is null then raise exception 'Description is required.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status in ('cancelled','checked-out') then raise exception 'An active reservation is required.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,idempotency_key)
 values(p_property_id,p_reservation_id,case when p_category='accommodation' then 'room' else 'other' end,trim(p_description),amount,p_category,q,price,
 coalesce(nullif(trim(p_reference),''),'FOL-'||upper(substr(gen_random_uuid()::text,1,8))),'frontoffice',auth.uid(),key)
 returning * into c;
 return c;
end; $$;

create or replace function public.fn_post_folio_payment(
 p_property_id uuid,p_reservation_id uuid,p_amount numeric,p_method text,p_reference text default null,p_idempotency_key text default null,p_folio_charge_id uuid default null
) returns public.payments
language plpgsql security invoker set search_path=public
as $$
declare r public.reservations; p public.payments; c public.folio_charges; key text; charges numeric; paid numeric; booking numeric; balance numeric; shift uuid; allocated numeric;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if public.current_staff_role(p_property_id) is not null and public.current_staff_role(p_property_id) not in ('hotel_admin','super_admin','cashier','fb_manager','front_office_manager','general_manager','property_manager') then raise exception 'Payment permission required.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-payment:'||key,0));
 select * into p from public.payments where property_id=p_property_id and idempotency_key=key;
 if p.id is not null then return p; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
 if p_method not in ('cash','mpesa','card','bank_transfer','other') then raise exception 'Unsupported payment method.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status='cancelled' then raise exception 'Reservation not found or cancelled.'; end if;
 select coalesce(sum(amount),0) into charges from public.folio_charges where reservation_id=r.id;
 select coalesce(sum(amount),0) into paid from public.payments where reservation_id=r.id and status='posted';
 booking:=greatest(charges,coalesce(nullif(r.total_amount,0),coalesce(r.rate,0)*greatest(1,r.departure-r.arrival)));
 balance:=greatest(0,booking-paid);
 if p_amount>balance+0.005 then raise exception 'Payment exceeds outstanding folio balance of %.',round(balance,2); end if;
 if p_folio_charge_id is not null then
   select * into c from public.folio_charges where id=p_folio_charge_id and reservation_id=r.id and property_id=p_property_id for update;
   if c.id is null or c.amount<=0 then raise exception 'Selected charge is not eligible for payment allocation.'; end if;
   select coalesce(sum(amount),0) into allocated from public.payments where folio_charge_id=c.id and status='posted';
   if p_amount>greatest(0,c.amount-allocated)+0.005 then raise exception 'Payment exceeds the unallocated balance of the selected charge.'; end if;
 end if;
 select cs.id into shift from public.cashier_shifts cs where cs.property_id=p_property_id and cs.opened_by=auth.uid() and cs.status='open' order by cs.opened_at desc limit 1;
 insert into public.payments(property_id,reservation_id,amount,method,status,shift_id,reference,idempotency_key,created_by,folio_charge_id)
 values(p_property_id,r.id,round(p_amount,2),p_method,'posted',shift,coalesce(nullif(trim(p_reference),''),'PAY-'||upper(substr(gen_random_uuid()::text,1,8))),key,auth.uid(),p_folio_charge_id)
 returning * into p;
 update public.reservations set amount_paid=least(booking,paid+p.amount),
 payment_status=case when booking>0 and paid+p.amount>=booking-0.005 then 'fully_paid' when paid+p.amount>0 then 'partially_paid' else 'not_paid' end
 where id=r.id;
 return p;
end; $$;

create or replace function public.fn_post_folio_refund(
 p_property_id uuid,p_payment_id uuid,p_amount numeric,p_refund_method text,p_reason text,p_idempotency_key text
) returns public.payments
language plpgsql security invoker set search_path=public
as $folio$
declare original public.payments; refund_payment public.payments; adjustment public.cashier_adjustments;
 manager boolean; key text; already numeric; remaining numeric; reservation_property uuid;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 manager:=public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager');
 if not manager then raise exception 'Manager approval is required to refund a guest payment.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-refund:'||key,0));
 select * into refund_payment from public.payments where property_id=p_property_id and idempotency_key='refund:'||key;
 if refund_payment.id is not null then return refund_payment; end if;
 if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'Refund amount and reason are required.'; end if;
 if p_refund_method not in ('cash','mpesa','card','bank_transfer','other') then raise exception 'Unsupported refund method.'; end if;
 select * into original from public.payments where id=p_payment_id and property_id=p_property_id and status='posted' and amount>0 for update;
 if original.id is null then raise exception 'A posted positive payment is required.'; end if;
 select coalesce(sum(cr.amount),0) into already from public.cashier_refunds cr where cr.target_type='payment' and cr.target_id=original.id;
 remaining:=original.amount-already;
 if p_amount>remaining+0.005 then raise exception 'Refund exceeds the remaining refundable payment amount of %.',round(remaining,2); end if;
 select property_id into reservation_property from public.reservations where id=original.reservation_id;
 if reservation_property is distinct from p_property_id then raise exception 'Payment reservation does not belong to this property.'; end if;
 insert into public.cashier_adjustments(property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by,status,refund_method)
 values(p_property_id,original.shift_id,'refund','payment',original.id,round(p_amount,2),trim(p_reason),auth.uid(),auth.uid(),'approved',p_refund_method)
 returning * into adjustment;
 insert into public.payments(property_id,reservation_id,amount,method,status,shift_id,reference,idempotency_key,created_by,refund_of_id,folio_charge_id)
 values(p_property_id,original.reservation_id,-round(p_amount,2),p_refund_method,'posted',original.shift_id,
 'REF-'||upper(substr(gen_random_uuid()::text,1,8)),'refund:'||key,auth.uid(),original.id,original.folio_charge_id)
 returning * into refund_payment;
 insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,refund_payment_id,amount,method,reservation_id,approved_by,settlement_method)
 values(p_property_id,adjustment.id,'payment',original.id,original.id,refund_payment.id,round(p_amount,2),p_refund_method,original.reservation_id,auth.uid(),p_refund_method);
 insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_payment_refunded',to_jsonb(original),jsonb_build_object('refund_payment_id',refund_payment.id,'amount',p_amount,'method',p_refund_method,'reason',trim(p_reason)),'payment',original.id,original.reservation_id);
 return refund_payment;
end; $folio$;

create or replace function public.fn_reverse_folio_charge(p_property_id uuid,p_charge_id uuid,p_reason text)
returns public.folio_charges
language plpgsql security invoker set search_path=public
as $$
declare c public.folio_charges; rev public.folio_charges; manager boolean;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 select * into c from public.folio_charges where id=p_charge_id and property_id=p_property_id for update;
 if c.id is null then raise exception 'Folio charge not found.'; end if;
 manager:=public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager');
 if not manager then raise exception 'Manager approval is required to reverse a posted charge.'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'A reversal reason is required.'; end if;
 if exists(select 1 from public.folio_charges where reversal_of_id=c.id) then raise exception 'This charge has already been reversed.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,reversal_of_id)
 values(c.property_id,c.reservation_id,'adjustment','Reversal: '||c.description,-c.amount,c.category,c.quantity,c.unit_price,
 'REV-'||upper(substr(gen_random_uuid()::text,1,8)),'folio',auth.uid(),c.id) returning * into rev;
 insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_charge_reversed',to_jsonb(c),jsonb_build_object('reversal_id',rev.id,'reason',trim(p_reason)), 'folio_charge',c.id,c.reservation_id);
 return rev;
end; $$;

create or replace function public.fn_apply_folio_discount(p_property_id uuid,p_reservation_id uuid,p_amount numeric,p_reason text,p_idempotency_key text)
returns public.folio_charges
language plpgsql security invoker set search_path=public
as $$
declare r public.reservations; c public.folio_charges; manager boolean; key text; charges numeric; paid numeric;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 manager:=public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager');
 if not manager then raise exception 'Manager approval is required to apply a folio discount.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-discount:'||key,0));
 select * into c from public.folio_charges where property_id=p_property_id and idempotency_key=key; if c.id is not null then return c; end if;
 if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'Discount amount and reason are required.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status in ('cancelled','checked-out') then raise exception 'An active reservation is required.'; end if;
 select coalesce(sum(amount),0) into charges from public.folio_charges where reservation_id=r.id;
 select coalesce(sum(amount),0) into paid from public.payments where reservation_id=r.id and status='posted';
 if p_amount>greatest(0,charges-paid)+0.005 then raise exception 'Discount exceeds the unpaid folio balance.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,idempotency_key)
 values(p_property_id,r.id,'adjustment','Authorised discount: '||trim(p_reason),-round(p_amount,2),'discount',1,-round(p_amount,2),
 'DISC-'||upper(substr(gen_random_uuid()::text,1,8)),'folio',auth.uid(),key) returning * into c;
 insert into public.audit_logs(actor_id,property_id,action,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_discount_applied',jsonb_build_object('charge_id',c.id,'amount',p_amount,'reason',trim(p_reason)),'folio_charge',c.id,r.id);
 return c;
end; $$;

create or replace function public.fn_transfer_folio_charges(p_property_id uuid,p_charge_ids uuid[],p_target_reservation_id uuid,p_reason text)
returns integer
language plpgsql security invoker set search_path=public
as $$
declare target public.reservations; charge public.folio_charges; moved integer:=0; source_reservation uuid;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if not(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager')) then raise exception 'Manager permission is required to transfer folio charges.'; end if;
 if coalesce(array_length(p_charge_ids,1),0)=0 or nullif(trim(p_reason),'') is null then raise exception 'Select charges and provide a transfer reason.'; end if;
 select * into target from public.reservations where id=p_target_reservation_id and property_id=p_property_id for update;
 if target.id is null or target.status in ('cancelled','checked-out') then raise exception 'Target folio must belong to this property and be active.'; end if;
 for charge in select * from public.folio_charges where id=any(p_charge_ids) and property_id=p_property_id for update loop
   if charge.reservation_id=p_target_reservation_id then continue; end if;
   if charge.reversal_of_id is not null or exists(select 1 from public.folio_charges x where x.reversal_of_id=charge.id) then raise exception 'Reversed charges cannot be transferred.'; end if;
   source_reservation:=charge.reservation_id;
   update public.folio_charges set reservation_id=p_target_reservation_id,reference=coalesce(reference,'') where id=charge.id;
   insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
   values(auth.uid(),p_property_id,'folio_charge_transferred',jsonb_build_object('reservation_id',source_reservation),jsonb_build_object('reservation_id',p_target_reservation_id,'reason',trim(p_reason)),'folio_charge',charge.id,source_reservation);
   moved:=moved+1;
 end loop;
 if moved=0 then raise exception 'No eligible charges were transferred.'; end if;
 return moved;
end; $$;

revoke all on function public.fn_post_folio_charge(uuid,uuid,text,text,numeric,numeric,text,text) from public,anon;
revoke all on function public.fn_post_folio_payment(uuid,uuid,numeric,text,text,text,uuid) from public,anon;
revoke all on function public.fn_reverse_folio_charge(uuid,uuid,text) from public,anon;
revoke all on function public.fn_post_folio_refund(uuid,uuid,numeric,text,text,text) from public,anon;
revoke all on function public.fn_apply_folio_discount(uuid,uuid,numeric,text,text) from public,anon;
revoke all on function public.fn_transfer_folio_charges(uuid,uuid[],uuid,text) from public,anon;
grant execute on function public.fn_post_folio_charge(uuid,uuid,text,text,numeric,numeric,text,text) to authenticated,service_role;
grant execute on function public.fn_post_folio_payment(uuid,uuid,numeric,text,text,text,uuid) to authenticated,service_role;
grant execute on function public.fn_reverse_folio_charge(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.fn_post_folio_refund(uuid,uuid,numeric,text,text,text) to authenticated,service_role;
grant execute on function public.fn_apply_folio_discount(uuid,uuid,numeric,text,text) to authenticated,service_role;
grant execute on function public.fn_transfer_folio_charges(uuid,uuid[],uuid,text) to authenticated,service_role;

notify pgrst,'reload schema';
