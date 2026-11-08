# Front Office staged implementation plan

This plan is delivered as six independently reviewable stages. Each stage uses a feature branch and pull request; production deployment and database migrations remain separate, explicit release steps.

## Guardrails

- Preserve the existing `property_id` tenant boundary and RLS policies.
- Reuse existing PMS tables and services before adding new data structures.
- Do not change `src/data/AppStore.jsx` or `src/data/PmsStore.jsx` without explicit approval.
- Keep the Room Planner V2, reservations, folios, payments, POS room charges, housekeeping and print-agent flows compatible.
- Do not expose unfinished functions as if they were production-ready.
- Use additive migrations and retain legacy fields while data is migrated and verified.
- Verify role permissions and audit coverage before production enablement.

## Stage 1 — Structure

- Property-scoped buildings and floors.
- Room-to-building/floor assignment while retaining the legacy integer `rooms.floor`.
- Existing room types surfaced alongside room inventory.
- Existing room numbers, statuses and reservation references remain unchanged.
- Migration: `20261109100000_front_office_structure_foundation.sql`.
- Before production: apply the migration in the intended Supabase project, verify RLS as a member and a non-member, confirm existing rooms are backfilled, and test Room Planner grouping and reservation creation.

## Stage 2 — Configuration

- Rate plans and seasonal rate calendars.
- Tax rules and payment methods.
- Booking, cancellation, deposit and option policies.
- Voucher, invoice, registration-card and guest-document templates.
- Role/action matrix integrated with existing staff roles and entitlements.
- Do not duplicate existing Back Office payment, tax, printer or receipt settings; establish a clear source of truth and map Front Office controls to it.

## Stage 3 — Operational services

- Minibar and extras posting to the correct guest folio.
- Laundry requests, itemised pricing and status lifecycle.
- Maintenance work orders and room-out-of-service coordination.
- Guest requests, transfers and tours with assignment, status and charge posting.
- Reuse housekeeping, inventory, reservations, folio and transfer services where available.

## Stage 4 — Assistance and Tags

- Property-scoped support requests, assignment, priority, status and ticket history.
- Reusable tags for guests, rooms and reservations.
- Audit tag changes and support actions; enforce staff permissions.

## Stage 5 — Statistics

- Occupancy, ADR, RevPAR and revenue.
- Booking source/channel performance.
- Guest origin/nationality.
- Cancellation and no-show analysis.
- Forecasts with explicit date ranges and definitions.
- Reconcile figures against PMS folios, POS room charges and existing daily reporting before release.

## Stage 6 — Integration and final QA

- End-to-end integration and permission matrix.
- Tenant isolation and RLS checks.
- Before/after audit-event verification.
- PDF, print and spreadsheet export checks.
- Regression coverage for Room Planner, reservations, group stays, folios, payments, POS room charges, housekeeping, inventory and thermal printing.
- Desktop, tablet and mobile review.
- Production release only after preview QA and required migrations are verified.

## Delivery status

Stage 1 is the active implementation. Stages 2–6 are planned and must not be represented as implemented until their own pull requests and verification are complete.
