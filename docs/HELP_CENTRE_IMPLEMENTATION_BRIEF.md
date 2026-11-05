# OliTechs Help Centre — Implementation Brief

**Status:** Planned feature; documentation only. No application code, database schema, migrations, policies, or support workflows have been implemented by this brief.

## 1. Objective

Replace the current Help placeholder with a dedicated, searchable in-app Help Centre that teaches staff how to use OliTechs and provides a clear route to human support when the documentation does not solve their problem.

The Help Centre must be accessible from the existing Help entry point and work across supported property workspaces. Keep the experience consistent with the approved OliTechs design system and responsive on desktop, tablet and mobile.

## 2. Help Centre experience

### 2.1 Help Centre landing page

Provide a dedicated page with:
- Search across help articles, FAQs, and how-to guides.
- Browseable categories and popular/recent help topics.
- Clear article pages with headings, numbered steps, screenshots or short videos where useful.
- Related articles and links to contact support.
- Helpful / not helpful feedback on articles.
- A visible route to submit a support ticket or open a live conversation.

### 2.2 FAQ and how-to content

Organize content around the actual product modules, including:
- Getting started, login, property setup and staff access.
- Back Office dashboard, employees, roles and settings.
- Front Office, reservations, room planning, check-in/out and guest folios.
- POS, tables, orders, bills, payments, cashier and receipts.
- Kitchen Display System and order progress.
- Inventory, products, stock locations, purchasing, suppliers, counts and transfers.
- Recipes, ingredient consumption, wastage and production.
- Housekeeping, maintenance and room readiness.
- Reports, night audit and daily closing.
- Printers, devices, troubleshooting and account/security questions.

Articles must describe verified product behavior. Clearly label features that are planned, partially implemented, package-restricted or dependent on external integrations. Do not document a planned feature as if it is already live.

### 2.3 Search and unanswered questions

Search should return relevant articles and FAQ answers, with useful empty-state guidance when no match is found. When the user cannot find an answer, offer the support ticket and live chat paths without forcing them to repeat their question unnecessarily.

## 3. Support tickets

Allow an authenticated user to create a support request containing:
- Short subject and detailed description.
- Category (for example: account/access, PMS, POS, inventory, payments, reports, devices/printing, bug or other).
- Priority with sensible defaults and clear guidance.
- Optional screenshot or attachment, subject to safe file type and size limits.
- Automatically captured property, authenticated user, workspace/module, creation time and application version where available.

Ticket lifecycle should include at least: Open, In Progress, Waiting for User, Resolved and Closed. Users should be able to view their own property's permitted tickets, add replies, attach follow-up evidence and see status changes. Preserve ticket history; do not silently erase conversations.

## 4. Live support conversation

Provide real-time, two-way in-app messaging between the user and OliTechs support team, with messages appearing without a page refresh when the connection is available.

Include:
- Conversation linked to a support ticket, or a clearly defined standalone conversation that can be converted into a ticket.
- Message history, timestamps, sender identity and delivery/loading/error states.
- Unread indicators and notifications.
- Clear offline/disconnected state and retry behavior; never imply a message was sent if it was not confirmed.
- Ability for an administrator/support agent to reply from the platform support inbox.
- Safe handling of attachments and user-provided content.

If no support agent is online, show that clearly and let the user leave a message or create a ticket. Do not promise instant human availability.

## 5. Platform administrator support inbox

Add a support area to Platform Admin where authorized support administrators can:
- View, search, filter and sort tickets across properties.
- Open a ticket and review its full message history and permitted attachments.
- Reply to users through the same conversation thread.
- Assign tickets to an administrator/agent.
- Change status and priority.
- Add internal notes that are never visible to property users.
- See property, requester, category, timestamps and last activity.
- Receive or view unread/new-ticket indicators.
- Review an auditable history of assignment, status and administrative actions.

Support access must be explicitly restricted to authorized platform support/admin roles. Hotel/property administrators must not gain access to other properties' tickets.

## 6. Data, security and architecture requirements

- Use Supabase/PostgreSQL as the persistent source of truth for tickets and messages.
- Enforce property isolation with RLS and trusted server-side authorization; never trust a client-supplied property ID or role.
- Separate platform support permissions from property staff permissions and enforce action-level authorization in the database/API layer.
- Users may only read and reply to tickets/conversations they are authorized to access.
- Platform support agents may access cross-property support data only through explicitly authorized roles and audited operations.
- Use Supabase Realtime or an equivalent verified mechanism for live message updates; persistence and authorization must not depend on Realtime alone.
- Store attachments in a private bucket with scoped access and signed/authorized retrieval. Validate file types, size and ownership.
- Add rate limits/abuse controls, input validation and safe rendering of message content.
- Keep an auditable event trail for ticket creation, replies, assignments, status changes and internal notes.
- Do not place secrets or privileged service-role credentials in the browser.
- Notifications must not expose private ticket content to unauthorized recipients.

## 7. Suggested implementation components

Names are provisional and must be reconciled with the actual route tree and service conventions before coding:
- Help Centre route/page and Help navigation entry.
- FAQ/article data model and content-management approach.
- Help search and article feedback.
- Support ticket and message services.
- User ticket list/detail and new-ticket form.
- Live conversation UI with connection and delivery states.
- Platform Admin support inbox and ticket detail/reply view.
- Database tables, indexes, RLS policies, RPCs, storage policies and Realtime configuration.
- Tests for tenant isolation, platform support authorization, attachment access, ticket lifecycle, message ownership, realtime reconnect and audit history.

Prefer a manageable, version-controlled article catalogue initially. If administrators need to author/edit help articles in-app, treat that as a separate permissioned content-management capability rather than assuming it is included automatically.

## 8. Acceptance criteria

- [ ] The existing Help button opens a dedicated Help Centre page, not a placeholder.
- [ ] Users can search FAQs and browse module-specific how-to guides.
- [ ] Articles accurately reflect verified software behavior and show when guidance is version-sensitive.
- [ ] Users can create a ticket when the available guidance does not solve the issue.
- [ ] Users can view and reply to only the tickets/conversations they are authorized to access.
- [ ] Authorized platform support staff can triage, assign, reply to and resolve tickets across properties.
- [ ] Live chat messages persist and update in real time without page refresh when connected.
- [ ] Disconnected, failed and pending message states are clearly communicated.
- [ ] Ticket/message attachments are private and access-controlled.
- [ ] RLS and server-side authorization tests prove property isolation and platform support boundaries.
- [ ] Ticket and conversation actions are auditable.
- [ ] Responsive, accessible UI follows the approved OliTechs design system.
- [ ] Existing navigation, role restrictions and property workflows remain unaffected.

## 9. Delivery sequence

1. Audit the current Help button, placeholder route, route guards, navigation and platform-admin structure.
2. Confirm the support roles and escalation/ownership model.
3. Design the schema, RLS, storage policies and RPC/service boundaries before building UI.
4. Build the Help Centre shell, categories, searchable FAQ/how-to article experience.
5. Implement ticket creation, user ticket history and admin support inbox.
6. Add persistent messaging and Realtime updates, then unread indicators and notifications.
7. Add attachment handling, audit events and operational safeguards.
8. Test tenant isolation, support-role authorization, lifecycle behavior, reconnects, failures and responsive accessibility.
9. Update the workflow catalogue, architecture diagrams, README and release notes.

## 10. Scope and safety gates

This brief records the requested feature and acceptance criteria only. It does not authorize an unreviewed production migration, deployment, or broad changes to authentication, RLS or platform administration. Before implementation, inspect the current repository and database state, identify exact affected files and migration dependencies, and propose a focused implementation plan. Any database migration must be forward-only, reviewed, tested against an appropriate disposable environment and handled under the repository's migration safety rules.
