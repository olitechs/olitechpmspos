# Support ticketing foundation — verified baseline and delivery gates

**Target:** current OliTechs PMS/POS main branch and Supabase project.  
**Status:** first-phase schema and UI are on the draft PR branch; migration and runtime behavior are not yet validated or deployed.

## Repository discovery

The original `feat/help-centre-support` branch was 758 commits behind current `main` at discovery and contained the Help Centre page, route wiring and an implementation brief. The Help Centre page is already present on current `main`; the old branch was not merged wholesale.

The original `feat/support-backend-design` branch was 757 commits behind current `main` at discovery and contained a design document only. Its security requirements informed this implementation.

## Verified live database baseline (read-only inspection)

- Applied migration history was inspected through 2026-11-23.
- `profiles.platform_role` currently has `platform_owner` and `user` values. There is no separate support-agent role.
- `property_users` records property membership; `property_role_permissions` and employee-role permission functions are present.
- `is_member_of_property(uuid)` and `is_platform_owner()` are existing SECURITY DEFINER helpers with a fixed `public` search path.
- `maintenance_tickets` is a room/property maintenance work-order table. It is not reused for product/customer support.
- The live schema had no `support_tickets`, `support_ticket_messages` or `support_ticket_events` tables at inspection time.

## First-phase authorization model

- A signed-in property member can open a ticket only for a property they belong to. The property ID is checked server-side through `is_member_of_property`.
- Property members can read tickets and non-internal messages for their own property and add public replies to tickets that are not closed.
- Only the current `platform_owner` role can see cross-property support tickets, add internal notes, assign tickets or change support status/priority.
- Internal messages and internal event records are excluded from property-member reads.
- The first phase uses the existing platform-owner role as the support inbox gate. A separate least-privilege support-agent role must be designed before delegating cross-property access.

## Implemented on the draft PR branch

- Help Centre ticket submission through `create_support_ticket`.
- Property ticket history, conversation detail and public replies.
- Platform Admin dashboard support inbox, cross-property triage, customer replies and status updates.
- Additive ticket, message and event schema proposal with RLS and security contract tests.

The UI expects the migration to exist. Until the migration is deployed to a test environment and then through the approved release path, users will receive a service-unavailable message rather than a false success confirmation.

## Scope deliberately deferred

- Private attachments and malware scanning.
- Realtime subscriptions and notifications.
- A dedicated support-agent role and granular support permissions.
- Knowledge article feedback and in-app article authoring.
- Automatic diagnostics collection. Future diagnostics must avoid guest personal data, payment data, credentials, tokens and secrets.

## Release gates

1. Synchronize this branch with current `main` (it was four commits behind at the latest comparison) and resolve any conflicts.
2. Validate migration syntax against the current repository migration conventions and live schema on a disposable database.
3. Add runtime SQL/RLS tests proving property A cannot read property B tickets or messages, property members cannot read internal notes, and non-platform-owner users cannot assign or change ticket status.
4. Run the architecture suite and verify the Vercel preview build and the ticket UI against the disposable database.
5. Review the first-phase authorization boundaries and a future least-privilege support-agent model.
6. Only then apply the migration through the approved deployment path and deploy the UI.

No production migration, data change or production deployment was executed as part of this work.
