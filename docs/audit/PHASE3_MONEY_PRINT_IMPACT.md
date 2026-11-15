# Phase 3 — Money & Print Batch (F5, F6, F7, F11, F12)

**Status:** implemented on `phase3/money-print-fixes`, based on `main` @ `f2cafbc`.
**Source of truth:** `AUDIT.md` §4e F5, F6, F7, F11, F12.

Risk labels (same as the earlier batch):

- **R1 (UI-only)** — no data, no schema, no workflow change.
- **R2 (data path)** — changes what is persisted, but no schema change.
- **R3 (schema-adjacent)** — requires a migration; deploy order matters.

---

## 1. F5 — Void lookup downloaded the whole property day and matched strings client-side

**Where:** `BillPayment.jsx` receipt print, `pmsService.listVoidedItems`.

**Before:** every settlement fetched `pos_void_items` for the property and the
current operational day, then filtered in the browser with
`String(v.table_number) === tableLabel(table) && String(v.order_number) === order`.
On a busy day that is the whole day's voids for every table. The day window also
ended at `23:59:59+03:00`, so a void in the last second of the day was invisible.

**After:** `listVoidedItems(propertyId, { orderNumber, tableNumber })` adds
`.eq()` filters to the query and uses a half-open window
(`>= day 00:00` and `< next day 00:00`). `BillPayment` passes the same two values
it used to compare, so the returned rows are the same set — the match simply
happens in Postgres.

**Impact:** R2-lite. No schema, no new data. Kitchen Display keeps calling the
service with no filters and still gets the day's list.

**Residual (not fixed):** a table that is opened, settled and reopened on the
same day reuses the bare `ORD-<table>` number when no order number is supplied,
so an earlier session's void could still be counted on the receipt. Fixing that
needs the void rows to carry the POS session id, which is a schema change.

## 2. F6 — Bill money was computed and persisted in floating point

**Where:** `BillPayment.jsx`, `OrderTaking.jsx`, `POSContainer.jsx`; new
`src/lib/money.js`.

**Before:** `subtotal` was a raw `price * qty` float sum; VAT, discount and total
were rounded a single time at the end with `Math.round(x * 100) / 100`. The
unrounded/tail values could reach the sale RPC, the VAT snapshot and the printed
receipt (e.g. `59.970000000000006`).

**After:** all canonical amounts are derived in integer cents and converted back
to a two-decimal `Number` once, at the persistence/presentation boundary
(`toMinor`/`fromMinor`/`percentOfMinor`/`inclusiveTaxMinor`). The split-tender
comparison now compares cents instead of floating-point products. The running
ticket and the POS session total use the same normalisation.

**Impact:** R2. Values are unchanged for ordinary two-decimal prices; values that
previously carried a binary tail are now exact. VAT semantics did not change
(exclusive: round the tax on the discounted amount; inclusive: tax extracted from
it; `posTax.addVat` still rounds the menu-ticket VAT to a whole shilling).

**Residual:** line prices themselves are still stored as decimals in the POS
store; only the amounts that are persisted as money are guaranteed two-decimal.
A full minor-unit store would change the persisted order-line shape and is not
part of this batch.

## 3. F7 — Split-payment rows keyed by array index

**Status:** already fixed on `main` (rows use `key={p.id}` and new rows get a
timestamped id) and already covered by
`supabase/tests/pos_table_join_quantity_void_contract.test.mjs`. No code change
in this batch; the audit entry is stale.

## 4. F11 — Manager-PIN variance threshold was the literal KES 500

**Where:** `CloseShiftModal.jsx` (five uses), `settingsService.js`,
`lib/posShiftPolicy.js`, new POS Settings → Shift policy tab, additive migration.

**Before:** `Math.abs(variance) > 500` decided whether closing a shift needed a
manager PIN, for every property.

**After:** the tolerance is `property_settings.pos_cash_variance_threshold`
(`numeric(12,2) not null default 500`), normalised by `posShiftPolicy`
(blank/negative/non-numeric falls back to 500; `0` means "any variance needs a
manager PIN"). The close dialog loads it with the shift summary, shows it under
the variance, and uses it for the danger styling, the approval prompt and the
button label. Property admins edit it in POS Settings → Shift policy.

**Impact:** R3. Additive column with a default, so existing rows keep the old
behaviour. The reader defaults to 500 when the column is absent, and receipt-only
saves never write the column, so the frontend is safe before the migration is
applied — but the **Shift policy tab requires the migration**. Deploy order:
apply `20261115120000_pos_cash_variance_threshold.sql` first.

## 5. F12 — Shift reports ignored every assigned printer except the first

**Where:** `printService.js` (`printShiftReport`, `printShiftPreview`,
`confirmedCopies`), `ShiftManagementPage.jsx`, `CloseShiftModal.jsx`.

**Before:** both shift screens collected every `shift_reports`/`reports`
assignment and then used `targets[0]`, silently dropping the rest.

**After:** both screens pass the full list. `normalizePrinters` de-duplicates by
printer id. One assigned printer still receives the cashier + manager pair; with
two or more, each printer receives one copy and the copy labels alternate, so both
labels are still produced. The live summary prints to every assigned printer.
`confirmedCopies` is now filtered by `printer_id`, so a retry after a partial
failure only re-sends the copy that failed on that printer, and force-reprint
still bypasses the check.

**Impact:** R2. One-printer properties see no change. Multi-printer properties now
print where they were configured to print; the result/toast aggregates every
destination and only says "printed" when all destinations succeeded.

---

## 6. Delivery plan

| # | Commit | Risk | Files |
|---|---|---|---|
| 1 | `fix(pos): scope receipt void lookup to the order in the query` | R2-lite | `pmsService.js`, `BillPayment.jsx`, void contract test |
| 2 | `fix(pos): compute bill money in integer minor units` | R2 | `lib/money.js` + test, `BillPayment.jsx`, `OrderTaking.jsx`, `POSContainer.jsx`, money contract test |
| 3 | `fix(pos): send shift reports to every assigned printer` | R2 | `printService.js`, `ShiftManagementPage.jsx`, `CloseShiftModal.jsx`, fan-out + outcome contract tests |
| 4 | `fix(pos): make the shift cash variance tolerance configurable` | R3 | new migration, `settingsService.js`, `posShiftPolicy.js` + test, `CloseShiftModal.jsx`, new `ShiftPolicyTab.jsx`, `POSSettings.jsx`, settings contract test |

Verified after each commit: `npm run lint` (includes brand/colour/link checks),
`npm run typecheck`, `npm run build`, `npm run test:architecture`,
`npm run test:reports`.

## 7. Deploy order

1. Apply `supabase/migrations/20261115120000_pos_cash_variance_threshold.sql`.
2. Deploy the frontend.

The frontend degrades to the KES 500 default until step 1 is done, but saving a
new tolerance from the Shift policy tab needs the column.
