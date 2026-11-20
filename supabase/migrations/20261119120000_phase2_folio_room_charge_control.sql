-- Phase 2 — folio and room charge control.
--
-- Adds the dimensions the manual Room Charge Control sheet carries (business
-- date, ticket number, board, revenue department, cashier) to the existing
-- folio ledger, and the operations a hotel actually needs: settle a folio with
-- split tender, post nightly accommodation with board supplements, gate
-- checkout on an open balance and allow a permissioned override.
--
-- Nothing is deleted and no existing column changes type. Every function that
-- already exists keeps its signature.

-- ---------------------------------------------------------------------------
-- 1. Folio charge dimensions
-- ---------------------------------------------------------------------------
alter table public.folio_charges
  add column if not exists business_date date,
  add column if not exists ticket_number text,
  add column if not exists board_plan text,
  add column if not exists department_id uuid references public.revenue_departments(id) on delete set null,
  add column if not exists receipt_id uuid references public.pos_receipts(id) on delete set null,
  add column if not exists cashier_id uuid references auth.users(id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'folio_charges_board_plan_check'
      and conrelid = 'public.folio_charges'::regclass
  ) then
    alter table public.folio_charges
      add constraint folio_charges_board_plan_check
      check (board_plan is null or board_plan in ('bed_only', 'bb', 'half_board', 'full_board'));
  end if;
end $$;

-- Backfill only what the data already proves: the posting date (Nairobi local
-- date of the recorded timestamp) and the board stored on the reservation.
update public.folio_charges c
   set business_date = (c.created_at at time zone 'Africa/Nairobi')::date
 where c.business_date is null;

update public.folio_charges c
   set board_plan = r.meal_plan
  from public.reservations r
 where r.id = c.reservation_id
   and c.board_plan is null
   and r.meal_plan in ('bed_only', 'bb', 'half_board', 'full_board');

alter table public.folio_charges
  alter column business_date set default ((now() at time zone 'Africa/Nairobi')::date);
alter table public.folio_charges
  alter column business_date set not null;

-- Two charges may never share a ticket number in one property. This is the
-- defect the manual sheet carries twice (`13-3918`).
create unique index if not exists folio_charges_property_ticket_uidx
  on public.folio_charges(property_id, ticket_number)
  where ticket_number is not null;
create index if not exists folio_charges_property_business_date_idx
  on public.folio_charges(property_id, business_date);
create index if not exists folio_charges_department_idx
  on public.folio_charges(department_id)
  where department_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Business date
-- ---------------------------------------------------------------------------
create or replace function public.fn_current_business_date(p_property_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select business_date from public.property_business_dates where property_id = p_property_id),
    (now() at time zone 'Africa/Nairobi')::date
  );
$$;

grant execute on function public.fn_current_business_date(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Posting defaults: business date, board, department, cashier and ticket
-- ---------------------------------------------------------------------------
create or replace function public.fn_folio_charge_control_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_department_code text;
  v_prefix text;
begin
  if new.business_date is null then
    select business_date into new.business_date
      from public.property_business_dates
     where property_id = new.property_id;
  end if;
  if new.business_date is null then
    new.business_date := (now() at time zone 'Africa/Nairobi')::date;
  end if;

  if new.board_plan is null then
    select meal_plan into new.board_plan
      from public.reservations
     where id = new.reservation_id;
    if new.board_plan is not null
       and new.board_plan not in ('bed_only', 'bb', 'half_board', 'full_board') then
      new.board_plan := null;
    end if;
  end if;

  if new.cashier_id is null then
    new.cashier_id := auth.uid();
  end if;

  if new.department_id is null then
    v_department_code := case new.category
      when 'accommodation' then 'accommodation'
      when 'restaurant' then 'food'
      when 'bar' then 'beverages'
      when 'room_service' then 'food'
      when 'laundry' then 'laundry'
      when 'airport_transfer' then 'transfer'
      when 'excursion' then 'extras'
      when 'other_services' then 'extras'
      else null
    end;
    if v_department_code is not null then
      select id into new.department_id
        from public.revenue_departments
       where property_id = new.property_id
         and code = v_department_code
       limit 1;
    end if;
  end if;

  -- POS charges already carry their receipt number and reversals/credits are
  -- not sales; only positive manual and accommodation postings take a new
  -- ticket number from the property book.
  if new.ticket_number is null
     and coalesce(new.source, '') <> 'pos'
     and new.reversal_of_id is null
     and new.amount > 0
     and auth.uid() is not null then
    new.ticket_number := public.fn_allocate_document_number(new.property_id, 'receipt', null);
  end if;

  return new;
end;
$$;

drop trigger if exists folio_charges_control_defaults on public.folio_charges;
create trigger folio_charges_control_defaults
  before insert on public.folio_charges
  for each row execute function public.fn_folio_charge_control_defaults();

-- A POS receipt linked to a folio charge becomes that charge's receipt number.
create or replace function public.fn_folio_charge_receipt_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.folio_charge_id is not null then
    update public.folio_charges
       set receipt_id = new.id
     where id = new.folio_charge_id
       and receipt_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_receipts_folio_charge_link on public.pos_receipts;
create trigger pos_receipts_folio_charge_link
  after insert or update of folio_charge_id on public.pos_receipts
  for each row execute function public.fn_folio_charge_receipt_link();

-- ---------------------------------------------------------------------------
-- 4. Quick room charge with ticket validation
-- ---------------------------------------------------------------------------
create or replace function public.fn_post_room_charge(
  p_property_id uuid,
  p_reservation_id uuid,
  p_description text,
  p_amount numeric,
  p_ticket_number text default null,
  p_board_plan text default null,
  p_idempotency_key text default null
) returns public.folio_charges
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.reservations;
  c public.folio_charges;
  key text;
  ticket text;
  v_business_date date;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Access denied.';
  end if;
  if public.current_staff_role(p_property_id) is not null
     and public.current_staff_role(p_property_id) not in (
       'hotel_admin','super_admin','cashier','fb_manager','front_office_manager',
       'general_manager','property_manager','reception','receptionist','front_desk') then
    raise exception 'Folio charge permission required.';
  end if;
  if public.current_staff_role(p_property_id) is null
     and not (public.is_platform_owner()
              or public.property_role(p_property_id) in (
                'owner','admin','manager','cashier','reception','receptionist','front_desk')) then
    raise exception 'Folio charge permission required.';
  end if;

  key := nullif(trim(p_idempotency_key), '');
  if key is null then raise exception 'An idempotency key is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || ':room-charge:' || key, 0));
  select * into c from public.folio_charges
   where property_id = p_property_id and idempotency_key = key;
  if c.id is not null then
    if c.reservation_id <> p_reservation_id
       or c.description <> trim(p_description)
       or c.amount <> round(coalesce(p_amount, 0), 2) then
      raise exception 'Idempotency key was already used for a different room charge.';
    end if;
    return c;
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Charge amount must be greater than zero.';
  end if;
  if nullif(trim(p_description), '') is null then
    raise exception 'Charge description is required.';
  end if;
  if p_board_plan is not null
     and p_board_plan not in ('bed_only', 'bb', 'half_board', 'full_board') then
    raise exception 'Unsupported board plan.';
  end if;

  ticket := nullif(upper(trim(p_ticket_number)), '');
  if ticket is not null then
    if ticket !~ '^[0-9]{1,4}-[0-9]{1,6}$' then
      raise exception 'Ticket numbers must look like 13-3951.';
    end if;
    if exists (
      select 1 from public.folio_charges f
       where f.property_id = p_property_id and f.ticket_number = ticket
    ) then
      raise exception 'Ticket % has already been used on another charge.', ticket;
    end if;
    if exists (
      select 1 from public.pos_receipts pr
       where pr.property_id = p_property_id
         and pr.receipt_number = ticket
         and pr.receipt_status = 'posted'
    ) then
      raise exception 'Ticket % belongs to a posted POS receipt.', ticket;
    end if;
  end if;

  select * into r from public.reservations
   where id = p_reservation_id and property_id = p_property_id
   for update;
  if r.id is null or r.status in ('cancelled', 'checked-out') then
    raise exception 'An active reservation is required.';
  end if;

  v_business_date := public.fn_current_business_date(p_property_id);

  insert into public.folio_charges(
    property_id, reservation_id, source, description, amount, category, quantity,
    unit_price, reference, source_module, created_by, idempotency_key,
    business_date, board_plan, ticket_number
  ) values (
    p_property_id, r.id, 'other', trim(p_description), round(p_amount, 2),
    'other_services', 1, round(p_amount, 2),
    coalesce(ticket, 'FOL-' || upper(substr(gen_random_uuid()::text, 1, 8))),
    'room_charge', auth.uid(), key,
    v_business_date,
    coalesce(p_board_plan, r.meal_plan),
    ticket
  )
  returning * into c;

  return c;
end;
$$;

revoke all on function public.fn_post_room_charge(uuid, uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.fn_post_room_charge(uuid, uuid, text, numeric, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Settlement: one atomic operation for every tender line
-- ---------------------------------------------------------------------------
create or replace function public.fn_settle_folio(
  p_property_id uuid,
  p_reservation_id uuid,
  p_payments jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.reservations;
  v_line jsonb;
  v_index integer := 0;
  v_method text;
  v_amount numeric;
  key text;
  charges numeric;
  paid numeric;
  booking numeric;
  balance numeric;
  settled numeric := 0;
  payment_ids uuid[];
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Access denied.';
  end if;
  if not public.fn_has_permission(p_property_id, 'folio.settle') then
    raise exception 'Settlement permission required.';
  end if;
  if public.current_staff_role(p_property_id) is not null
     and public.current_staff_role(p_property_id) not in (
       'hotel_admin','super_admin','cashier','fb_manager','front_office_manager',
       'general_manager','property_manager','reception','receptionist','front_desk') then
    raise exception 'Settlement permission required.';
  end if;

  key := nullif(trim(p_idempotency_key), '');
  if key is null then raise exception 'An idempotency key is required.'; end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) = 0 then
    raise exception 'At least one payment line is required.';
  end if;

  select * into r from public.reservations
   where id = p_reservation_id and property_id = p_property_id
   for update;
  if r.id is null or r.status = 'cancelled' then
    raise exception 'Reservation not found or cancelled.';
  end if;

  select coalesce(sum(amount), 0) into charges
    from public.folio_charges where reservation_id = r.id;
  select coalesce(sum(amount), 0) into paid
    from public.payments
   where reservation_id = r.id and status = 'posted';
  booking := greatest(
    charges,
    coalesce(nullif(r.total_amount, 0), coalesce(r.rate, 0) * greatest(1, r.departure - r.arrival))
  );
  balance := greatest(0, booking - paid);
  if balance <= 0.005 then
    raise exception 'This folio has no outstanding balance.';
  end if;

  for v_line in select * from jsonb_array_elements(p_payments) loop
    v_amount := round(coalesce((v_line ->> 'amount')::numeric, 0), 2);
    v_method := nullif(trim(v_line ->> 'method'), '');
    if v_amount <= 0 then
      raise exception 'Every payment line needs an amount greater than zero.';
    end if;
    if v_method is null or v_method not in ('cash','mpesa','card','bank_transfer','other') then
      raise exception 'Unsupported payment method on a settlement line.';
    end if;
    settled := settled + v_amount;
  end loop;

  if settled > balance + 0.005 then
    raise exception 'Settlement of % exceeds the outstanding folio balance of %.',
      round(settled, 2), round(balance, 2);
  end if;

  v_index := 0;
  for v_line in select * from jsonb_array_elements(p_payments) loop
    v_index := v_index + 1;
    perform public.fn_post_folio_payment(
      p_property_id,
      p_reservation_id,
      round((v_line ->> 'amount')::numeric, 2),
      trim(v_line ->> 'method'),
      nullif(trim(v_line ->> 'reference'), ''),
      'settle:' || key || ':' || v_index::text,
      nullif(trim(v_line ->> 'chargeId'), '')::uuid
    );
  end loop;

  select array_agg(id order by created_at) into payment_ids
    from public.payments
   where property_id = p_property_id
     and reservation_id = p_reservation_id
     and idempotency_key like 'settle:' || key || ':%';

  select coalesce(sum(amount), 0) into paid
    from public.payments
   where reservation_id = p_reservation_id and status = 'posted';

  return jsonb_build_object(
    'reservationId', p_reservation_id,
    'settledTotal', round(settled, 2),
    'paymentsTotal', round(paid, 2),
    'outstandingBalance', round(greatest(0, booking - paid), 2),
    'paymentIds', to_jsonb(coalesce(payment_ids, '{}'::uuid[]))
  );
end;
$$;

revoke all on function public.fn_settle_folio(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.fn_settle_folio(uuid, uuid, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Nightly accommodation posting (including board supplements)
-- ---------------------------------------------------------------------------
create or replace function public.fn_post_accommodation_charges(
  p_property_id uuid,
  p_business_date date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.reservations;
  v_business_date date;
  v_nights integer;
  v_rate numeric;
  v_board_amount numeric;
  v_room_number text;
  v_board_label text;
  v_posted integer := 0;
  v_supplements integer := 0;
  v_skipped integer := 0;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Access denied.';
  end if;
  if not public.fn_has_permission(p_property_id, 'nightaudit.run') then
    raise exception 'Night audit permission is required to post accommodation.';
  end if;

  v_business_date := coalesce(p_business_date, public.fn_current_business_date(p_property_id));
  if v_business_date > public.fn_current_business_date(p_property_id) then
    raise exception 'Accommodation cannot be posted for a future business date.';
  end if;
  if exists (
    select 1 from public.night_audits
     where property_id = p_property_id and business_date = v_business_date
  ) then
    raise exception 'Business date % is closed; accommodation cannot be posted.', v_business_date;
  end if;

  for r in
    select res.* from public.reservations res
     where res.property_id = p_property_id
       and res.status in ('checked-in', 'booked', 'confirmed')
       and res.arrival <= v_business_date
       and res.departure > v_business_date
     order by res.arrival, res.id
  loop
    v_nights := greatest(1, r.departure - r.arrival);
    v_rate := coalesce(nullif(r.rate, 0), round(coalesce(r.total_amount, 0) / v_nights, 2));
    if v_rate is null or v_rate <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select rm.number::text into v_room_number from public.rooms rm where rm.id = r.room_id;

    if not exists (
      select 1 from public.folio_charges f
       where f.property_id = p_property_id
         and f.idempotency_key = 'night:' || r.id::text || ':' || v_business_date::text
    ) then
      perform public.fn_post_folio_charge(
        p_property_id, r.id, 'accommodation',
        'Accommodation ' || v_business_date::text || ' · Room ' || coalesce(v_room_number, '—'),
        1, v_rate, v_room_number,
        'night:' || r.id::text || ':' || v_business_date::text
      );
      v_posted := v_posted + 1;
    end if;

    v_board_amount := null;
    select bs.nightly_amount into v_board_amount
      from public.board_supplements bs
     where bs.property_id = p_property_id
       and bs.meal_plan = r.meal_plan
       and bs.active
       and (bs.room_type_id is null
            or bs.room_type_id = (select rm.room_type_id from public.rooms rm where rm.id = r.room_id))
     order by bs.room_type_id nulls last
     limit 1;

    if coalesce(v_board_amount, 0) > 0 then
      v_board_label := case r.meal_plan
        when 'bb' then 'Bed & breakfast'
        when 'half_board' then 'Half board'
        when 'full_board' then 'Full board'
        else 'Board'
      end;
      if not exists (
        select 1 from public.folio_charges f
         where f.property_id = p_property_id
           and f.idempotency_key = 'night-board:' || r.id::text || ':' || v_business_date::text
      ) then
        perform public.fn_post_folio_charge(
          p_property_id, r.id, 'accommodation',
          v_board_label || ' supplement ' || v_business_date::text || ' · Room ' || coalesce(v_room_number, '—'),
          1, v_board_amount, v_room_number,
          'night-board:' || r.id::text || ':' || v_business_date::text
        );
        v_supplements := v_supplements + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'businessDate', v_business_date,
    'accommodationPosted', v_posted,
    'boardSupplementsPosted', v_supplements,
    'skippedWithoutRate', v_skipped
  );
end;
$$;

revoke all on function public.fn_post_accommodation_charges(uuid, date) from public, anon;
grant execute on function public.fn_post_accommodation_charges(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Checkout gate: the permissioned override with an audit record
-- ---------------------------------------------------------------------------
create table if not exists public.folio_unpaid_departures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete set null,
  balance numeric(12,2) not null check (balance >= 0),
  reason text not null,
  approved_by uuid references auth.users(id),
  business_date date not null default ((now() at time zone 'Africa/Nairobi')::date),
  created_at timestamptz not null default now()
);
create index if not exists folio_unpaid_departures_property_idx
  on public.folio_unpaid_departures(property_id, created_at desc);

alter table public.folio_unpaid_departures enable row level security;

drop policy if exists folio_unpaid_departures_select on public.folio_unpaid_departures;
create policy folio_unpaid_departures_select on public.folio_unpaid_departures
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_check_out_room_with_override(
  p_room_id uuid,
  p_reason text
) returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations;
  v_charges numeric;
  v_paid numeric;
  v_balance numeric;
begin
  select r.* into v_res
    from public.reservations r
   where r.room_id = p_room_id
     and r.status = 'checked-in'
   for update;
  if v_res.id is null then
    raise exception 'No checked-in reservation found for this room.';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(v_res.property_id)) then
    raise exception 'Access denied.';
  end if;
  if not public.fn_has_permission(v_res.property_id, 'folio.override_unpaid_checkout') then
    raise exception 'Manager approval is required to check out with an open balance.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required to check out with an open balance.';
  end if;

  select coalesce(sum(c.amount), 0) into v_charges
    from public.folio_charges c where c.reservation_id = v_res.id;
  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p where p.reservation_id = v_res.id and p.status = 'posted';
  v_balance := greatest(0, v_charges - v_paid);

  if v_balance <= 0.005 then
    raise exception 'The folio is settled; use the normal checkout.';
  end if;

  insert into public.folio_unpaid_departures(
    property_id, reservation_id, room_id, balance, reason, approved_by, business_date
  ) values (
    v_res.property_id, v_res.id, p_room_id, round(v_balance, 2), trim(p_reason), auth.uid(),
    public.fn_current_business_date(v_res.property_id)
  );

  update public.reservations
     set status = 'checked-out',
         amount_paid = v_paid
   where id = v_res.id;
  update public.rooms
     set status = 'dirty'
   where id = p_room_id and property_id = v_res.property_id;

  if not exists (
    select 1 from public.housekeeping_tasks
     where room_id = p_room_id and task_type = 'checkout_clean'
       and status not in ('completed', 'cancelled')
  ) then
    insert into public.housekeeping_tasks(
      property_id, room_id, task_type, priority, status, reservation_id, notes, due_at
    ) values (
      v_res.property_id, p_room_id, 'checkout_clean', 'high', 'pending', v_res.id,
      'Checkout with open balance of ' || round(v_balance, 2)::text || ': ' || trim(p_reason), now()
    );
  end if;

  insert into public.audit_logs(
    actor_id, property_id, action, old_value, new_value, entity_type, entity_id, related_reservation_id
  ) values (
    auth.uid(), v_res.property_id, 'folio_unpaid_checkout',
    jsonb_build_object('status', v_res.status, 'balance', round(v_balance, 2)),
    jsonb_build_object('status', 'checked-out', 'reason', trim(p_reason), 'balance', round(v_balance, 2)),
    'reservation', v_res.id, v_res.id
  );

  return (select * from public.reservations where id = v_res.id);
end;
$$;

revoke all on function public.fn_check_out_room_with_override(uuid, text) from public, anon;
grant execute on function public.fn_check_out_room_with_override(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. A reversal is also the void record of the original charge
-- ---------------------------------------------------------------------------
create or replace function public.fn_reverse_folio_charge(p_property_id uuid, p_charge_id uuid, p_reason text)
returns public.folio_charges
language plpgsql security invoker set search_path=public
as $$
declare c public.folio_charges; rev public.folio_charges; manager boolean;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 select * into c from public.folio_charges where id=p_charge_id and property_id=p_property_id for update;
 if c.id is null then raise exception 'Folio charge not found.'; end if;
 manager:=coalesce(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager'),false);
 if not (manager or public.fn_has_permission(p_property_id,'folio.void')) then raise exception 'Manager approval is required to reverse a posted charge.'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'A reversal reason is required.'; end if;
 if c.voided_at is not null or exists(select 1 from public.folio_charges where reversal_of_id=c.id) then raise exception 'This charge has already been reversed.'; end if;
 if exists(select 1 from public.payments where folio_charge_id=c.id and status='posted' and amount>0) then raise exception 'Reverse the allocated payment before voiding this charge.'; end if;
 update public.folio_charges set voided_at=now(), voided_by=auth.uid(), void_reason=trim(p_reason) where id=c.id;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,reversal_of_id,business_date,board_plan,department_id,cashier_id)
 values(c.property_id,c.reservation_id,'adjustment','Reversal: '||c.description,-c.amount,c.category,c.quantity,c.unit_price,
 'REV-'||upper(substr(gen_random_uuid()::text,1,8)),'folio',auth.uid(),c.id,
 public.fn_current_business_date(p_property_id),c.board_plan,c.department_id,auth.uid()) returning * into rev;
 insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_charge_reversed',to_jsonb(c),jsonb_build_object('reversal_id',rev.id,'reason',trim(p_reason)), 'folio_charge',c.id,c.reservation_id);
 return rev;
end; $$;

-- ---------------------------------------------------------------------------
-- 9. Open balances read model
-- ---------------------------------------------------------------------------
create or replace view public.folio_open_balances
with (security_invoker = true) as
select
  r.property_id,
  r.id as reservation_id,
  r.guest_name,
  r.phone,
  r.channel,
  r.status,
  r.arrival,
  r.departure,
  r.meal_plan,
  r.room_id,
  rm.number as room_number,
  coalesce(c.charges_total, 0)::numeric(12,2) as charges_total,
  coalesce(p.payments_total, 0)::numeric(12,2) as payments_total,
  round(coalesce(c.charges_total, 0) - coalesce(p.payments_total, 0), 2) as balance,
  coalesce(c.charge_count, 0)::integer as charge_count,
  c.first_business_date,
  c.last_business_date
from public.reservations r
left join public.rooms rm on rm.id = r.room_id
left join (
  select reservation_id,
         sum(amount) as charges_total,
         count(*) filter (where amount > 0) as charge_count,
         min(business_date) as first_business_date,
         max(business_date) as last_business_date
    from public.folio_charges
   group by reservation_id
) c on c.reservation_id = r.id
left join (
  select reservation_id, sum(amount) as payments_total
    from public.payments
   where status = 'posted'
   group by reservation_id
) p on p.reservation_id = r.id
where r.status <> 'cancelled';

grant select on public.folio_open_balances to authenticated;

notify pgrst, 'reload schema';
