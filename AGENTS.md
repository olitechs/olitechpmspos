# AGENTS.md

## Project Context

OliTechs PMS + POS is a standalone Hotel Property Management System and Point of Sale application in `olitechs/olitechpmspos`.

It originated from a Base44-oriented scaffold, but the active root application is now standalone Vite + React. The repository has an active root application plus a historical `v6/` duplicate tree. Do not treat `v6/` as the primary runtime.

### Current stack

- Vite
- React 18
- React Router
- Tailwind CSS
- Supabase JS / PostgreSQL / Auth / RLS
- TanStack React Query
- React Hook Form + Zod
- Framer Motion
- Radix UI
- Recharts
- jsPDF

### Current architecture reality

The project is hybrid:

- `src/data/PmsStore.jsx` contains PMS local React state/orchestration.
- `src/data/AppStore.jsx` contains POS state/orchestration and hydrates persistent POS/KDS data through services.
- `src/services/pmsService.js` and `src/services/posService.js` already use Supabase.
- `src/services/authService.js` handles authentication but retains legacy/browser compatibility behavior.
- `src/lib/AuthContext.jsx` owns client auth state.
- `src/lib/query-client.js` provides TanStack Query.
- `supabase/migrations/` contains the evolving database/RLS/RPC layer.

The target architecture is documented in `Architecture.md`.

## Required Reading Before Any Code

Every agent must read these root documents first:

1. `PRD.md`
2. `Architecture.md`
3. `Rules.md`
4. `Phases.md`
5. `Design.md`
6. `Memory.md`
7. `AGENTS.md`

Also inspect:

- `README.md`
- `FEATURE_ROADMAP.md`
- `supabase/migrations/README.md`
- `design-system/olitechs-pms-pos/MASTER.md`
- relevant page documentation under `design-system/olitechs-pms-pos/pages/`

## Working Notes

### 1. Non-negotiable Phase 0 gate

**No agent may start coding Phase 1 until all seven foundation documents are approved by the user.**

This includes “small fixes”, UI cleanup, schema edits, auth refactors and CSS changes that would effectively begin Phase 1.

### 2. Frontend Agent

Responsibilities:

- React components/pages
- Tailwind implementation
- responsive layout
- accessibility
- TanStack Query hooks
- Zustand client/UI state once approved
- form UX using React Hook Form + Zod
- preserving existing POS/PMS workflows

Primary areas:

- `src/App.jsx`
- `src/pages/`
- `src/components/`
- `src/hooks/`
- `src/lib/query-client.js`
- `src/index.css`
- `tailwind.config.js`

Must not:

- call Supabase directly from presentational components
- invent new brand colors
- delete existing PMS/POS workflows
- replace `PmsStore.jsx` / `AppStore.jsx` without the approved migration plan

### 3. Backend Agent

Responsibilities:

- Supabase schema
- PostgreSQL functions/RPCs
- RLS
- property/tenant isolation
- transactional PMS rules
- financial integrity
- audit logging
- migration governance

Primary areas:

- `supabase/migrations/`
- `src/services/pmsService.js`
- `src/services/posService.js`
- `src/services/platformService.js`
- `src/services/inventoryService.js`
- `src/lib/supabaseClient.js`

Must not:

- renumber applied migrations
- weaken RLS for convenience
- make client-side availability the final double-booking protection
- persist floating-point money as canonical financial data
- expose platform-owner powers to hotel users

### 4. QA Agent

Responsibilities:

- regression testing
- route/auth checks
- role/permission checks
- reservation conflict tests
- POS persistence/reconnect tests
- cashier/payment tests
- housekeeping/PMS state checks
- build/lint/typecheck
- browser/device verification

Required commands:

```
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
```

Use environment variable names from `.env.example` and never commit secrets.

### 5. Environment

The repository expects Supabase configuration through the Vite environment.

Primary variables documented in `supabase/migrations/README.md` include:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Use `.env.example` as the repository source for the complete expected environment list.

Never place production secrets in source code, Markdown or committed environment files.

### 6. File safety

Protect these during restructuring:

- `src/data/AppStore.jsx`
- `src/data/PmsStore.jsx`
- `src/components/pms/RoomPlanner.jsx`
- `src/components/pos/`
- `src/services/printerService.js`
- receipt/payment functionality
- `src/components/modules/Cashier.jsx`
- `src/components/modules/NightAudit.jsx`
- `src/lib/AuthContext.jsx`
- `src/lib/AdminRoute.jsx`
- `supabase/migrations/`
- `v6/` until separately approved for cleanup

### 7. Git discipline

Use Conventional Commits.

Examples:

- `docs: add PMS foundation architecture`
- `feat(auth): move session authority to Supabase`
- `feat(pms): migrate room availability queries`
- `fix(pos): prevent duplicate offline replay`

Never push code to `main` without a passing build.

Prefer small, reviewable commits. One domain migration should not silently rewrite unrelated modules.

### 8. Migration discipline

The migration directory contains duplicate numeric prefixes. Treat migration filenames as deployment history.

Before modifying migrations:

1. Inventory the applied database state.
2. Compare it to repository migration files.
3. Identify dependencies.
4. Add an explicit migration/governance note.
5. Never rename an already-applied migration just to make numbering sequential.

### 9. Documentation location

The Phase 0 architecture/product decisions are in:

- `PRD.md` — product requirements
- `Architecture.md` — current/target architecture
- `Rules.md` — engineering/domain/security rules
- `Phases.md` — implementation sequence
- `Design.md` — visual/UX system
- `Memory.md` — durable project decisions/gotchas
- `AGENTS.md` — agent roles and operating rules

### 10. Required implementation cycle

For every approved phase:

**AUDIT → BACKUP/BASELINE → IMPLEMENT → BUILD → TEST → FIX → VERIFY EXISTING FEATURES → COMMIT → NEXT PHASE**

An agent must report:

- files changed
- database migrations added/changed
- tests/checks run
- build result
- regressions checked
- known remaining risks

### 11. No destructive refactor

The objective is to add/replace architecture safely, not to remove functionality.

If a proposed change requires deletion, first prove:

- no imports remain
- no route depends on it
- no data migration depends on it
- replacement behavior passes regression tests
- the deletion is explicitly part of an approved phase

**Status: DRAFT - Awaiting Approval**
