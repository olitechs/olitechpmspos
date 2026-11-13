# Room Planner & Reservation UX — Phase 0 Audit

**Branch:** `main`  
**Scope:** inspection only; no application code or database changes in this phase.  
**Reference:** `docs/ROOM_PLANNER_IMPLEMENTATION_PLAN.md`

## 1. Files and current implementation

| Area | File | Findings |
|---|---|---|
| Planner page/grid/toolbar/bars/legend/create-edit modal | `src/components/pms/RoomPlanner.jsx` | Main implementation is a single large component (~54.7 KB). Toolbar, calendar grid, day cells, reservation bars, create/edit modal, folio/charge and print preview live together. |
| Reservation list/create/edit drawer | `src/components/modules/Reservations.jsx` | Separate Front Desk & Reservations page, including a compact New Reservation modal and reservation drawer. |
| Reservation data mapping/state | `src/data/PmsStore.jsx` | Maps Supabase reservation rows into planner shape and exposes create/update actions. |
| Data access | `src/services/pmsService.js` | Reservation reads and planner RPC calls are delegated here; inspect in implementation phases before changing behaviour. |
| Global tokens/theme | `src/index.css` | Canonical tokens and planner component styles. |
| Tailwind/shadcn mappings | `tailwind.config.js` | Semantic Tailwind colours map to CSS variables; legacy aliases remain. |
| Design documentation | `Design.md` | Currently documents the light-only OliTechs brand palette, including light-only contract, room/floor states and current planner payment exception. Must be reconciled in Phase 1 with the newly approved light+dark brief. |
| Schema | `supabase/migrations/0013_room_planner_schema_repair.sql`, `0014_room_planner_production.sql`, `0015_room_planner_date_inventory.sql` | Existing reservation schema already includes children counts/ages and date-based availability. |

## 2. Geometry and positioning today

Observed in `src/components/pms/RoomPlanner.jsx`:
- `DAY_WIDTH = 92`; rolling mode overrides to 110px.
- `ROOM_COL_WIDTH = 190`; there is also a separate local `roomWidth = 130` in print/range calculation.
- Header is one 60px date row, not separate 38px month + 41px day rows.
- Room rows are minimum 48px; no separate 28px room/group row geometry was found in the inspected render.
- Timeline is a single horizontally/vertically scrollable region; the Rooms rail is sticky left and the header grid is sticky top.
- Month labels are displayed within each day cell (small month abbreviation); there is no separate month-span header row.
- Weekend cells use `--grid-weekend` mixed with surface. Today uses a primary tint/outline. Tints are currently applied to individual cells, not a single full-height column layer.
- Bar left position is `ROOM_COL_WIDTH + startIndex * dayWidth + 4`; width is `max(dayWidth * span - 8, 100)`. This is not the requested half-day offset and has a 100px minimum width.
- Bar style is currently 34px high, top offset 7px, 7px radius, 11px bold text, unskewed. Room row min-height is 48px.
- Past opacity helper returns 0.5 for booking status `checked_out`; this applies to the whole bar element (including text), rather than only the background layer. It is status-based, not calculated from checkout date versus today.
- Reservation bars are draggable and clickable; existing drag/drop and edit behaviour must be preserved.

## 3. Payment and booking status mapping

- `getPaymentStatusFromAmounts` maps amount paid/total to `fully_paid`, `partially_paid`, or `not_paid`.
- `getPaymentStyle` maps those states to `--pay-paid`, `--pay-deposit`, and `--pay-unpaid`.
- `getReservationBarStyle` separately maps planner booking status (optioned/confirmed/occupied/checkout/checked_out/closed) to stay tokens.
- The current bar render chooses the optioned stay fill when optioned; otherwise it uses the payment style. This differs from the new brief's single canonical mapping where Optioned is represented by `--pay-opt`.
- Current legend/payment chip CSS is in `src/index.css`; inspect the rendered legend section before changing it in Phase 5.
- The data mapper in `src/data/PmsStore.jsx` also constructs a hard-coded colour string based on payment status. This is a token-system violation to address in the later implementation phase, not during audit.

## 4. Reservation fields already present

Migration `0013` adds/declares: `confirmation_code`, `adults`, `children`, `source`, `special_requests`, `deposit_amount`, `rate_plan_id`.

Migration `0014` adds: `group_id`, `payment_status`, `channel`, `meal_plan`, `kids_count`, `kids_ages` (JSONB, default []), `total_amount`, `amount_paid`, `special_requests`. The RPC create/update signatures carry these fields. Migration `0015` adds room closures and date-range availability checking.

Current frontend mapping in `src/data/PmsStore.jsx` loads/maps: guest name, phone, arrival/departure, booking status, payment status, channel, meal plan, adults, kids count, kids ages, total amount, amount paid, rate, party size and notes. The planner normalizer also consumes room/group identifiers and planner status.

**No additive children-ages column is indicated by the inspected schema:** `kids_ages` already exists as JSONB and is loaded into `kidsAges`. Do not add another column without evidence of a concrete gap.

Not confirmed in the inspected mapping/schema excerpts: surname/name split, language, commission, billing details, payment type, tag collection, booking source enum beyond `source`, and a dedicated extra-services summary. The reservation form currently stores a single guest-name string in the planner create/edit modal; do not invent schema fields.

## 5. Reservation form UX today

- Planner create/edit is a modal inside `RoomPlanner.jsx`, opened by toolbar or clicking an empty room/date cell; edit is opened by clicking a bar.
- The planner form includes guest name, phone, dates, payment status/amounts, channel, meal plan, adults, children/ages, room selection and notes, with existing validation and save/update RPC wiring.
- Separate `Reservations.jsx` has a smaller create modal with guest, phone, room, rate, arrival/departure, party size and channel; detail/edit workflow is a drawer.
- No reservation hover summary card was found in the inspected planner render; bars use a title attribute and hover CSS only.
- Empty-cell click opens a one-day stay form; click-drag range selection/preview was not found in the inspected section.

## 6. Initial hard-coded colour findings

This is a targeted initial inventory from the planner, store mapper and global stylesheet, not yet an exhaustive repository-wide line-by-line grep. The complete sweep is deferred until the implementation work starts.

| File | Location / current value | Proposed token |
|---|---|---|
| `src/data/PmsStore.jsx` | `mapReservation()`: `#2E7D32`, `#F9A825`, `#EF6C00` | Remove derived colour from data model; consume payment-state tokens in the planner/view. |
| `src/components/pms/RoomPlanner.jsx` | Imports fixed palette constants `NAVY, TEAL, SAND, SURFACE, SURFACE2, BORDER, MUTED, DESTRUCTIVE` | CSS tokens from `src/index.css`; remove presentation-only palette coupling in a later phase. |
| `src/components/pms/RoomPlanner.jsx` | Inline literal `#FFFFFF` for selected rolling/month controls | `--on-primary` / mapped primary foreground token. |
| `src/components/pms/RoomPlanner.jsx` | Inline rgba shadows/scrim and colour-mix expressions in embedded style block | `--tooltip-shadow`, surface/text/border and semantic state tokens. |
| `src/components/modules/Reservations.jsx` | Tailwind fixed palette classes `border-slate-200`, `text-slate-900`, `focus:border-slate-500`, `focus:ring-slate-200`, `text-slate-800`, `bg-red-50`, `text-red-700`, `divide-slate-100`, `bg-slate-900` | `border-input`, `text-foreground`, `ring`, `bg-danger-soft`, `text-danger`, `divide-border`, semantic status tokens. |
| `src/index.css` | Current planner values `--pay-paid: #3FA77A`, `--pay-deposit: #F2C14E`, `--pay-unpaid: #EE8A3C` | New `--pay-none*`, `--pay-part*`, `--pay-paid*`, `--pay-opt*` tokens from approved brief. |
| `src/index.css` | Room/floor/table literals and light-only dark-theme overrides | Approved app-wide light/dark semantic tokens; preserve receipt/print exception. |
| `Design.md` | Existing light-only OliTechs brand palette and old planner payment exception | Update only after Phase 1 tokens are implemented and verified. |

## 7. Reference and verification gaps
- The uploaded material available for this task contains the written master prompt; the three referenced screenshot image files were not present in the accessible upload. Exact pixel comparison cannot be completed until those images are supplied.
- Phase 0 has not changed application code, schema, routes or runtime behaviour.
- The colour inventory above is a targeted initial audit, not the exhaustive `src/` sweep requested. Complete it before Phase 8.
- No lint/build was run because Phase 0 is inspection-only and the repository was accessed through GitHub source inspection, not a local checkout.
- No production Supabase queries or migrations were run.

## Phase 0 conclusion
The project already has most reservation data requested, including `kids_ages` JSONB, payment fields and group/channel metadata. The largest visual differences are the 92/110px day widths, 190px room rail, 60px single-row header, 48px room rows, 34px bars, non-half-day positioning, and missing hover summary. The current global theme explicitly enforces a light-only dark selector, whereas the new approved brief requests a true dark palette; that conflict must be resolved by the new Phase 1 specification, while preserving the existing theme infrastructure.

**Status: Phase 0 audit complete. Stop here and wait for explicit approval before Phase 1.**
