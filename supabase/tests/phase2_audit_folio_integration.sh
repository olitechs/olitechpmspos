#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=pms_folio_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/fixtures/phase2_audit_folio_schema.sql"
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/20261009100000_phase2_pms_audit_trail.sql"
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/20261009103000_phase2_folio_payment_reconciliation.sql"

PROPERTY='50000000-0000-0000-0000-000000000001'
ROOM='60000000-0000-0000-0000-000000000001'
RES='70000000-0000-0000-0000-000000000001'
CHECKOUT_ROOM='60000000-0000-0000-0000-000000000002'
CHECKOUT_RES='70000000-0000-0000-0000-000000000002'

psql -v ON_ERROR_STOP=1 <<SQL
insert into rooms(id,property_id,number,status) values
 ('$ROOM','$PROPERTY',101,'available'),
 ('$CHECKOUT_ROOM','$PROPERTY',102,'occupied');

insert into reservations(id,property_id,room_id,guest_name,arrival,departure,status,rate,payment_status,total_amount,amount_paid,channel,meal_plan)
values
 ('$RES','$PROPERTY','$ROOM','Test Guest','2026-12-01','2026-12-05','booked',250,'not_paid',1000,0,'direct','bed_only'),
 ('$CHECKOUT_RES','$PROPERTY','$CHECKOUT_ROOM','Checkout Guest','2026-12-01','2026-12-02','checked-in',300,'fully_paid',300,300,'direct','bed_only');

-- First deposit must meet the 50% threshold; subsequent tender reconciles
-- against the remaining booking total.
select public.fn_record_front_desk_payment('$PROPERTY','$RES',500,'cash',null);
select public.fn_record_front_desk_payment('$PROPERTY','$RES',500,'mpesa',null);

do $assert$
declare v_paid numeric; v_balance numeric; v_events integer;
begin
  select amount_paid into v_paid from reservations where id='$RES';
  if v_paid <> 1000 then raise exception 'Expected booking amount_paid=1000, got %',v_paid; end if;
  select balance into v_balance from folio_totals where reservation_id='$RES';
  if v_balance <> 0 then raise exception 'Expected non-negative folio balance 0, got %',v_balance; end if;
  select count(*) into v_events from audit_logs where related_reservation_id='$RES';
  if v_events < 3 then raise exception 'Expected reservation/payment audit events, got %',v_events; end if;
end;
$assert$;

-- The first payment cannot be below the required deposit threshold.
do $reject$
begin
  begin
    perform public.fn_record_front_desk_payment('$PROPERTY',
      '70000000-0000-0000-0000-000000000003',100,'cash',null);
    raise exception 'Expected low initial deposit to be rejected';
  exception when others then
    if sqlerrm = 'Expected low initial deposit to be rejected' then raise; end if;
    if position('at least 50%' in sqlerrm)=0 then raise; end if;
  end;
end;
$reject$;

insert into folio_charges(property_id,reservation_id,source,description,amount)
values('$PROPERTY','$CHECKOUT_RES','room','Room charge',300);
insert into payments(property_id,reservation_id,amount,method,status)
values('$PROPERTY','$CHECKOUT_RES',300,'cash','posted');

select public.fn_check_out_room('$CHECKOUT_ROOM');

do $checkout$
declare v_status text; v_room_status text; v_tasks integer;
begin
  select status into v_status from reservations where id='$CHECKOUT_RES';
  select status into v_room_status from rooms where id='$CHECKOUT_ROOM';
  select count(*) into v_tasks from housekeeping_tasks where room_id='$CHECKOUT_ROOM' and task_type='checkout_clean';
  if v_status <> 'checked-out' then raise exception 'Checkout did not update reservation status: %',v_status; end if;
  if v_room_status <> 'dirty' then raise exception 'Checkout did not dirty the room: %',v_room_status; end if;
  if v_tasks <> 1 then raise exception 'Checkout did not create exactly one housekeeping task: %',v_tasks; end if;
end;
$checkout$;

echo "Phase 2 audit/folio PostgreSQL integration checks passed."
