#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=pms_test}"
: "${PGPASSWORD:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/fixtures/phase2_room_inventory_schema.sql"
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/20261101090000_phase2_room_inventory_concurrency.sql"

PROPERTY='10000000-0000-0000-0000-000000000001'
ROOM_A='20000000-0000-0000-0000-000000000001'
ROOM_B='20000000-0000-0000-0000-000000000002'
ROOM_C='20000000-0000-0000-0000-000000000003'
ROOM_D='20000000-0000-0000-0000-000000000004'
ROOM_E='20000000-0000-0000-0000-000000000005'

# Same-day checkout/check-in is valid under [arrival, departure) semantics.
psql -v ON_ERROR_STOP=1 -c "insert into reservations values
 ('30000000-0000-0000-0000-000000000001','$PROPERTY','$ROOM_A','2026-12-01','2026-12-05','booked'),
 ('30000000-0000-0000-0000-000000000002','$PROPERTY','$ROOM_A','2026-12-05','2026-12-08','booked');"

expect_rejected() {
  local label="$1"
  local expected="$2"
  local sql="$3"
  local log
  log="$(mktemp)"
  if psql -v ON_ERROR_STOP=1 -c "$sql" >"$log" 2>&1; then
    cat "$log"
    rm -f "$log"
    echo "FAIL: $label unexpectedly succeeded" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$log"; then
    cat "$log"
    rm -f "$log"
    echo "FAIL: $label failed for an unexpected reason" >&2
    exit 1
  fi
  rm -f "$log"
  echo "PASS: $label"
}

expect_rejected "overlapping reservation is rejected" "Room is already reserved" \
  "insert into reservations values ('30000000-0000-0000-0000-000000000003','$PROPERTY','$ROOM_A','2026-12-04','2026-12-06','booked')"

psql -v ON_ERROR_STOP=1 -c "insert into room_closures values
 ('40000000-0000-0000-0000-000000000001','$PROPERTY','$ROOM_B','2026-12-01','2026-12-05');"
expect_rejected "reservation overlapping closure is rejected" "Room is closed" \
  "insert into reservations values ('30000000-0000-0000-0000-000000000004','$PROPERTY','$ROOM_B','2026-12-03','2026-12-06','booked')"

psql -v ON_ERROR_STOP=1 -c "insert into reservations values
 ('30000000-0000-0000-0000-000000000005','$PROPERTY','$ROOM_C','2026-12-01','2026-12-05','checked-in');"
expect_rejected "closure overlapping active reservation is rejected" "Room closure overlaps" \
  "insert into room_closures values ('40000000-0000-0000-0000-000000000002','$PROPERTY','$ROOM_C','2026-12-04','2026-12-06')"

# Two independent PostgreSQL sessions race to reserve the same room. The
# first holds the advisory lock until commit; the second must then see it.
psql -v ON_ERROR_STOP=1 -c "begin;
 insert into reservations values ('30000000-0000-0000-0000-000000000006','$PROPERTY','$ROOM_D','2026-12-01','2026-12-05','booked');
 select pg_sleep(2);
 commit;" >/tmp/pms-room-first.log 2>&1 &
first_pid=$!
sleep 0.35
expect_rejected "concurrent double-booking is serialized and rejected" "Room is already reserved" \
  "insert into reservations values ('30000000-0000-0000-0000-000000000007','$PROPERTY','$ROOM_D','2026-12-02','2026-12-04','booked')"
wait "$first_pid"

# A closure and a booking race for the same inventory window. Both trigger
# types share the property lock, so only the first committed writer can win.
psql -v ON_ERROR_STOP=1 -c "begin;
 insert into room_closures values ('40000000-0000-0000-0000-000000000003','$PROPERTY','$ROOM_E','2026-12-01','2026-12-05');
 select pg_sleep(2);
 commit;" >/tmp/pms-room-closure-first.log 2>&1 &
closure_pid=$!
sleep 0.35
expect_rejected "concurrent reservation-versus-closure conflict is serialized" "Room is closed" \
  "insert into reservations values ('30000000-0000-0000-0000-000000000008','$PROPERTY','$ROOM_E','2026-12-02','2026-12-04','booked')"
wait "$closure_pid"

echo "All Phase 2 room-inventory PostgreSQL integration checks passed."
