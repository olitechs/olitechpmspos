# OliTechs — AI Developer Guide

> **Audience:** Claude Code, Codex, Cursor, GitHub Copilot and human engineers.  
> **Purpose:** Give an agent enough repository context to plan safe, incremental work without guessing at product behavior or rewriting existing systems.  
> **Authority:** This guide is an index and operating contract. It does not override approved product/security decisions in the canonical documents.

## 1. Start here — mandatory reading order

Before changing code, read these files in order:

1. `AGENTS.md` — agent roles, mandatory gates and protected files.
2. `PRD.md` — product vision, actors, requirements and domain scope.
3. `Architecture.md` — actual architecture and target architecture.
4. `Rules.md` — engineering, security, UI and domain invariants.
5. `Phases.md` — implementation order and acceptance criteria.
6. `Design.md` — visual system and approved UX direction.
7. `Memory.md` — decisions, history, known gotchas and protected areas.
8. `README.md` — setup, module map and high-level workflows.
9. `docs/AUDIT.md` and relevant audit reports — findings and evidence limits.
10. `design-system/olitechs-pms-pos/MASTER.md` and relevant page specifications.
11. The relevant source files, tests and Supabase migrations for the task.

Do not assume a file exists because another document mentions it. Verify paths on the current branch. Do not treat historical `v6/` as the active application.

## 2. Phase 0 approval gate

The repository's Phase 0 documents are marked draft/awaiting approval. **Do not start implementation work until the user explicitly approves the Phase 0 foundation documents and authorizes a phase.**

This includes seemingly small UI changes, cleanup, dependency upgrades, schema edits, auth refactors and CSS changes that effectively begin implementation.

If approval is unclear:
- perform read-only inspection only;
- report findings and proposed scope;
- ask for explicit approval before modifying application code or database migrations.

Documentation corrections that do not change approved product decisions may be proposed separately, but do not silently rewrite the product contract.

## 3. What this product is

OliTechs is a standalone, multi-property hospitality operations platform for hotels, resorts, lodges, restaurants and related hospitality businesses. Its operational scope includes:

- Platform onboarding, property administration and subscription entitlements.
- Staff identity, property membership, roles and permissions.
- Reservations, guest profiles, room inventory, arrivals and departures.
- Front desk, folios, charges, payments and cashiering.
- Restaurant/bar POS, table sessions, kitchen tickets and receipts.
- Housekeeping, maintenance and room readiness.
- Inventory, purchasing, suppliers, recipes and stock movements.
- Night audit, operational reporting and exports.
- Printer/device connectivity.
- An offline-first roadmap for unreliable internet environments.

This is a transactional operations product, not merely a dashboard. Correctness, auditability, tenant isolation and recovery are more important than superficial feature completeness.

## 4. Current implementation reality — do not overstate it

The active root application is Vite + React 18. The project is hybrid:

- `src/data/PmsStore.jsx` still orchestrates PMS state consumed by existing UI.
- `src/data/AppStore.jsx` still orchestrates POS state, while loading persistent table sessions, kitchen orders and printer configuration through services.
- `src/services/*` contains Supabase-backed domain operations.
- `src/lib/query-client.js` configures TanStack Query, but the app is not yet uniformly migrated to query-driven server state.
- Supabase Auth, PostgreSQL, RLS, RPC and Realtime are already part of the system.
- Some screens still use static/demo data; verify the exact module before describing it as live.
- Persistent POS sessions, receipts, KDS and printer configuration do not mean the whole application is offline-first.
- IndexedDB outbox synchronization and a shared LAN Edge Server are target capabilities, not assumed completed features.

When reporting status, use **implemented / partial / planned / unverified** and cite the source file or test that supports the claim.

## 5. Main source map

| Area | Entry points / key files |
|---|---|
| App bootstrap and routes | `src/main.jsx`, `src/App.jsx` |
| Main hotel shell | `src/pages/POSApp.jsx`, `src/components/shell/`, `src/components/layout/` |
| Authentication | `src/lib/AuthContext.jsx`, `src/services/authService.js`, `src/lib/supabaseClient.js` |
| Route and feature access | `src/lib/AdminRoute.jsx`, `src/lib/FeatureGate.jsx`, `src/lib/entitlements.js`, `src/data/modules/navArchitecture.js` |
| PMS state | `src/data/PmsStore.jsx` |
| PMS services | `src/services/pmsService.js` |
| POS state | `src/data/AppStore.jsx` |
| POS services | `src/services/posService.js` |
| Inventory services | `src/services/inventoryService.js` |
| Platform services | `src/services/platformService.js` |
| Printer connectivity | `src/services/printerService.js`, `src/services/printService.js`, `tools/print-agent/` |
| Query cache | `src/lib/query-client.js` |
| PMS UI | `src/components/modules/Reservations.jsx`, `src/components/pms/RoomPlanner.jsx`, `src/components/modules/Folio.jsx` |
| POS UI | `src/components/pos/`, `src/components/modules/KitchenDisplay.jsx` |
| Cashier and audit | `src/components/modules/Cashier.jsx`, `src/components/modules/NightAudit.jsx` |
| Database | `supabase/migrations/`, `supabase/tests/` |
| Tests / scripts | `tools/`, `scripts/`, `src/**/*.test.*`, `supabase/tests/` |
| Design system | `Design.md`, `design-system/olitechs-pms-pos/`, `src/index.css` |

## 6. Required architecture boundaries

### Frontend request path

`Page / Component → feature hook or controller → domain service → Supabase client → PostgreSQL / RPC`

- Presentational components must not call Supabase directly.
- Keep data access in service modules.
- Use TanStack Query for server-state fetching, cache invalidation and mutations as the migration is approved.
- Use Zustand for transient client/UI state when approved; it is not a replacement database.
- Keep React context stores temporarily where needed to preserve existing screen contracts.
- Do not add a new competing global data store.

### Data ownership

- Supabase Auth owns authenticated identity and session lifecycle.
- PostgreSQL owns authoritative persisted operational records.
- RLS and server-side authorization enforce property/tenant boundaries.
- RPCs/transactions enforce concurrent and financially sensitive operations.
- Browser state is presentation/cache state, never an authorization boundary.
- Browser `localStorage` is for small preferences only, not the operational database.

### Offline target

The approved direction is IndexedDB (e.g. Dexie) for structured local data, a durable outbox for queued mutations, idempotent server processing, domain-aware conflict resolution and a PWA application shell. Multi-terminal hotel-wide offline operation requires a local LAN Edge Server. Do not claim these capabilities are complete unless code and tests prove them.

## 7. Critical invariants

1. **Tenant isolation:** every tenant-scoped read/write must be authorized server-side. A client-provided `property_id` is not proof of access.
2. **Reservations:** client availability checks are advisory. Database transactions/constraints must prevent concurrent double booking.
3. **Money:** use integer minor units at the database boundary; do not make floating-point JS values the canonical financial record.
4. **Folio:** posted charges, payments and adjustments must remain traceable. Correct with reversals/adjustments, not silent mutation.
5. **Payments:** never infer provider confirmation from a local UI state or offline queue item.
6. **POS:** preserve order/session idempotency, receipts, KDS recovery and printer separation.
7. **Night audit:** close must be atomic and auditable; never partially advance the business date.
8. **Inventory:** record movements and enforce stock-location/action permissions in trusted backend logic.
9. **Printing:** printer success/failure must not silently reverse or duplicate a financial transaction.
10. **Secrets:** never commit service-role keys, passwords, tokens or private credentials.
11. **Migrations:** migration filenames and order are deployment history. Duplicate prefixes exist; never rename or replay applied migrations casually.
12. **Existing workflows:** do not remove a screen or service until all consumers, routes, tests and data dependencies have been traced.

## 8. Protected / high-risk areas

Do not perform broad rewrites or deletions of:

- `src/data/AppStore.jsx`
- `src/data/PmsStore.jsx`
- `src/components/pms/RoomPlanner.jsx`
- `src/components/pos/`
- `src/services/printerService.js` and print/receipt flows
- `src/components/modules/Cashier.jsx`
- `src/components/modules/NightAudit.jsx`
- `src/lib/AuthContext.jsx`
- `src/lib/AdminRoute.jsx`
- `supabase/migrations/`
- `v6/` until a separately approved cleanup

Before touching one of these, map its imports, callers, data contracts, database dependencies and tests. Propose a migration plan first.

## 9. Required task workflow

For each task, follow:

1. **Understand:** restate the user outcome and acceptance criteria.
2. **Inspect:** read governing docs, relevant source, migrations and tests.
3. **Baseline:** inspect git status/diff, current branch, scripts and existing behavior.
4. **Plan:** list files to change, risks, migrations, tests and rollback.
5. **Approval:** obtain approval where Phase 0/phase gate or destructive changes require it.
6. **Implement:** small, focused changes; preserve public contracts.
7. **Verify:** run relevant tests, lint, typecheck and production build.
8. **Regression check:** verify adjacent workflows, permissions, tenant isolation and error paths.
9. **Review diff:** remove unrelated edits and generated noise.
10. **Report:** list changed files, behavior, commands/results, migrations, known limitations and commit SHA.

Never claim a test passed unless it was actually run and its exit status was observed.

## 10. Commands

Check `package.json` before assuming scripts exist. Current documented scripts include:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test:architecture
npm run check:contrast
npm run print-agent
```

The print agent is a separate local Node.js process. Read `docs/PRINT_AGENT_SETUP.md` before changing it or asking an operator to expose it.

## 11. Database migration protocol

Before a migration:
1. Read all relevant migration files and the migration-provenance documentation.
2. Establish which migrations are applied to the target database using the approved Supabase workflow.
3. Inspect dependencies, RLS policies, grants, triggers, functions and existing data.
4. Prefer additive, forward-only changes.
5. Add regression tests for tenant scope, permissions, concurrency and data integrity.
6. Never run a migration against production without explicit authorization and a rollback/recovery plan.

Repository migration files do not prove production migration state.

## 12. Definition of done

A task is not complete merely because code was written. Completion requires:
- acceptance criteria met;
- no unrelated destructive changes;
- relevant automated tests run;
- build/lint/typecheck results reported accurately;
- security and domain invariants reviewed;
- docs updated when behavior or architecture changes;
- limitations and unverified production behavior disclosed.

## 13. Further project references

- [Product requirements](../PRD.md)
- [Architecture](../Architecture.md)
- [Engineering rules](../Rules.md)
- [Implementation phases](../Phases.md)
- [Design system](../Design.md)
- [Project memory](../Memory.md)
- [Agent operating rules](../AGENTS.md)
- [Workflow catalogue](WORKFLOW_CATALOG.md)
- [Visual architecture diagrams](ARCHITECTURE_DIAGRAMS.md)
- [Languages and technology stack](TECH_STACK_AND_LANGUAGES.md)
- [Repository audit](AUDIT.md)
- [Print Agent setup](PRINT_AGENT_SETUP.md)
