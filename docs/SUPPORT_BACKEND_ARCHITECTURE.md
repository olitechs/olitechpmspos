# OliTechs Support Backend — Architecture and Security Design

**Status:** Design proposal only. Not an executable migration or proof of deployed database state.
**Branch:** `feat/support-backend-design`
**Depends on:** `docs/HELP_CENTRE_IMPLEMENTATION_BRIEF.md`

## 1. Purpose

Define a safe implementation shape for persistent Help Centre support tickets, Platform Admin triage, and live conversations. This document deliberately separates intended architecture from verified database facts. The current Supabase project's deployed schema, grants, RLS, storage policies, Realtime publication and applied migration history have not been supplied for this review.

**No database migration, policy, RPC, bucket, Realtime publication, or application feature should be implemented from this proposal until the baseline gate in section 9 is complete.**

## 2. Actors and trust boundaries

| Actor | Intended access |
|---|---|
| Authenticated property user | Create tickets for an authorized property; read/reply to tickets they are allowed to participate in within that property |
| Property administrator | Same property boundary; optionally view/manage property-owned tickets if the product owner approves this behavior |
| Platform support agent | Cross-property support access only when explicitly granted a dedicated support permission |
| Platform owner | Platform-wide support administration only if explicitly included in the approved authorization policy |
| Anonymous visitor | No access to private tickets, messages, attachments, or admin inbox |

The browser's `user.isPlatformOwner`, route guards, sessionStorage, supplied `property_id`, and UI visibility are not authorization evidence. Every read and mutation must be checked server-side/database-side against the authenticated Supabase user and trusted membership/role records.

Do not automatically treat every platform owner as a support agent, or every property admin as entitled to see all staff conversations, without an explicit product decision.

## 3. Proposed logical data model

Names and columns below are provisional. Reconcile them with existing naming conventions, profiles, property membership, audit and notification tables before writing SQL.

### 3.1 `support_tickets`

- `id` UUID primary key.
- `property_id` UUID, required for tenant-originated requests; references the canonical property table.
- `created_by` UUID references the authenticated profile/user.
- `subject`, `description`, `category`, `priority`.
- `status`: `open`, `in_progress`, `waiting_for_user`, `resolved`, `closed`.
- `assigned_to` nullable support-agent identity.
- `created_at`, `updated_at`, `last_message_at`, optional `resolved_at`.
- Optional non-sensitive context: module, app version, route identifier. Avoid collecting secrets, payment-card data or unnecessary personal data.

Indexes: property + creation time, status + last activity, assigned agent + status, creator + creation time. Add indexes only after query patterns and data volumes are confirmed.

### 3.2 `support_messages`

- `id` UUID primary key.
- `ticket_id` foreign key to ticket.
- `sender_user_id` nullable only for a verified system event; normal messages require an authenticated sender.
- `sender_kind`: property user, support agent, or system.
- `body` plain text/validated content.
- `created_at`, optional edit/redaction metadata under an explicit retention policy.
- Optional client-generated idempotency key scoped to ticket and sender to prevent duplicate sends on retries.

Messages should be append-oriented. Do not silently overwrite conversation history. If editing/deletion is required by privacy policy, preserve an auditable event and define exactly what remains visible.

### 3.3 `support_agent_assignments` (if assignment history is required)

Record ticket, agent, assigning actor, timestamps and assignment changes. Do not rely only on a mutable `assigned_to` field if assignment audit history is required.

### 3.4 `support_internal_notes`

Separate table from customer-visible messages. Only explicitly authorized support agents may read/write. Never return internal notes through a user-facing ticket query or message subscription.

### 3.5 `support_events` / audit integration

Record ticket creation, assignment, priority/status changes, agent replies, internal notes, resolution/reopen actions and attachment lifecycle. Prefer the existing approved audit framework if it supports these events; do not create a parallel audit system without checking existing conventions.

### 3.6 Notifications

Prefer integration with an existing notification mechanism after inspection. Notification rows should contain minimal metadata and a recipient identity; access to the linked ticket must still be checked when opened. Avoid putting private ticket text in broadly visible push/email payloads.

## 4. Authorization model

Authorization should be expressed as explicit database predicates or guarded RPCs based on `auth.uid()`, canonical property membership and a dedicated support-agent permission source.

Required rules:

1. A property user can create a ticket only for a property they are currently authorized to act within. The server derives or validates the property from trusted membership; never trust a client-supplied property ID alone.
2. A property user can read a ticket only if they are its permitted requester/participant or have an explicitly approved property-level support role for that same property.
3. A property user can insert a message only when they can access the parent ticket, the ticket is in a reply-eligible state, and the sender identity is derived from the authenticated session.
4. A support agent can access cross-property tickets only if a dedicated support-agent authorization record/claim is valid and active.
5. Internal notes are never visible to property users.
6. Assignment, status changes, priority changes and resolution require explicit support-agent capabilities. A generic authenticated role is insufficient.
7. Users cannot set sender identity, platform role, audit actor, assignment authority, or trusted property membership through request payloads.
8. Revoke broad table grants where appropriate and expose only the minimum necessary operations. Confirm effective grants, inherited roles, SECURITY DEFINER ownership/search_path and RLS interaction before deciding exact SQL.
9. Service-role credentials must remain server-side and must not be introduced into Vite/browser code.
10. RLS must be tested for both positive and negative cases across multiple properties and actor classes.

RLS policy names, helper functions, role names and SECURITY DEFINER strategy must be derived from the actual live baseline. This document intentionally does not prescribe executable policy SQL.

## 5. Ticket and message lifecycle

- New ticket: `open`.
- Support begins work: `in_progress`.
- Support needs requester information: `waiting_for_user`.
- Support resolves issue: `resolved`.
- Close after the approved closure rule: `closed`.
- A requester reply may reopen a resolved ticket only under an explicitly agreed rule.
- Every state transition records actor, previous state, next state, timestamp and optional reason.
- Concurrent status updates must not silently overwrite one another; use guarded transactional operations.
- Message submission should be idempotent for client retries and return an authoritative persisted message before the UI reports success.

## 6. Realtime and offline behavior

Realtime is a delivery/update channel, not the source of truth. Persist first, authorize every subscription and fetch, then broadcast/subscribe to changes. A user who cannot SELECT the parent ticket must not learn message content or metadata through Realtime.

The UI must handle connecting, connected, reconnecting, disconnected and failed states. On reconnect, fetch messages from the last confirmed cursor/time and deduplicate by message ID. Do not claim a message was sent until the database confirms persistence. If Realtime is unavailable, ticket history must remain usable through normal authorized reads.

Before implementation, verify the project's current Realtime publication and RLS behavior for subscribed tables. Avoid exposing private ticket channels through guessable identifiers.

## 7. Attachment security

Use a private storage bucket only after confirming existing bucket conventions and policies. Proposed safeguards:

- Allowlist necessary MIME types and extensions; do not trust client MIME alone.
- Enforce conservative file-size and count limits.
- Generate opaque object keys; do not use user-provided filenames as storage paths.
- Bind each object to a ticket and uploader in trusted metadata.
- Authorize upload and download against current ticket access.
- Use short-lived signed URLs only after authorization.
- Prevent cross-tenant path traversal and object enumeration.
- Consider malware scanning or quarantine before agent download.
- Do not expose public bucket URLs or service credentials.
- Define retention/deletion behavior for ticket closure and account/property deletion.

## 8. API/service and UI boundaries

Proposed service operations (names illustrative):

- `createTicket(input)`
- `listMyTickets(filters, cursor)`
- `getTicket(ticketId)`
- `listTicketMessages(ticketId, cursor)`
- `sendTicketMessage(ticketId, body, idempotencyKey)`
- `assignTicket(ticketId, agentId)`
- `updateTicketStatus(ticketId, status, reason)`
- `addInternalNote(ticketId, body)`
- `listSupportInbox(filters, cursor)`

All service operations must surface authorization, validation, network and persistence failures distinctly. UI should not show a success toast or clear the composer before the persisted operation succeeds.

Platform Admin should gain a Support Inbox navigation item only after the route and backend permission are implemented. Hiding the link is not security; direct URL and RPC/table access must also be denied for unauthorized users.

## 9. Mandatory baseline and release gates

### Gate A — current database evidence

Obtain a current read-only export from the target Supabase project (or an authorized production-equivalent disposable database) covering:

- Applied migration history, including migration identifiers and versions.
- Relevant table/view definitions, constraints, indexes, ownership and grants.
- RLS enabled/forced state and all policies on profiles, property membership, properties, platform roles, audit and notification structures.
- Definitions, owners, grants and configuration for authorization helper functions and SECURITY DEFINER functions.
- Storage buckets, object policies and relevant grants.
- Realtime publication membership/configuration and applicable authorization behavior.
- Current project identity/environment, with secrets, tokens, personal data and credentials removed.

Do not paste secrets or production row-level personal data. Catalog metadata and migration history are sufficient for the first review.

### Gate B — schema reconciliation

Map every proposed entity to existing tables and functions. Identify naming conflicts, migration numbering/history, foreign keys, delete behavior, role semantics and audit/notification reuse. Confirm production and repository migration history are reconciled.

### Gate C — implementation and tests

Only after Gates A and B:
- Draft a forward-only migration with explicit rollback/forward-recovery notes.
- Test on a disposable environment matching the verified production schema and relevant grants/extensions.
- Test two or more properties, requester vs other tenant user, property admin, unauthorized staff, authorized support agent, revoked/disabled agent and platform owner without support permission.
- Test internal-note isolation, ticket/message authorization, attachment authorization, idempotent retries, concurrent status updates and audit completeness.
- Verify Realtime cannot disclose events to unauthorized subscribers and reconnect catches up from persisted data.
- Run project checks and review the exact migration diff before merge.
- Apply to production only through the project's approved deployment/migration process and explicit release authorization.

### Current gate status

- [x] Help Centre frontend exists on main.
- [x] Repository auth and admin entry points reviewed read-only.
- [ ] Current Supabase catalog and migration-history evidence received.
- [ ] RLS/grants/storage/Realtime baseline reconciled.
- [ ] Backend migration reviewed and tested against a suitable disposable environment.
- [ ] Ticket and live conversation backend implemented.
- [ ] Platform Admin support inbox implemented.
- [ ] Security and lifecycle tests passed.

## 10. Work explicitly not performed

This design commit does not:
- Create or modify Supabase tables, functions, policies, grants, buckets or Realtime settings.
- Claim that current production schema or migration state has been verified.
- Add simulated ticket submission or fake live chat.
- Add cross-property support access.
- Run database migrations, tests, builds or deployments.
