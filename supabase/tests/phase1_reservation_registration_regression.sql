-- Runtime regression suite. Run only against the disposable Phase 1 test database.
begin;
do $$
declare
  v_property uuid := gen_random_uuid();
  v_room_one uuid := gen_random_uuid();
  v_room_two uuid := gen_random_uuid();
  v_blocked_room uuid := gen_random_uuid();
  v_rate_plan uuid := gen_random_uuid();
  v_result_count integer;
  v_guest_one uuid;
  v_guest_two uuid;
  v_submission text := 'phase1-idempotency-001';
  v_details jsonb;
  v_error text;
begin
  insert into public.properties(id) values (v_property);
  insert into public.rooms(id,property_id,number,capacity,status) values
    (v_room_one,v_property,101,2,'available'),
    (v_room_two,v_property,102,2,'available'),
    (v_blocked_room,v_property,103,2,'blocked');
  insert into public.rate_plans(id,property_id,name,active) values (v_rate_plan,v_property,'Bed & Breakfast',true);

  select count(*) into v_result_count
  from public.fn_create_reservation_bundle(
    v_property,array[v_room_one],null,'Ada Lovelace','+254700000001',
    date '2026-12-01',date '2026-12-04','partially_paid','direct','bb',2,0,'[]'::jsonb,30000,15000,'Phase 1 test',
    jsonb_build_object(
      'guest',jsonb_build_object('email','ADA@example.com','nationality','Kenyan','idNumber','P12345','alternativePhone','+254711000001'),
      'booking',jsonb_build_object('submissionId',v_submission,'ratePlanId',v_rate_plan,'accommodationSubtotal',30000,'source','direct','depositMethod','mpesa')
    )
  );
  if v_result_count <> 1 then raise exception 'Expected one reservation row, got %',v_result_count; end if;
  select guest_id,booking_details into v_guest_one,v_details from public.reservations where room_id=v_room_one;
  if v_details->>'ratePlanId' <> v_rate_plan::text then raise exception 'Rate plan metadata was not persisted'; end if;
  if v_details->>'submissionId' <> v_submission then raise exception 'Idempotency key was not persisted'; end if;
  if not exists(select 1 from public.guests where id=v_guest_one and lower(email)='ada@example.com' and id_number='P12345' and alternative_phone='+254711000001') then
    raise exception 'Guest metadata was not persisted';
  end if;
  if not exists(select 1 from public.payments where reservation_id=(select id from public.reservations where room_id=v_room_one) and amount=15000 and method='mpesa' and status='posted') then
    raise exception 'Received deposit was not posted to the payment ledger';
  end if;
  if (select amount_paid from public.reservations where room_id=v_room_one) <> 15000 then
    raise exception 'Reservation paid total does not reconcile to the posted deposit';
  end if;

  -- Same email, changed primary phone, separate room: must reuse the guest profile.
  perform * from public.fn_create_reservation_bundle(
    v_property,array[v_room_two],null,'Ada Lovelace','+254700000099',
    date '2026-12-05',date '2026-12-07','not_paid','unknown','bed_only',1,0,'[]'::jsonb,20000,0,'Repeat guest',
    jsonb_build_object('guest',jsonb_build_object('email','ada@example.com'),'booking',jsonb_build_object('submissionId','phase1-repeat-002','accommodationSubtotal',20000))
  );
  select guest_id into v_guest_two from public.reservations where room_id=v_room_two;
  if v_guest_one <> v_guest_two then raise exception 'Email-based guest matching created a duplicate profile'; end if;
  if (select count(*) from public.guests where property_id=v_property) <> 1 then raise exception 'Expected one guest profile'; end if;

  -- Idempotent retry returns the original reservation rather than duplicating it.
  select count(*) into v_result_count from public.fn_create_reservation_bundle(
    v_property,array[v_room_one],null,'Ada Lovelace','+254700000001',
    date '2026-12-01',date '2026-12-04','partially_paid','direct','bb',2,0,'[]'::jsonb,30000,15000,'Retry',
    jsonb_build_object('guest',jsonb_build_object('email','ada@example.com'),'booking',jsonb_build_object('submissionId',v_submission))
  );
  if v_result_count <> 1 or (select count(*) from public.reservations where booking_details->>'submissionId'=v_submission) <> 1 then
    raise exception 'Duplicate submission was not idempotent';
  end if;
  if (select count(*) from public.payments where reservation_id=(select id from public.reservations where room_id=v_room_one)) <> 1 then
    raise exception 'Idempotent retry duplicated the deposit payment';
  end if;

  -- Invalid capacity and unavailable operational status must fail closed.
  v_error := null;
  begin
    perform * from public.fn_create_reservation_bundle(
      v_property,array[v_room_one],null,'Too Many Guests','+254700000002',
      date '2026-12-10',date '2026-12-11','not_paid','direct','bed_only',3,0,'[]'::jsonb,10000,0,'Capacity test','{}'::jsonb
    );
  exception when others then get stacked diagnostics v_error = message_text;
  end;
  if v_error is null or v_error not ilike '%capacity%' then raise exception 'Capacity check failed or returned an unexpected error: %',v_error; end if;

  v_error := null;
  begin
    perform * from public.fn_create_reservation_bundle(
      v_property,array[v_blocked_room],null,'Blocked Room Guest','+254700000003',
      date '2026-12-10',date '2026-12-11','not_paid','direct','bed_only',1,0,'[]'::jsonb,10000,0,'Blocked test','{}'::jsonb
    );
  exception when others then get stacked diagnostics v_error = message_text;
  end;
  if v_error is null or v_error not ilike '%operational status%' then raise exception 'Blocked room check failed or returned an unexpected error: %',v_error; end if;

  -- Overlapping dates and invalid payment amounts must be rejected.
  v_error := null;
  begin
    perform * from public.fn_create_reservation_bundle(
      v_property,array[v_room_one],null,'Overlap Guest','+254700000004',
      date '2026-12-02',date '2026-12-03','not_paid','direct','bed_only',1,0,'[]'::jsonb,10000,0,'Overlap test','{}'::jsonb
    );
  exception when others then get stacked diagnostics v_error = message_text;
  end;
  if v_error is null or v_error not ilike '%already reserved%' then raise exception 'Overlap check failed or returned an unexpected error: %',v_error; end if;

  v_error := null;
  begin
    perform * from public.fn_create_reservation_bundle(
      v_property,array[v_room_two],null,'Invalid Payment','+254700000005',
      date '2026-12-10',date '2026-12-11','fully_paid','direct','bed_only',1,0,'[]'::jsonb,10000,12000,'Overpayment test','{}'::jsonb
    );
  exception when others then get stacked diagnostics v_error = message_text;
  end;
  if v_error is null or v_error not ilike '%Amount Paid cannot exceed Total Amount%' then raise exception 'Payment validation failed or returned an unexpected error: %',v_error; end if;
end;
$$;
rollback;
