# Support ticketing foundation — verified baseline and delivery gates

**Target:** current OliTechs PMS/POS main branch and Supabase project.
**Status:** schema proposal only; this document and migration have not been applied to the live database.

## Repository discovery

The original `feat/help-centre-support` branch is 758 commits behind current `main` and contains only the Help Centre page, route wiring and an implementation brief. Its Help Centre page is already present on current `main`; the old branch must not be merged wholesale.

The original `feat/support-backend-design` branch is 757 commits behind current `main` and contains a design document only. Its security requirements remain useful, but its branch history is stale.

## Verified live database baseline (read-only inspection)

- Applied migration history is available and includes the current employee permission and Front Office security work through 2026-11-23.
- `profiles.platform_role` currently has `platform_owner` and `user` values. There is no separate support-agent role.
- `property_users` records property membership; `property_role_permissions` and employee-role permission functions are present.
- `is_member_of_property(uuid)` and `is_platform_owner()` are existing SECURITY DEFINER helpers with a fixed `public` search path.
- `maintenance_tickets` is a room/property maintenance work-order table (room, issue, maintenance status and assignment). It must not be reused for product/customer support.
- `audit_logs` is already used for application auditing, but support conversations need their own immutable message/event history.
- The live schema has no `support_tickets`, `support_ticket_messages` or `support_ticket_events` tables at inspection time.

## First-phase authorization model

- A signed-in property member can open a ticket only for a property they belong to. The property ID is checked server-side through `is_member_of_property`; it is not trusted from the client alone.
- Property members can read non-internal ticket messages for their own property and add public replies to tickets that are not closed.
- Only the current `platform_owner` role can see cross-property support tickets, add internal notes, assign tickets or change support status/priority.
- Internal messages and internal event records are excluded from property-member reads.
- The first phase deliberately uses the existing platform-owner role as the support inbox gate. A separate least-privilege support-agent role must be designed and approved before delegating cross-property access to additional staff.

## Scope deliberately deferred

- Private attachments and malware scanning.
- Realtime subscriptions and notifications.
- A dedicated support-agent role and granular support permissions.
- Knowledge article feedback and in-app article authoring.
- Automatic diagnostics collection. Any future diagnostics must avoid collecting guest personal data, payment data, credentials, tokens or secrets.

## Release gates

1. Review the proposed migration against the current repository migration conventions and live schema.
2. Test it on a disposable database with matching schema, grants and RLS.
3. Add SQL/RLS tests proving property A cannot read property B tickets or messages, property members cannot read internal notes, and non-platform-owner users cannot assign or change ticket status.
4. Add service/UI tests for ticket creation, message persistence, retries, validation and failure states.
5. Implement the property-user ticket list/detail/reply UI and platform-owner support inbox.
6. Only then apply the migration through the approved deployment path and deploy the UI. Do not expose a form that claims success before the database confirms persistence.

No production migration or data change was executed as part of this work.
