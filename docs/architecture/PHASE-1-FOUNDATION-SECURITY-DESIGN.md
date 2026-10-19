# Phase 1 — Foundation, Property Authorization, and Offline Data Contract

**Status:** Design contract for implementation; not evidence that production database policy changes are deployed.  
**Branch:** `phase1/foundation-data-security-20261019`  
**Safety:** No production database writes. No historical migration rewrite or replay. No changes under `v6/`.

## 1. Authority model

1. Supabase Auth is the identity authority. The authenticated subject is `auth.uid()`; browser storage, route state, submitted user IDs, property IDs, role strings, module lists, and subscription snapshots are not authorization evidence.
2. PostgreSQL is the authority for property membership, active staff session, role/action permissions, property status, package/subscription entitlements, and operational records.
3. The browser may hide controls for usability, but every sensitive read/write and every SECURITY DEFINER RPC must independently enforce identity, tenant, action, and entitlement conditions.
4. Platform-owner access is explicit and should be scoped to platform-management operations. It must not silently grant access to every guest, reservation, folio, POS order, or staff credential.
5. Service-role execution is trusted server-to-server only; never ship the service-role key to the browser. Every RPC must explicitly document whether service_role and anon execution are intended.

## 2. Property-scoped authorization contract

For every property-scoped operation, resolve the target property from the record where possible, then validate the requested `p_property_id` against that record. Do not trust a client-supplied property ID by itself.

An actor is eligible for a property operation only when all applicable checks pass:

- Authenticated user exists, unless the operation is explicitly public or service-only.
- User is an active member of the target property OR has a valid active staff session for that same property and requested module/action OR has a narrowly scoped platform-owner capability.
- Staff session belongs to an active staff row, is bound to the property, has not expired/revoked, and permits the requested module/action.
- Property is in a state that permits the operation. Pending/suspended properties must not inherit active operational access merely from membership.
- Subscription/package is active and grants the feature for paid-feature operations. A UI package matrix is not enforcement.
- The requested action is explicitly allowed for the role/permission grant. Module membership is necessary but not sufficient for sensitive actions.
- Related IDs (reservation, room, product, order, shift, folio, payment) all resolve to the same property; mismatches fail closed.
- Errors must not leak whether another tenant's record exists. Prefer a generic not-found/denied result for cross-property identifiers.

## 3. Role and permission model

Keep platform roles, property membership roles, staff roles, module assignment, and subscription entitlements as distinct dimensions. Do not normalize them into a single overloaded role string.

| Dimension | Authority | Purpose |
|---|---|---|
| Platform role | `profiles.platform_role` and server checks | Platform administration only |
| Property membership | `property_users` plus property status | Which property the user belongs to and membership-level role |
| Staff identity/session | `staff` plus server-side session record | PIN-selected operator and current module |
| Action permission | Canonical role/action permission mapping, checked server-side | Read/create/update/delete/approve/refund/void/adjust/export actions |
| Subscription entitlement | Active property subscription/package in Postgres | Whether the property has the feature |
| UI visibility | Client-side derived view of the above | UX only; never the security boundary |

### Role/action implementation requirements

- Maintain one canonical, versioned role-to-action matrix. Any compatibility aliases must be normalized at input boundaries and stored/returned in canonical form.
- Fail closed for unknown roles, unknown modules, missing entitlements, inactive membership, expired sessions, and RPCs whose authorization context cannot be resolved.
- A module list such as `assigned_modules` only allows entry to that module. Actions like refund, void, close shift, change price, manual stock adjustment, export financial reports, or manage staff need distinct action permissions.
- A staff-session predicate must bind the selected staff member, property, module, and session expiry/revocation. A broad `current_staff_role(property_id) IS NOT NULL` predicate is not proof that the active session is authorized for POS.
- Property Admin email/password access is separate from staff PIN access. A PIN session must not elevate the underlying Supabase user, impersonate another tenant, or grant admin actions not assigned to the staff operator.
- Standard/Premium/Professional entitlement definitions must be aligned between the UI and database. The database must deny feature-specific RPCs and writes if subscription is inactive, suspended, expired, or lacks the feature.
- Preserve current package/module business decisions unless a separate approved entitlement matrix explicitly changes them; this document does not silently change plan pricing or package semantics.

## 4. RLS policy pattern

For every tenant table, inventory and classify it before policy changes:

1. Direct tenant table with `property_id`: RLS enabled; SELECT and each write operation use an action-specific predicate; UPDATE uses both `USING` and `WITH CHECK` to prevent moving a row to another property.
2. Child table without `property_id`: authorize through a validated parent join, and add a direct property key only through a separately reviewed additive migration if needed.
3. Credential/secrets table: no direct authenticated SELECT of hashes, tokens, or session secrets. Use a narrow RPC that returns only necessary public fields.
4. Append-only audit/event table: no client UPDATE/DELETE; inserts through a controlled function or trigger with actor and property derived from trusted context.
5. Public booking surface: explicitly public fields only, active property and enabled booking engine required; never expose private booking, guest, or payment data.
6. Platform tables: dedicated platform policies and RPCs, not a blanket platform-owner bypass over tenant operational data.

Every policy review must verify RLS is enabled, grants are intentional, no permissive policy accidentally ORs with a restrictive one, and the role has no alternate table/view/RPC path that bypasses the intended policy.

## 5. SECURITY DEFINER review checklist

For every exposed `SECURITY DEFINER` function, record signature, owner, execute ACL, search_path, row_security behavior, caller identity source, property scope, action permission, entitlement, input validation, related-record scope, and return fields.

- Use a fixed trusted `search_path`; schema-qualify objects.
- Revoke default PUBLIC/anon execute where not required; grant only intended roles.
- Do not treat `auth.role() = 'authenticated'` as proof of property membership.
- Compare caller identity with user IDs supplied by clients unless the RPC is explicitly trusted-service-only.
- Validate cross-tenant foreign keys before writes.
- Prefer one atomic RPC for invariants requiring multiple writes or locks.
- Avoid returning whole rows when the caller needs a limited projection.
- Add positive and negative tests for owner, member, staff, non-member, anonymous, service role, inactive property, disabled entitlement, and mismatched related IDs.

## 6. Phase 0 findings: blocked deployment gate

The current Phase 0 execution record remains OPEN. The following source migration exists but is absent from the production migration ledger: `20261013210000_harden_booking_and_tenant_sensitive_rpcs.sql`. Its four target RPCs are security-relevant and the production drift is recorded in `docs/audits/PHASE-0-EXECUTION-20261019.md`.

Do not apply that migration to production or infer it has run. First compare its function dependencies, schema assumptions, return types, grants, and behavior against a production-equivalent isolated schema. The existing disposable project is known not to be schema-equivalent.

The six unmatched historical ledger entries listed in the Phase 0 execution record remain unresolved until the original applied SQL/deployment artifacts are recovered or the owner approves documented evidence-based dispositions. Current function bodies cannot prove which historical SQL was applied. Do not rewrite or replay those migrations.

## 7. Service/query boundaries

**Foundation utilities now present on the Phase 1 branch:** `src/lib/propertyQueryKeys.js` provides property-first query keys and property-ID/mutation scope guards. `src/services/offlineMutationQueue.js` provides a bounded IndexedDB outbox for explicitly provisional draft operations and rejects credentials in queued payloads. These are not a claim that all components have been migrated to the service layer or that offline replay is production-ready.

Target flow:

`Page/component → feature query/mutation hook → domain service → Supabase table/RPC → TanStack Query cache`

- Components must not call Supabase directly.
- Query keys must include property ID and relevant filters; never reuse a cache key across tenants.
- Every property-scoped service requires an explicit property context and rejects a missing property ID before issuing a request.
- Services validate input shapes and normalize database errors without suppressing them.
- Mutations invalidate only relevant property-scoped keys after authoritative success.
- Use RPCs for atomic stock/folio/payment/shift/idempotency invariants; do not reimplement those invariants only in client code.
- Existing `PmsStore.jsx` and `AppStore.jsx` remain compatibility adapters until a domain has been migrated and tested; do not perform a big-bang store replacement.
- Never put service-role credentials in the Vite client bundle.

## 8. Audit logging contract

Audit events are server-derived and append-only. Minimum fields:

- `id`, `occurred_at`, `property_id`, `actor_user_id`, `actor_staff_id` (nullable), `actor_kind`, `action`, `entity_type`, `entity_id`, `request_id`/idempotency key, `outcome`, and safe metadata.
- Do not log PINs, PIN hashes, access tokens, passwords, payment card data, or unrestricted guest PII.
- Derive actor/property from trusted session and target row wherever possible; do not accept them blindly from request JSON.
- Clients may read audit events only when the role has the audit-view permission and entitlement. No client update/delete policy.
- Critical actions include login/PIN verification failures and success, role/PIN changes, subscription/property status changes, reservation/folio/payment mutations, refunds/voids, stock adjustments, shift close, export, and failed cross-tenant authorization.
- Avoid writing audit events from the client as the sole record of a successful business operation. Prefer the same database transaction as the operation or a database trigger.
- Access-check functions must not silently create or mutate subscription/entitlement rows; split any compatibility repair into a separate audited mutation.

## 9. Offline-sync foundation

**Implemented local foundation:** `src/services/offlineMutationQueue.js` defines a versioned IndexedDB outbox, stable idempotency-key uniqueness, property-scoped listing, credential-field rejection, payload size/version checks, and constrained status transitions. Only `pos.order.draft`, `reservation.draft`, and `inventory.count.draft` are queueable; final payments/refunds/voids/admin actions are deliberately excluded. The module is not yet wired to operational mutations and has no replay worker. Tests cover the pure validation contract; browser IndexedDB transaction and cross-tab behavior still require browser integration tests.

Offline mode is a local queue, not a second authoritative database.

Each queued mutation must include a UUID idempotency key, operation name/version, property ID, actor/session context reference (not credentials), created time, payload schema version, retry count, and status (`pending`, `in_flight`, `synced`, `conflict`, `rejected`). Keep payloads minimal and avoid storing PINs, auth tokens, or unnecessary guest PII.

- Persist queue records in IndexedDB, not localStorage.
- Never queue security-sensitive admin operations, PIN/role changes, refunds, or destructive actions for blind replay.
- Offline-created reservations/orders/stock actions are provisional until server acceptance. Do not claim committed/synced while offline.
- Server must deduplicate by idempotency key and enforce current tenant, session, role/action and entitlement at replay time.
- Use optimistic concurrency/version checks for mutable records; conflicts require an explicit resolution path, not last-write-wins for money, stock, room inventory, or folios.
- Preserve causal ordering per aggregate where required. Retry transient network errors with bounded exponential backoff; permanent authorization/schema errors become `rejected`.
- On logout, property switch, staff-session expiry, or permission revocation, pause the queue and revalidate every pending operation before replay.
- Do not sync local PIN state or treat local session storage as server authority.

## 10. Release gates

Before this design is marked implemented:

- [ ] Phase 0 migration provenance and SECURITY DEFINER review has an approved disposition.
- [ ] Schema-equivalent isolated two-tenant fixture exists without a paid branch/project.
- [ ] RLS tests cover direct SELECT/INSERT/UPDATE/DELETE and all sensitive RPC families.
- [ ] Role/action and subscription matrices have positive and negative tests.
- [ ] PIN brute-force throttling, session expiry/revocation, module binding, and cross-property replay tests pass.
- [ ] Audit rows are transactionally emitted for critical operations and immutable to clients.
- [ ] Offline idempotency, conflict, tenant-switch, expired-session, and permission-revocation integration tests pass; current tests cover only record validation and tenant query-key contracts.
- [ ] `npm run build`, `npm run lint`, `npm run typecheck`, and relevant regression suites pass on the final branch commit.
- [ ] Browser smoke tests pass without removing existing PMS/POS workflows.
- [ ] Owner approves Phase 1 before merge/release.

**Current disposition:** Authorization design specified; tenant query-key and local offline-outbox foundations implemented on the branch. Database rollout, end-to-end role/session enforcement, transactional audit coverage, offline replay, and full Phase 1 completion remain blocked by unresolved Phase 0 security evidence and integration-test prerequisites.
