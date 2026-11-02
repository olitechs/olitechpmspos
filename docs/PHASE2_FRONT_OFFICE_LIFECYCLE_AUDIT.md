# Phase 2 Front Office lifecycle audit

**Date:** 2026-11-02  
**Scope:** Reservation availability, check-in, folio payments, checkout, housekeeping  
**Environment:** Production catalog inspected read-only. No SQL was applied and no customer data was modified.

## Verified live behavior

The following observations come from the current production `pg_get_functiondef` output and matching committed migration sources.

| Area | Verified behavior | Assessment |
|---|---|---|
| Reservation creation | `fn_create_reservation_bundle` checks property membership, required guest/date fields, payment bounds, duplicate room IDs, then calls `fn_check_room_availability` for each room. | Core validation exists. |
| Availability | `fn_check_room_availability` rejects overlapping booked/checked-in reservations and overlapping room closures using half-open date comparisons. | Correct sequential overlap semantics. |
| Reservation concurrency | The availability function performs ordinary reads and does not take a room-scoped advisory lock or lock a stable room row before returning availability. | **Concurrency race remains:** two simultaneous creates can both observe availability and insert overlapping stays unless another database constraint/serialization mechanism prevents it. No such exclusion constraint was verified in this pass. |
| Check-in | `fn_check_in_reservation` checks membership, status, date validity and operational room status; creates the room folio charge if absent. | **Locking gap:** the reservation SELECT has no `FOR UPDATE`. Concurrent check-in attempts can both pass the initial status read. |
| Payment | `fn_record_front_desk_payment` locks the reservation, validates property membership and amount/method, computes posted folio balance, and rejects overpayment. | Row-level serialization is present for payment posting. |
| Checkout | `fn_check_out_room` locks the checked-in reservation, calculates posted folio balance, blocks checkout while a balance remains, marks the room dirty and creates a checkout-clean task. | Core financial guard and housekeeping handoff are present. |
| Housekeeping task creation | `fn_create_housekeeping_task` is SECURITY DEFINER, checks property membership and room/property relationship, and prevents duplicate task types in selected states. | Function authorization is present in its body; broad EXECUTE grants still need review and should not be interpreted as authorization by themselves. |
| Housekeeping inspection | `fn_inspect_housekeeping_task` is SECURITY DEFINER, locks the task, checks property membership and completed state, then changes room status. | Function authorization is present in its body; grant surface remains part of the wider RPC review. |

## Required follow-up before lifecycle changes

1. Design a database-enforced serialization strategy for reservation creation and room/date availability. It must cover single-room, multi-room/group, edit, and move RPCs in one transaction and preserve same-day turnover.
2. Add a row lock to check-in and revalidate the reservation and room state after acquiring it. Confirm walk-in check-in uses the same invariant.
3. Add deterministic concurrent-session tests proving that two overlapping reservations cannot both commit.
4. Add two-property authorization tests for create/edit/move/check-in/payment/checkout/housekeeping, including attempts to substitute another property's room, reservation, task, or shift ID.
5. Verify the exact deployed function grants and all relevant RLS policies against committed migration provenance before changing the production authorization surface.
6. Test payment/folio behavior with partial payments, exact settlement, overpayment, cancelled stays, repeated checkout and concurrent payment attempts.

## Explicitly not changed

- No production schema, rows, migration ledger, grants, policies, functions, triggers, or indexes.
- No reservation, folio, payment, checkout, or housekeeping application behavior.
- No migration was generated or applied.
- No new branch or paid Supabase resources were created.

## Phase 2 status

**Audit progress: verified sequential availability and financial lifecycle guards; concurrency and end-to-end tenant/role tests remain open.**

This is an evidence record, not a claim that Phase 2 lifecycle implementation is complete. The next code change should be the tested concurrency/authorization correction, developed against a production-equivalent disposable schema after its migration provenance is reconciled.
