# Fallback Audit

Every place the root application can continue with substitute behaviour instead of
real data is listed here. Two rules apply:

1. A fallback must never invent hotel data (names, tables, menu items, prices,
   reservation counts, staff). Empty and clearly-labelled unknown states are
   correct; plausible-looking sample values are not.
2. A fallback that swallows an error must be either (a) deliberate and
   documented below, or (b) reported to the user or to the console. Silent
   failure is only acceptable where there is genuinely nothing to act on.

Owner of this file: whoever changes a fallback. Update it in the same commit.

---

## 1. Removed: simulated data (`src/data/mockData.js`)

`mockData.js` seeded the POS with a fictional restaurant: menu categories and
items, VAT rate, per-category production centres, tonight's reservation count,
floor zones/tables, and a waiter list. Several screens silently rendered those
values whenever the real query failed or the property had no configuration,
which made an unconfigured property look configured and an offline property look
booked.

The file has been deleted. Replacements:

| Was exported | Now | Behaviour when data is missing |
|---|---|---|
| `VAT_RATE`, `VAT_LABEL` | `src/lib/posTax.js` (`VAT_RATE`, `VAT_LABEL`, `addVat`) | 16% constant, matching `property_settings` defaults. Real setting wiring would change ticket totals, so it is a named constant for now. |
| `tablePrefix`, `tableLabel`, `TABLE_CARD` | `src/lib/posTables.js` | Pure formatting/geometry, no data. |
| `CENTERS` | `src/lib/posProduction.js` (`PRODUCTION_CENTERS`) | Fixed `Kitchen`/`Bar` routing options, matching printer `center`. |
| `CATEGORIES`, `MENU_ITEMS`, `CATEGORY_CENTER` | `inventoryService.listPosMenu()` only | Empty category rail and an explicit "menu could not be loaded" message. No demo menu. |
| `RESERVATIONS_TONIGHT` | `pmsService.listReservations()` in `FloorPlan.jsx` | Count of real arrivals dated today; `—` while loading, `n/a` when the query fails. |
| `INITIAL_ZONES`, `INITIAL_STAFF` | None — see §2 and §3 | Empty floor until the owner creates zones; staff read from `public.staff`. |
| `INITIAL_STAFF` / `INITIAL_ZONES` in `AppStore` | `zones` state hydrated per property from this browser | Empty array when no layout has been saved. |

`src/data/platformData.js` was also trimmed to the `MODULES` navigation list.
The other "platform" exports (dashboard figures, kitchen queue, guest directory,
current staff session) were illustrative sample data with no remaining consumer
and have been removed.

---

## 2. Kept: POS floor layout in browser storage

`zones` (zones, tables, tile positions) is configuration, not transactional
data, and there is no `zones`/`tables` table in the schema. It is stored per
property under `localStorage` key `olitech_pos_floor:<propertyId>`:

- Read is guarded by `Array.isArray`; a corrupt value logs
  `[POS] floor layout could not be read; starting empty` and starts empty.
- Write failures (quota, private mode) log
  `[POS] floor layout could not be saved`.
- `zonesFor` gates the write effect so one property's layout can never be
  written into another property's key during a property switch.

Consequence to keep in mind: a different browser or a cleared cache starts with
an empty floor. Table **sessions**, printers and kitchen orders are server-side
and are not affected.

## 3. Kept: POS staff identity

The "waiter" field and the Staff screen read `authService.listStaff(propertyId,
'pos')` — active rows in `public.staff` assigned to the `pos` module. There is no
local staff list, and no way to add staff from POS.

- `POSContainer.jsx` stores the list and a `posStaffError`. A failed load logs
  `[POS] staff list could not be loaded` and the Open Table dialog shows the
  error instead of a bare "no waiters" message, because a table cannot be opened
  without a selection.
- `StaffAdmin.jsx` renders a read-only list with loading / empty / error states
  and links to Users & Roles (`/backoffice/employees/access-rights`).
- `OpenTableDialog.jsx` distinguishes "no staff assigned" from "list failed".

## 4. Kept: print routing fallback (`src/services/printService.js`)

`findPrinterForAssignment` does not simply take the first matching printer. It
prefers an assigned printer that is known to be connected, then the originally
requested printer as a last resort, then any assigned printer not marked
offline. If none exists it returns `null`, and the caller reports
`No printer assigned to <assignment>.` — it never pretends a ticket printed.

A bitmap logo that cannot be decoded falls back to a text-header buffer
(`fallbackTextBuffer`), so a receipt still prints when the logo fails.

## 5. Kept: subscription paywall compatibility

`src/components/auth/PaywallGuard.jsx` has one narrow allow-path:
`reason: 'approved_package_fallback'`. It applies **only** when the RPC is
missing from PostgREST's schema cache (`isSchemaCompatibilityError`) — i.e. a
migration has not been exposed yet. A real `allowed: false` from the RPC is
always honoured. If the RPC errors for any other reason, access is denied with
the error message, not granted.

## 6. Kept: silent catches that cannot act

These are deliberate. Each is listed so a future reviewer does not "fix" them
into a crash.

| Location | Why it is silent |
|---|---|
| `src/lib/AuthContext.jsx:105` | `sessionStorage.removeItem` during logout — storage may be blocked; logout must still complete. |
| `src/lib/featureFlags.js:19` | Flag read from `localStorage` — a blocked read falls through to env/default. |
| `src/components/auth/RouteGuard.jsx:12,25,28` | `sessionStorage` JSON helpers — corrupt/blocked storage yields `{}`/`null`, forcing a fresh PIN rather than crashing the guard. |
| `src/components/auth/RouteGuard.jsx:71` | Re-validating an already-open workspace — a transient network failure must not eject staff mid-service. The next poll retries. |
| `src/components/auth/RouteGuard.jsx:87,105` | Fire-and-forget server touch/clear of the active staff session; the local grant is already updated. |
| `src/pages/SettingsPrinters.jsx` clipboard catch | Clipboard permission denied — the pairing code is also on screen. |

## 7. Converted from silent to reported (this phase)

| Location | Before | After |
|---|---|---|
| `src/components/pos/OrderTaking.jsx` void-slip settings | `.catch(() => null)` | Defaults still used; logs `[POS] void-slip settings unavailable; using defaults`. |
| `src/components/pos/CloseShiftModal.jsx` closing-report settings | `.catch(() => null)` | Defaults still used; logs `[POS] shift closing report settings unavailable; using defaults`. |
| `src/pages/SettingsPrinters.jsx` post-save refresh (3 sites) | `.catch(() => {})` | Logs `[Printers] ... refresh ... did not complete` with the error. The user-facing recovery message is unchanged. |
| `src/components/pos/POSContainer.jsx` staff list | `.catch(() => {})` | Logged and surfaced in the Open Table dialog (§3). |
| `src/components/pos/FloorPlan.jsx` arrivals | hard-coded `6` | Real query; `—` / `n/a` states. |

## 8. Remaining risk

- Menu images, categories and modifiers depend entirely on the property's
  catalogue. A property with no products sees an empty POS by design; the
  menu editor (`MenuManager.jsx`) is the place to add them.
- Zone/table configuration is per browser (see §2). Multi-terminal properties
  will not share a floor until a `zones`/`tables` table exists. Tracked in
  `docs/OPEN_QUESTIONS.md`.
- `VAT_RATE` is a constant, not the property setting. Changing it changes money,
  so it needs an explicit decision, not an opportunistic cleanup.
