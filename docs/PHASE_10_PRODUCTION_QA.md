# Phase 10 — Production Readiness QA

## Scope
- PMS/POS/Back Office/Reporting/RBAC route audit
- dependency and lockfile integrity
- immutable financial and inventory ledgers
- printer-assignment index integrity
- Supabase RLS/security/performance advisor review
- production build/lint automation

## Verified against the live Supabase project
- 2 properties
- 2 staff records
- 6 reservations
- 3 POS receipts
- 1 cashier shift
- 2 property subscriptions
- no synthetic QA transactions were inserted

## Financial integrity
DELETE policies were removed from:
- `payments`
- `pos_receipts`
- `inventory_movements`
- `stock_movements`

The existing void/refund/adjustment workflows remain the correction path.

## Printer integrity
The duplicate `printer_assignments` unique index was removed. The canonical unique index remains.

## Authorization
Phase 9 server-side module authorization and subscription entitlement functions remain authoritative. The Phase 9 migration was reconciled into Supabase migration history.

## Dependency integrity
- Removed the unused `bonjour-service` direct dependency.
- Restored `zustand@^5.0.8` to the lockfile.
- Verified all package.json direct dependencies are represented in the lockfile root.

## Automated QA
`.github/workflows/production-qa.yml` runs on pushes and pull requests to `main`:
1. `npm ci`
2. `npm run lint`
3. `npm run build`

## Known external limitations
- Hardware printer output cannot be certified without a configured physical printer.
- This environment cannot execute the GitHub-hosted CI runner or a browser session, so the workflow is committed for authoritative runner verification.
- Supabase advisors still report pre-existing SECURITY DEFINER warnings and permissive-policy/index observations. They were reviewed; this phase only changed the directly verified production-integrity findings above.
