# Phase 3 — Behaviour Fix Batch (F4, F8, F9, F10)

**Status:** impact write-up — no code changed yet.
**Baseline:** `main` @ `b88cfc8` (PR #152 / branch `phase3/audit-quickfixes` is open and independent of this batch).
**Source of truth:** `AUDIT.md` §4e F4, F8, F9, F10.

Risk labels used below:

- **R1 (UI-only)** — no data, no schema, no workflow change.
- **R2 (data path)** — changes when/what is persisted, but no schema change and no money movement.
- **R3 (schema-adjacent)** — requires a database migration; deploy order matters.

---

## 1. F4 — Payment recorded but the UI says "Payment was not recorded"

**Where:** `src/components/pos/BillPayment.jsx:45-129` (`confirmPayment`).

### Current order of operations

1. `recordPosSale(...)` — writes the sale + payment allocations (`:90`). **This is the money step.**
2. `store.completeSale(...)` — local POS receipt record, `skipPrint: true` (`:92`).
3. `listVoidedItems(...)` — already `.catch(()=>[])`, cannot throw (`:93-94`).
4. `printReceipt('RECEIPT', ...)` (`:95`) — **this call can throw**:
   - `printService.js:886` re-reads `property_settings` and throws on a query error;
   - `:890` throws on the unsettled-receipt settings query (only `UNSETTLED`, but the same pattern);
   - `:901-902` `getPrinters` / `getAssignments` throw on a query error (`:38`, `:46`);
   - `:957` / `:988` logo rasterisation;
   - `:992` printer transport adapter.
5. `onConfirmPayment()` (`:98`) — closes the table and returns to the floor.
6. Cash drawer pulse (`:101-116`) — already defensive.

### Failure mode

If step 4 throws, execution jumps to the single `catch` at `:127`, which sets
`"Payment was not recorded: <message>"` and shows the same toast. In reality:

- the sale, payment allocation, stock lines and shifts linkage are committed;
- `onConfirmPayment()` never ran, so the table **stays occupied** and can be
  double-charged or settled again;
- the idempotency key (`posSaleContract.createPosSaleIdempotencyKey`) prevents a
  duplicate ledger row on retry, but staff are told the opposite of the truth
  and the floor state is wrong.

This is a correctness/trust bug, not a print bug.

### Proposed change (R2)

- Track `saleRecorded = false` and set it immediately after `recordPosSale` resolves.
- Wrap only the print call: a throw is normalised to
  `{ ok: false, outcome: 'failed', friendlyError: message }` and logged with
  `console.warn`, so printing can never abort the settlement path.
- Release the table exactly once via a `released` guard:
  - normal path: after the (now non-throwing) print call, as today;
  - error path: if `saleRecorded` is true, also call `onConfirmPayment()` before
    reporting, so the floor never shows a paid table as occupied.
- Split the catch message:
  - `saleRecorded === false` → `"Payment was not recorded: …"` (unchanged);
  - `saleRecorded === true` → `"Payment was recorded, but the table could not be
    fully closed: …"` + toast `"Payment recorded. Print the receipt from
    Receipts."` (never invite a second charge).
- Do **not** change: `recordPosSale` payload, VAT snapshot, discount, split
  allocations, idempotency key, receipt content, drawer logic.

### Behaviour after

| Scenario | Today | After |
|---|---|---|
| Sale write fails | "not recorded", table open | unchanged |
| Sale ok, printer query throws | "not recorded", table **occupied** | "recorded, print from Receipts", table **released** |
| Sale ok, printer offline (`ok:false`) | unchanged correct warning | unchanged |
| Sale ok, receipt prints | success | unchanged |

### Regression risk / tests

- Risk: low. `store.completeSale` cannot realistically throw (it swallows print
  errors and the `skipPrint` path is synchronous state), but if it does, the new
  branch reports the sale as recorded and releases the table — the correct
  outcome.
- Tests: new `src/components/pos/BillPayment.confirmPayment.contract.test.mjs`
  source-scan contract (repo convention):
  - `recordPosSale` result captured before the print call;
  - print call wrapped in its own `try`;
  - catch text conditional on `saleRecorded`;
  - `onConfirmPayment` reachable on both paths and guarded against double calls.
- Manual/dev check: no Supabase env is available locally, so runtime proof is
  limited to build + contract tests (same constraint as Phase 2).

---

## 2. F8 — KOT sent-snapshot race

**Where:** `src/components/pos/POSContainer.jsx:209-262`,
`src/data/AppStore.jsx:253-262`, `src/services/posService.js:148-174`.

### Current behaviour

`handleSendToKitchen`:

1. captures `linesSnapshot` from React state (`:212`);
2. navigates away (`setActiveTab('floor')`, `setActiveTable(null)`, `:222-223`);
3. `await store.fireKitchenOrder(...)` → inserts a new kitchen order row (`:225`);
4. `await persistSentSnapshot()` → `markKotSent` UPDATE of
   `pos_table_sessions.kot_sent_order_lines` (`:247`, `AppStore:260`).

Because the POS leaves the order screen before step 3 finishes, staff can reopen
the same table and tap **Send** again. Two sends then run concurrently:

- **Duplicate KDS records:** each tap creates its own `kitchen_orders` row, so the
  kitchen sees the same items twice even though the printer path may have been
  idempotent.
- **Stale snapshot overwrite:** `markKotSent` is a full-column `UPDATE`
  (`posService.js:149-159`). Whichever request lands last wins — if the *older*
  request lands after the newer one, the newer lines are marked unsent, and the
  next send reprints them.

### Proposed change (R2)

Two independent, small guards — no schema change:

1. **Serialise snapshot writes per table** in `AppStore.setKotSentOrderLines`
   using a keyed promise chain (new pure helper
   `src/lib/keyedQueue.js`, `enqueue(key, task)`):
   - writes are issued in call order, so the newest snapshot is always the last
     write;
   - a rejected write is logged and does not wedge the chain for that table.
2. **Block a second in-flight send for the same table** in
   `POSContainer.handleSendToKitchen` (`sendingTablesRef`, set in `try`, cleared
   in `finally`). A second tap while the first send is still persisting shows
   `"Order … is still being sent. Wait for it to finish."` and returns.

Deliberately **not** changed: the optimistic local snapshot (instant UI
correctness), ticket routing, print retry toasts, `fireKitchenOrder` semantics.

### Behaviour after

- Rapid double-tap → one kitchen order, one snapshot write, no duplicate ticket.
- A genuinely new send after the first completes → unchanged.
- If the snapshot write fails, the existing "do not resend" toast still fires and
  the per-table chain keeps working for the next attempt.

### Regression risk / tests

- Risk: low–medium (data path). The queue only reorders writes that previously
  raced; it never drops a write. Guard is per table, so other tables are
  unaffected.
- Tests: `src/lib/keyedQueue.test.mjs` — out-of-order completion must still
  persist in call order, and a rejected task must not block the next one.
  Source contract test asserting `sendingTablesRef` guard + `finally` reset.
- No migration, no RPC change; server remains last-write-wins per table.

---

## 3. F9 — Opening-shift notes silently dropped  ⚠️ R3

**Where:** `src/components/pos/CloseShiftModal.jsx:14-59` (`OpenShiftModal`),
`:31` call site; `src/services/shiftService.js:44-60`;
`supabase/migrations/0025_cashier_controls.sql:17-30, 75-110`.

### Current behaviour

`OpenShiftModal` collects `notes` (textarea at `:52`) and calls
`shiftService.openShift({ propertyId, openingCash, notes })`. The service
signature is `openShift({ propertyId, openingCash })` (`:44`) and the RPC is
`fn_open_cashier_shift(p_property_id, p_opening_float)` (`0025:75-78`). The
`cashier_shifts` table only has `closing_notes` (`0025:29`).

So the typed text is discarded without warning. Closing notes work
(`fn_close_cashier_shift(..., p_notes)`, `:112-169`), which makes the asymmetry
look like a bug to staff.

### Proposed change (R3 — needs explicit migration approval)

1. **Migration** `20261114100000_pos_shift_opening_notes.sql`:
   - `alter table public.cashier_shifts add column if not exists opening_notes text;`
   - `drop function if exists public.fn_open_cashier_shift(uuid, numeric);`
     (required — adding a defaulted parameter creates an ambiguous overload)
   - recreate with
     `fn_open_cashier_shift(p_property_id uuid, p_opening_float numeric default 0, p_notes text default null)`
     inserting `coalesce(nullif(trim(p_notes), ''), null)` into `opening_notes`;
   - `revoke`/`grant execute` for the new signature (mirrors `0025:110`).
   - No RLS change, no data backfill, no renumbering of applied migrations.
2. **Service:** `openShift({ propertyId, openingCash, notes = '' })` passes
   `p_notes: notes || null`; `normalizeCashierShift` already spreads the row, so
   `opening_notes` flows through unchanged.
3. **UI (small):** show the stored opening note read-only in the close-shift
   summary ("Opening notes") so the value is verifiable, and include it in the
   shift report `notes` array when present. If you prefer zero print-output
   change, I will keep it to the on-screen summary only.

### Deploy order (important)

The frontend and function signature must not diverge:

- apply the migration **first**, then ship the frontend;
- if the frontend is released first, opening a shift with a non-empty note fails
  with a PostgREST "function not found" error. To make that impossible I will
  send `p_notes` **only when the note is non-empty**; shifts opened without a
  note keep working against the old 2-argument function until the migration
  lands.

### Regression risk / tests

- Risk: medium only because of the schema step. A shift cannot be opened twice
  (unique open shift per user), so a retry after an error is safe.
- Tests: contract test asserting the migration contains the column, the
  drop+recreate pair, the grant, and that `shiftService.openShift` forwards
  `p_notes`; `npm run test:architecture` covers the shift/RPC contracts.
- Rollback: the frontend change alone is inert; the migration is additive
  (`add column if not exists`) and the function keeps its previous behaviour
  when `p_notes` is null.

---

## 4. F10 — Direct Supabase query inside a presentational modal

**Where:** `src/components/pos/CloseShiftModal.jsx:87` (inline
`import('@/lib/supabaseClient')` + `from('property_settings')`).

### Current behaviour

After a successful close, the modal fetches the raw `property_settings` row
purely to decorate the closing report. This breaks the AGENTS.md rule that
presentational components must not talk to Supabase, bypasses the settings
service, and adds a dynamic-import chunk.

### Proposed change (R1)

Replace the inline query with `getPropertySettings(propertyId)` from
`@/services/settingsService` (`:74-83`).

Output is unchanged: the function returns the row, or `DEFAULT_RECEIPT_SETTINGS`
whose company fields are empty strings. `shiftReportHtml` /
`shiftPreviewHtml` already fall back with
`data.settings?.property_name || data.propertyName` and optional chaining, so an
empty-defaults object renders exactly like the current `null`.

Side effect: removes one `supabaseClient` dynamic import from the POS bundle.

### Regression risk / tests

- Risk: very low (read-only, presentation). The only difference is that a
  missing settings row now yields defaults instead of `null` — both render the
  same header.
- Tests: source contract asserting `CloseShiftModal.jsx` contains no
  `supabaseClient` / `.from('property_settings')`, and that
  `getPropertySettings` is used.

---

## 5. Out of scope (noted, deliberately not changed)

- **`managerApproved` is silently ignored**
  (`CloseShiftModal.jsx:77` passes it, `shiftService.js:62` does not accept it).
  The server derives manager rights from the caller's role
  (`20261008150000:142-143`), so there is no approval bypass — only a dead
  argument. Cleaning the signature is cosmetic; I will remove the argument in a
  later tidy-up rather than mixing it into this batch.
- F5 (void lookup), F6 (float money), F7 (split-row keys), F11 (KES 500
  threshold), F12 (single shift-report printer) stay in the audit backlog.
- Palette/tokens, payment legend, room statuses, print routing and
  `Cashier.jsx` / `v6/` are untouched.

---

## 6. Delivery plan

| # | Commit | Risk | Files |
|---|---|---|---|
| 1 | `docs(phase3): impact review for behaviour fixes F4/F8/F9/F10` | — | this file |
| 2 | `fix(pos): never report a recorded payment as unrecorded` | R2 | `BillPayment.jsx`, new contract test |
| 3 | `fix(pos): serialise KOT sent-snapshot writes per table` | R2 | `src/lib/keyedQueue.js` + test, `AppStore.jsx`, `POSContainer.jsx`, contract test |
| 4 | `feat(shifts): persist opening-shift notes` | R3 | new migration, `shiftService.js`, `CloseShiftModal.jsx`, contract test |
| 5 | `refactor(pos): load shift report settings through settingsService` | R1 | `CloseShiftModal.jsx`, contract test |

Verification after every commit: `npm run lint`, `npm run typecheck`,
`npm run build`, `npm run test:architecture`, `npm run test:reports`,
`npm run check:links`, `npm run check:contrast`.
Branch: `phase3/behaviour-fixes` off `main`; PR opened only after the batch is
green; merge only on your word.

## 7. Approval needed

1. **F4/F8/F10** — implementation as described (no schema).
2. **F9** — approves one additive migration and one RPC signature replacement,
   deployed before the frontend.
3. **F9 display** — on-screen summary only, or also add the note to the printed
   shift report?
