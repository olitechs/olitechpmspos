# OliTechs PMS + POS — Engineering Rules

These rules are non-negotiable for the restructure unless a later approved Architecture/ADR explicitly supersedes them.

## 1. Source-of-Truth Rule

- PostgreSQL/Supabase is the authoritative source for hotel operational data.
- React state is a view/state layer, not the source of truth.
- `src/data/PmsStore.jsx` and `src/data/AppStore.jsx` may remain during migration, but new authoritative domain behavior must not deepen the dependency on them.

## 2. Code Rules

### Service boundary

**Do not call Supabase directly from components.**

Allowed pattern:

`Component → Hook/feature service → src/services/* → Supabase`

Relevant existing services:

- `src/services/authService.js`
- `src/services/pmsService.js`
- `src/services/posService.js`
- `src/services/inventoryService.js`
- `src/services/platformService.js`
- `src/services/printerService.js`

### Types

- No `any` in new or modified TypeScript.
- The current repository contains substantial JSX/JS, so migration toward TypeScript must be incremental and typed at service boundaries.
- Domain objects should have explicit types/interfaces before being passed across modules.

### Forms

All new/rewritten forms must use:

- `react-hook-form`
- `zod`
- `@hookform/resolvers`

These dependencies already exist in `package.json`.

Validation must be shared between UI constraints and server/database constraints where business integrity matters.

### Error handling

- Never swallow service errors.
- Every mutation must expose success/failure state to the user.
- Never report success before the authoritative write completes.
- Network failure must distinguish “not committed” from “committed but response lost”.

## 3. UI Rules

### Design tokens

Use the approved design-system tokens documented in:

- `tailwind.config.js`
- `src/data/palette.js`
- `src/data/themePalette.js`
- `design-system/olitechs-pms-pos/MASTER.md`
- `design-system/olitechs-pms-pos/pages/*.md`

**Phase 0 does not yet change these files.**

### No new visual tokens ad hoc

- No new arbitrary brand colors.
- No random gradients.
- No inline styles for design-system properties.
- No page-specific visual language that conflicts with the approved system.
- Prefer reusable Tailwind classes/components over duplicated styling.

### Interaction

- Keyboard focus must be visible.
- Destructive actions require confirmation/appropriate authorization.
- Loading states must not cause layout collapse.
- Empty states must provide a relevant next action.
- Tables need predictable density and horizontal overflow behavior.
- Operational POS controls must remain touch-friendly.

## 4. PMS Domain Rules

### Double-booking prevention

Never rely on:

`SELECT availability → client decides → INSERT reservation`

as the final protection.

The database must enforce the overlap rule atomically using an RPC/transaction/appropriate PostgreSQL constraint strategy.

For a room assigned from check-in date `D1` to check-out date `D2`, the occupied interval is:

`[D1, D2)`

Two stays conflict when their intervals overlap.

The repository already contains room-planner availability logic and RPCs in migrations such as:

- `0014_room_planner_production.sql`
- `0015_room_planner_date_inventory.sql`
- `0016_fix_room_planner_raise.sql`

Do not bypass those controls during migration.

### Money

- Persist monetary values as integer minor units (cents) at the database boundary.
- Never persist JavaScript floating-point currency as the canonical financial value.
- Currency formatting is presentation only.
- Tax/discount/rounding calculations must be deterministic and auditable.

### Folio

- Every charge/payment/adjustment needs an identifiable transaction.
- Posted financial records must not be silently overwritten.
- Corrections use reversal/adjustment semantics where required.
- Room charges must identify the source POS order/receipt.

### Night Audit

Night Audit is a financial boundary.

It must be atomic at the business-date level:

- Do not partially advance the business date.
- Do not mark audit complete if a blocking reconciliation step failed.
- Cashier/POS/room revenue/tax totals must reconcile before close.
- Any override must be authorized and audited.

Existing foundation: `supabase/migrations/0026_night_audit.sql` and `src/components/modules/NightAudit.jsx`.

### Cashiering

Existing workflow is backed by `0025_cashier_controls.sql` and `src/components/modules/Cashier.jsx`.

No cashier close may silently discard an over/short difference.

### POS

Existing persistent POS/KDS work in:

- `src/components/pos/POSContainer.jsx`
- `src/components/pos/FloorPlan.jsx`
- `src/components/pos/OrderTaking.jsx`
- `src/components/pos/BillPayment.jsx`
- `src/components/modules/KitchenDisplay.jsx`
- `supabase/migrations/0033_pos_table_sessions.sql`
- `supabase/migrations/0036_persistent_kitchen_orders.sql`
- `supabase/migrations/0037_persistent_printer_config.sql`

must not be removed during architectural migration.

## 5. Security Rules

- Supabase RLS is mandatory for tenant-sensitive tables.
- Client-supplied `property_id` is not proof of access.
- Platform-owner functions must verify platform-owner authority server-side.
- Hotel users must not reach `/admin/*) simply by typing the URL.
- Feature gates are UX controls, not security controls; database/RPC authorization remains authoritative.
- Passwords must never be stored by application code as plaintext.
- Session state must come from Supabase Auth, not a custom localStorage token.

## 6. Offline-First Rules

Offline-first does not mean “write everything to localStorage”.

- Define which operations are safe to queue.
- Give queued transactions stable client IDs/idempotency keys.
- Never replay a financial transaction twice.
- Mark queued/processing/committed/failed states explicitly.
- Reconcile conflicts using domain rules.
- The UI must show offline status.

## 7. Migration Rules

- Do not delete `src/data/PmsStore.jsx` or `src/data/AppStore.jsx` until imports are eliminated and behavior is verified.
- Do not delete `v6/` as part of Phase 1 without a separate approved cleanup plan.
- Do not renumber applied Supabase migrations.
- Existing duplicate migration prefixes require a migration inventory/decision record first.
- Prefer additive migrations over destructive changes.
- Every migration must be idempotent where practical and have a rollback/mitigation plan.

## 8. Git Rules

### Conventional commits

Examples:

- `docs: add PMS architecture foundation`
- `feat(auth): wire Supabase session authority`
- `feat(pms): add atomic reservation availability`
- `fix(pos): preserve offline order recovery`
- `refactor(data): migrate reservation reads to query hooks`

### Branch protection discipline

- Never push directly to `main` for a code change unless the build passes.
- Prefer feature branches and reviewable commits.
- Do not mix unrelated UI, schema and security changes in one commit.
- Documentation Phase 0 may be committed separately from implementation.

## 9. Required Verification

Before every implementation phase is considered complete:

- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run typecheck` where applicable
- [ ] Existing login works
- [ ] Existing hotel workspace routes work
- [ ] Existing platform-admin routes work
- [ ] POS table/session behavior works
- [ ] Receipts/payment behavior works
- [ ] Printer configuration behavior works
- [ ] Room Planner behavior works
- [ ] No unrelated module regresses

**Status: DRAFT - Awaiting Approval**
