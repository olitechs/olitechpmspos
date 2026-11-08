# OliTechs Room Planner V2

## Phase 1 — Audit

### Existing implementation
- `src/components/pms/RoomPlanner.jsx` owns the planner toolbar, date range, room-type grouping, grid, reservation bars, create/edit form, drag-and-drop move confirmation, group handling, folio actions, room charges, and export preview.
- `src/data/PmsStore.jsx` maps reservation rows into the planner model. It already maps adults, children and child ages, channel, group ID, payment amounts/status, and notes.
- `src/services/pmsService.js` reads rooms and reservations scoped by the signed-in `property_id`. Existing create, update and move operations use server RPCs; folio, payments, receipts and room-charge operations are separate existing services.
- Existing schema migrations `0013`–`0016` provide room types, rate plans, group/channel/payment fields, child counts/ages, amounts, notes and date-based room closures.
- `src/services/reportDocumentEngine.js` and `src/services/reportDefinitions.js` are already present. The planner currently builds a report definition and uses the shared export menu rather than a screenshot export.
- Existing planner geometry was 190px room rail, 92px month / 110px rolling day columns, a single 60px day header, 48px room rows and 34px rectangular bars.

### Data-field audit
| Field | Existing source | Status |
|---|---|---|
| Guest / pax | `guest_name`, `adults`, `kids_count`, `kids_ages` | Present |
| Channel / source | `channel` and `source` in booking details | Present, mapping should be normalised consistently |
| Group booking | `group_id` | Present |
| Notes | `special_requests` / `notes` | Present |
| Payment | `total_amount`, `amount_paid`, folio totals and payment rows | Present; UI derives a display state from amounts |
| Option expiry | No confirmed expiry timestamp in the inspected reservation mapping/schema | Missing |
| Closure dates | `room_closures` with room/date/reason | Present in schema; current toolbar handler still adds a temporary local closure |
| Audit before/after | reservation audit event reader exists | Verify write coverage for every planner mutation |

### Tenancy and query safety
The current client contract is `property_id` plus existing RLS and property-scoped RPCs. The inspected planner data model does not expose `business_id` and `branch_id`. Do not add client filters for columns that are not established in the live schema; map property-to-business/branch only after the platform tenancy contract is confirmed. No database migration or production data change is part of this branch's initial UI work.

### Current rendering and performance
The current page receives the full room and reservation arrays from `PmsStore`; it does not request a visible date window plus buffer. The grid creates approximately `rooms × visibleDays` day cells, and filters reservations for each room before drawing bars. Rendering work is therefore roughly O(R×D + R×N) in the current component (R rooms, D visible days, N reservations), with no row/column virtualisation. Actual production R/N counts were not available from source inspection, so no runtime count is claimed.

## Phase 2 — Layout work in this branch
- Narrowed day columns to 56px and widened the frozen room rail to 225px.
- Added a sticky two-level header: month spans above weekday/date cells.
- Increased room row minimum height to 54px.
- Changed reservation bars to 23px parallelogram-shaped chips with half-day check-in/check-out geometry. Stays clipped by the visible range use a flush edge and continuation chevron.
- Past stays use a 55% fill tint while preserving foreground text opacity.
- Added a dedicated optioned token and adjusted today/weekend tints to the requested Coastal Teal values.
- Updated the legend labels to No Amount Paid, Partially Paid, Total Paid and Optioned. Payment states continue to derive from amount paid versus total amount.

## Component and geometry notes
- Main component remains `src/components/pms/RoomPlanner.jsx`; no route, POS, folio, print-agent or thermal-printing code is changed.
- Pure date geometry and payment mapping helpers are in `src/lib/roomPlannerGeometry.js`.
- Check-in begins at 12:00 and check-out ends at 12:00. For a stay with N nights, the visible bar spans N full day widths, with a half-day offset at each un-clipped boundary.
- Payment mapping: zero paid → No Amount Paid; positive amount below total → Partially Paid; paid amount at or above total → Total Paid. Optioned stays use the dashed Coastal Teal outline and pale teal fill, independent of the payment state.

## Remaining phases / risks
- Toolbar search, source/payment/room-type/floor filters and 7/15/30-day selector are not yet implemented.
- Reservation detail is still the existing edit modal, not the requested side panel with all quick actions.
- Resize handles, touch drag, drag-to-create, persisted closure CRUD, option expiry/countdown/confirmation, undo/redo, keyboard shortcut help and role-specific planner actions remain outstanding.
- Visible-range query buffering and row/column virtualisation remain outstanding. The existing global property-scoped reservation query should not be replaced until a safe date-range API is designed.
- Export engine exists; planner-specific landscape PDF and multi-sheet Excel output still require verification and may need a dedicated report definition.
- Desktop/tablet/phone screenshots and end-to-end interaction screenshots have not been generated in this source-only workflow. Pixel verification and live data testing are still required.
- No Supabase migration, production deployment, main-branch push or merge was performed.
