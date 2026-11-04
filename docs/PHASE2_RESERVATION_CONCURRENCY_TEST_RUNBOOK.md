# Phase 2 reservation concurrency regression runbook

Run only against a disposable PostgreSQL database loaded with the repository migrations. Never run against production.

## Preconditions
- Create a disposable local PostgreSQL/Supabase database and apply migration history in order.
- Create two authenticated test users, one property, one active room, and valid guest/payment fixtures. Both users must be members of the property.
- Use a date range without reservations or closures, such as 2031-04-10 through 2031-04-13.
- Invoke the real fn_create_reservation_bundle RPC using its current signature and valid fixture data.

## Concurrent booking test
1. Session A begins a transaction and calls fn_check_room_availability for the target room/date range; assert available=true.
2. Session A sleeps for five seconds while keeping the transaction open, then creates the reservation with the real create RPC and commits.
3. Session B starts after A has acquired the lock and calls the real create RPC for the same room and overlapping dates.
4. Session B must wait for A's transaction-scoped advisory lock and then fail with a reservation conflict. It must not commit a second overlapping reservation.
5. Query active reservations and assert exactly one overlap exists.

## Additional cases
- Run two `fn_walk_in_check_in` calls concurrently for the same room and overlapping dates. Exactly one may commit; the second must fail with an availability conflict. This path must call `fn_check_room_availability` before inserting the checked-in reservation.
- Same-day turnover must pass: [2031-04-10, 2031-04-13) followed by [2031-04-13, 2031-04-15).
- Run two check-in RPC calls concurrently for one booked reservation. One succeeds; the other waits, sees the changed status, and fails.
- Repeat using different property members and verify cross-property access is denied.

## Verification boundary
The Node contract test checks that the migration contains the expected lock and row-lock ordering; it is not a substitute for running concurrent PostgreSQL sessions. The two-session test must be run before production rollout. The current execution environment does not provide psql, Docker, Podman, or the Supabase CLI, so this runbook is committed for execution in an equipped disposable environment. No production SQL was applied.
