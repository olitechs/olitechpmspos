# ADR-0002: RoomPlanner split scope — pure model out, component body intact

Date: 2026-11-15. Status: Accepted.

## Context

`src/components/pms/RoomPlanner.jsx` was ~964 lines: ~115 lines of pure
helpers/constants, four form-control atoms, and one ~830-line component whose
state (40+ `useState`/`useMemo`/refs) is woven through the render tree.
Multiple contract tests (`RoomPlanner.test.mjs`,
`tools/design-system/system-ui.test.mjs`,
`src/data/modules/navigationRouting.test.js`,
`supabase/tests/phase3_pos_folio_room_planner_contract.test.mjs`) assert on
the file's source text, and the planner is a file-safe workflow
(reservations, drag/resize/undo, closures, folio handoff).

## Decision

- Extracted the pure model helpers (status/label maps, date keys, rolling
  range, reservation normalization, formatters, `emptyForm`, overlap/stats
  helpers, payment-status style triplets) to
  `src/components/pms/planner/plannerModel.js`.
- Extracted the presentational form atoms (`SelectField`, `InputField`,
  `Field`, `Modal`) to `src/components/pms/planner/plannerControls.jsx`.
- The component body stays in `RoomPlanner.jsx` with its public API unchanged
  (default export, same props). It is deliberately **not** further split into
  child components at this time: the state is shared across the toolbar,
  grid, hover card and modals, so splitting requires threading dozens of
  props with no runtime browser verification available. A future split needs
  the dev server reachable from a browser first (see `docs/UI_LINK_AUDIT.md`).

## Consequences

- Helper assertions in `RoomPlanner.test.mjs`, `system-ui.test.mjs` and
  `navigationRouting.test.js` now read `plannerModel.js`.
- Dead exports removed with proof of no importers: `CHANNELS`, `MEAL_PLANS`,
  `BOOKING_STATUSES`, `isOverlapping` (grep over `src/`, `tools/`, `scripts/`
  found no `from '...RoomPlanner'` named imports besides `Rooms.jsx`'s
  default import).
- `RoomPlanner.jsx` is now ~840 lines and imports its model/controls instead
  of defining them.
