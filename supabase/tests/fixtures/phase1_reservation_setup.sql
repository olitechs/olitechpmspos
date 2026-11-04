-- Disposable PostgreSQL baseline for the Phase 1 reservation migration tests.
-- This is deliberately isolated from production/Supabase credentials.
create extension if not exists pgcrypto;

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

do $$ begin create type public.room_status as enum ('available','occupied','booked','dirty','cleaning','maintenance','out_of_service','blocked'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reservation_status as enum ('booked','checked-in','checked-out','cancelled'); exception when duplicate_object then null; end $$;

create table public.properties (id uuid primary key default gen_random_uuid());
create table public.rooms (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  number integer not null, capacity integer not null default 2, active boolean not null default true,
  status public.room_status not null default 'available'
);
create table public.guests (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  name text not null, phone text, email text, nationality text, id_number text, address text, notes text,
  created_at timestamptz not null default now()
);
create table public.rate_plans (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  name text not null, active boolean not null default true
);
create table public.room_closures (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  room_id uuid not null references public.rooms(id), start_date date not null, end_date date not null,
  reason text not null default 'Closure'
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
  room_id uuid not null references public.rooms(id), guest_id uuid references public.guests(id),
  guest_name text not null, phone text, arrival date not null, departure date not null,
  party_size integer default 1, rate numeric(12,2) default 0, status public.reservation_status not null default 'booked',
  notes text, created_at timestamptz not null default now(), group_id uuid,
  payment_status text not null default 'not_paid', channel text not null default 'direct',
  meal_plan text not null default 'bed_only', adults integer not null default 1, children integer not null default 0,
  kids_count integer not null default 0, kids_ages jsonb not null default '[]'::jsonb,
  total_amount numeric(12,2) not null default 0, amount_paid numeric(12,2) not null default 0,
  special_requests text, rate_plan_id uuid
);

create or replace function public.is_member_of_property(p_property_id uuid)
returns boolean language sql stable as $$ select true $$;
create or replace function public.is_platform_owner()
returns boolean language sql stable as $ select false $;

-- Existing front-desk payment RPC contract, included so the migration test
-- verifies that deposits become posted ledger rows rather than metadata only.
create or replace function public.fn_record_front_desk_payment(
  p_property_id uuid, p_reservation_id uuid, p_amount numeric, p_method text, p_shift_id uuid default null
) returns public.payments
language plpgsql security invoker set search_path = public as $
declare
  v_res public.reservations;
  v_payment public.payments;
  v_booking_total numeric;
  v_folio_charges numeric;
  v_paid_before numeric;
  v_expected_total numeric;
  v_outstanding numeric;
  v_paid_after numeric;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'Access denied.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if nullif(trim(p_method), '') is null then raise exception 'Payment method is required.'; end if;
  select * into v_res from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
  if v_res.id is null then raise exception 'Reservation not found.'; end if;
  if v_res.status in ('cancelled','checked-out') then raise exception 'Reservation is not payable.'; end if;
  v_booking_total := greatest(0,coalesce(nullif(v_res.total_amount,0),coalesce(v_res.rate,0)*greatest(1,v_res.departure-v_res.arrival)));
  select coalesce(sum(c.amount),0) into v_folio_charges from public.folio_charges c where c.reservation_id=v_res.id;
  select coalesce(sum(p.amount),0) into v_paid_before from public.payments p where p.reservation_id=v_res.id and p.status='posted';
  v_expected_total := greatest(v_booking_total,v_folio_charges);
  v_outstanding := greatest(0,v_expected_total-v_paid_before);
  if p_amount > v_outstanding + 0.005 then raise exception 'Payment exceeds the current outstanding amount of %.',round(v_outstanding,2); end if;
  if v_paid_before <= 0.005 and v_booking_total > 0 and v_paid_before + round(p_amount,2) < v_booking_total*0.5 - 0.005 then
    raise exception 'The initial payment must be at least 50% of the booking total.';
  end if;
  insert into public.payments(property_id,reservation_id,amount,method,status,shift_id)
  values(p_property_id,p_reservation_id,round(p_amount,2),trim(p_method),'posted',p_shift_id) returning * into v_payment;
  v_paid_after := v_paid_before + v_payment.amount;
  update public.reservations set amount_paid=least(v_booking_total,v_paid_after),
    payment_status=case when v_booking_total>0 and v_paid_after>=v_booking_total-0.005 then 'fully_paid'
      when v_paid_after>0 then 'partially_paid' else 'not_paid' end
  where id=v_res.id;
  return v_payment;
end;
$;

-- Baseline availability RPC is replaced by the Phase 1 migration. The legacy
-- reservation RPC below calls this by signature, as production does.
create or replace function public.fn_check_room_availability(
  p_property_id uuid, p_room_id uuid, p_arrival date, p_departure date,
  p_exclude_reservation_id uuid default null
) returns table(available boolean, conflict_type text, conflict_id uuid, conflict_message text)
language plpgsql as $$
begin
  if p_departure <= p_arrival then
    return query select false, 'invalid_dates'::text, null::uuid, 'Invalid date range.'::text; return;
  end if;
  return query select true, null::text, null::uuid, null::text;
end;
$$;

-- Existing 16-argument production RPC contract, kept unchanged by Phase 1.
create or replace function public.fn_create_reservation_bundle(
  p_property_id uuid, p_room_ids uuid[], p_group_id uuid, p_guest_name text, p_phone text,
  p_arrival date, p_departure date, p_payment_status text, p_channel text, p_meal_plan text,
  p_adults integer, p_kids_count integer, p_kids_ages jsonb, p_total_amount numeric,
  p_amount_paid numeric, p_notes text
) returns setof public.reservations
language plpgsql security invoker as $$
declare
  v_guest_id uuid; v_room_id uuid;
  v_group uuid := case when coalesce(array_length(p_room_ids,1),0) > 1 then coalesce(p_group_id,gen_random_uuid()) else null end;
  v_count integer := greatest(coalesce(array_length(p_room_ids,1),0),1);
  v_total numeric := greatest(coalesce(p_total_amount,0),0);
  v_paid numeric := greatest(coalesce(p_amount_paid,0),0);
  v_share numeric; v_res public.reservations; v_ok boolean; v_type text; v_conflict uuid; v_message text;
begin
  if not public.is_member_of_property(p_property_id) and not public.is_platform_owner() then raise exception 'Access denied'; end if;
  if nullif(trim(p_guest_name),'') is null then raise exception 'Guest name is required'; end if;
  if p_departure <= p_arrival then raise exception 'Check-out must be after check-in'; end if;
  if coalesce(p_adults,0) < 1 or p_adults > 10 then raise exception 'Invalid adult count'; end if;
  if coalesce(p_kids_count,0) < 0 or p_kids_count > 6 then raise exception 'Invalid child count'; end if;
  if p_payment_status not in ('fully_paid','not_paid','partially_paid') then raise exception 'Invalid payment status'; end if;
  if p_channel not in ('direct','booking_com','unknown') then raise exception 'Invalid channel'; end if;
  if p_meal_plan not in ('bed_only','bb','half_board','full_board') then raise exception 'Invalid meal plan'; end if;
  if v_paid > v_total then raise exception 'Amount Paid cannot exceed Total Amount'; end if;
  if p_payment_status='fully_paid' and v_paid<>v_total then raise exception 'Invalid full payment'; end if;
  if p_payment_status='partially_paid' and (v_paid>=v_total or (v_total>0 and v_paid<v_total*0.5)) then raise exception 'Invalid partial payment'; end if;
  if p_payment_status='not_paid' and v_paid<>0 then raise exception 'Invalid unpaid amount'; end if;
  if coalesce(array_length(p_room_ids,1),0)=0 then raise exception 'At least one room is required'; end if;
  if (select count(*) from unnest(p_room_ids) x) <> (select count(distinct x) from unnest(p_room_ids) x) then raise exception 'Duplicate room'; end if;

  for v_room_id in select unnest(p_room_ids) loop
    select a.available,a.conflict_type,a.conflict_id,a.conflict_message into v_ok,v_type,v_conflict,v_message
    from public.fn_check_room_availability(p_property_id,v_room_id,p_arrival,p_departure,null) a;
    if not coalesce(v_ok,false) then raise exception using message=coalesce(v_message,'Room unavailable'); end if;
  end loop;

  if p_phone is not null and trim(p_phone)<>'' then
    select id into v_guest_id from public.guests where property_id=p_property_id and phone=p_phone limit 1;
  end if;
  if v_guest_id is null then
    insert into public.guests(property_id,name,phone) values(p_property_id,trim(p_guest_name),nullif(trim(p_phone),'')) returning id into v_guest_id;
  end if;

  v_share:=round(v_total/v_count,2);
  for v_room_id in select unnest(p_room_ids) loop
    insert into public.reservations(property_id,room_id,guest_id,guest_name,phone,arrival,departure,party_size,rate,status,notes,group_id,payment_status,channel,meal_plan,adults,children,kids_count,kids_ages,total_amount,amount_paid,special_requests)
    values(p_property_id,v_room_id,v_guest_id,trim(p_guest_name),nullif(trim(p_phone),''),p_arrival,p_departure,
      coalesce(p_adults,1)+coalesce(p_kids_count,0),case when v_count=1 then v_total else v_share end,'booked',p_notes,
      v_group,p_payment_status,p_channel,p_meal_plan,p_adults,p_kids_count,p_kids_count,coalesce(p_kids_ages,'[]'::jsonb),
      case when v_count=1 then v_total else v_share end,
      case when v_count=1 then v_paid else v_share*case when v_total>0 then v_paid/v_total else 0 end end,p_notes)
    returning * into v_res;
    return next v_res;
  end loop;
end;
$$;

grant usage on schema public to authenticated, service_role;
grant select,insert,update,delete on all tables in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
