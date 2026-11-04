-- Re-run against the corrected Phase 2 migration delimiter.
-- Run after phase2_folio_setup.sql and 20261105100000_phase2_guest_folio_management.sql.
do $$
declare p uuid:='10000000-0000-0000-0000-000000000001'; r1 uuid:='30000000-0000-0000-0000-000000000001'; r2 uuid:='30000000-0000-0000-0000-000000000002';
 c1 public.folio_charges; c2 public.folio_charges; c3 public.folio_charges; pay1 public.payments; pay2 public.payments; refund public.payments;
 n integer; charge_sum numeric; payment_sum numeric; balance numeric; moved integer; duplicate_count integer;
begin
 perform set_config('test.staff_role','hotel_admin',true);
 perform set_config('test.member','true',true);
 c1:=public.fn_post_folio_charge(p,r1,'accommodation','Room 101 accommodation',2,500,'ROOM-101','charge-key-room');
 c2:=public.fn_post_folio_charge(p,r1,'laundry','Laundry service',2,100,'LAU-001','charge-key-laundry');
 if c1.id<>(public.fn_post_folio_charge(p,r1,'accommodation','Room 101 accommodation',2,500,'ROOM-101','charge-key-room')).id then raise exception 'Charge idempotency failed.'; end if;
 pay1:=public.fn_post_folio_payment(p,r1,250,'cash','CASH-001','pay-key-1',c1.id);
 if pay1.folio_charge_id<>c1.id then raise exception 'Payment allocation to accommodation charge was not persisted.'; end if;
 if pay1.id<>(public.fn_post_folio_payment(p,r1,250,'cash','CASH-001','pay-key-1')).id then raise exception 'Payment idempotency failed.'; end if;
 pay2:=public.fn_post_folio_payment(p,r1,750,'mpesa','MPESA-002','pay-key-2');
 select count(*) into duplicate_count from public.payments where reservation_id=r1 and idempotency_key in ('pay-key-1','pay-key-2');
 if duplicate_count<>2 then raise exception 'Duplicate payments were posted.'; end if;
 refund:=public.fn_post_folio_refund(p,pay2.id,100,'mpesa','Guest cancellation','refund-key-1');
 if refund.amount<>-100 then raise exception 'Refund must create a negative payment ledger entry.'; end if;
 if (select status from public.payments where id=pay2.id)<>'posted' then raise exception 'Original payment must remain in history after partial refund.'; end if;
 perform public.fn_reverse_folio_charge(p,c2.id,'Incorrect laundry quantity');
 if not exists(select 1 from public.folio_charges where reversal_of_id=c2.id and amount=-c2.amount) then raise exception 'Charge reversal entry missing.'; end if;
 perform public.fn_apply_folio_discount(p,r1,100,'Manager-approved goodwill discount','discount-key-1');
 select coalesce(sum(amount),0) into charge_sum from public.folio_charges where reservation_id=r1;
 select coalesce(sum(amount),0) into payment_sum from public.payments where reservation_id=r1 and status='posted';
 balance:=charge_sum-payment_sum;
 if round(balance,2)<>0 then raise exception 'Full settlement reconciliation failed: %',balance; end if;
 -- Split a charge to a second folio, then consolidate it back.
 c3:=public.fn_post_folio_charge(p,r1,'excursion','Marine excursion',1,80,'EX-001','charge-key-excursion');
 moved:=public.fn_transfer_folio_charges(p,array[c3.id],r2,'Split excursion charge to second guest account');
 if moved<>1 or (select reservation_id from public.folio_charges where id=c3.id)<>r2 then raise exception 'Folio split / transfer failed.'; end if;
 moved:=public.fn_transfer_folio_charges(p,array[c3.id],r1,'Consolidate excursion charge back to primary account');
 if moved<>1 or (select reservation_id from public.folio_charges where id=c3.id)<>r1 then raise exception 'Folio consolidation failed.'; end if;
 -- Permission denial is enforced in the database, not just hidden in the UI.
 perform set_config('test.staff_role','reception',true);
 begin
   perform public.fn_apply_folio_discount(p,r1,1,'Unauthorised discount','discount-denied');
   raise exception 'Reception role unexpectedly applied a discount.';
 exception when others then
   if sqlerrm='Reception role unexpectedly applied a discount.' then raise; end if;
 end;
 begin
   perform public.fn_post_folio_refund(p,pay1.id,1,'cash','Unauthorised refund','refund-denied');
   raise exception 'Reception role unexpectedly refunded a payment.';
 exception when others then
   if sqlerrm='Reception role unexpectedly refunded a payment.' then raise; end if;
 end;
 begin
   perform public.fn_reverse_folio_charge(p,c3.id,'Unauthorised reversal');
   raise exception 'Reception role unexpectedly reversed a charge.';
 exception when others then
   if sqlerrm='Reception role unexpectedly reversed a charge.' then raise; end if;
 end;
 begin
   perform public.fn_transfer_folio_charges(p,array[c3.id],r2,'Unauthorised transfer');
   raise exception 'Reception role unexpectedly transferred a charge.';
 exception when others then
   if sqlerrm='Reception role unexpectedly transferred a charge.' then raise; end if;
 end;
 perform set_config('test.member','false',true);
 begin
   perform public.fn_post_folio_payment(p,r1,1,'cash',null,'tenant-denied');
   raise exception 'Cross-property payment unexpectedly succeeded.';
 exception when others then
   if sqlerrm='Cross-property payment unexpectedly succeeded.' then raise; end if;
 end;
 raise notice 'Phase 2 folio regression passed: idempotency, charges, split/partial/full payments, refund, reversal, discount, transfer, consolidation and permissions.';
end $$;
