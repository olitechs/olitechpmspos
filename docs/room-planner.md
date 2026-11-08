# OliTechs Room Planner V2

## Scope and compatibility

The Room Planner V2 work is isolated on `feat/room-planner-v2`. It keeps the existing `property_id` tenancy contract and relies on existing RLS and server-side reservation RPCs. It does not add assumed `business_id` or `branch_id` fields, paid Supabase branches, or new paid services.

Existing PMS reservation, group, folio, room-charge, POS and print-agent workflows remain the mutation and billing boundaries. The planner does not treat destructive reservation deletion as cancellation.

## Current implementation

### Layout and data presentation
- Sticky month and day headers, frozen 225px room column, 56px day cells and fixed 54px room rows.
- Reservation bars use midday check-in/check-out geometry, continuation markers and a lighter past-stay treatment.
- Search covers guest, reservation reference and room.
- Filters cover payment state, booking source, room type and floor.
- Visible range presets are 7, 15 and 30 days, with date-range navigation.
- Reservation detail side panel shows reference, guest, dates, nights, room, guest count, source, total, paid amount, balance and notes.
- Quick actions reuse existing edit, folio/payment, room charge, check-in, check-out, one-night extension and room-change paths.
- Payment state is derived from amounts; Optioned stays retain their distinct pale-teal dashed treatment.

### Planner interactions
- Existing drag-to-move uses overlap checks and the server-side move RPC, with a confirmation step and joint-reservation handling.
- Pointer-based resize changes the check-out date, checks minimum stay, selected range and room overlap, then uses the existing move RPC.
- Touch pointer movement is supported for reservation moves.
- A day-list presentation can be toggled for phone-oriented use; it groups filtered stays and closures by visible date and opens the reservation detail panel.
- Keyboard shortcut hints are shown in planner settings.
- Dragging across date cells in one room opens a new reservation form prefilled with the selected stay range.
- Undo/redo is available for individual move and resize actions. Undo/redo replays the existing server-side move operation; it is not a general history for edits, payments, check-in/out, or group moves.
- Keyboard shortcuts: T for today, Escape to close overlays, arrow keys to scroll, Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo.

### Room closures
- Existing `room_closures` table and service methods are used; no new table is introduced.
- Closures load by signed-in `property_id`, are created with `property_id`, `room_id`, `start_date`, `end_date` and `reason`, and can be removed.
- The end date is exclusive, matching reservation check-out semantics.
- Closure dates render with a striped background and tooltip reason. Existing reservations are not silently changed; server-side reservation validation remains authoritative for new bookings.

### Performance
- Reservations are indexed by room and clipped to the visible date window before bar rendering.
- Room rows are vertically virtualised with a fixed row height and overscan.
- The shared PMS store still supplies the full property-scoped reservation collection; a server-side date-window query plus buffer is not implemented.
- Horizontal day columns are not virtualised. The planner limits its selectable range to 31 days, so this remains a bounded grid.

### Export
- The planner uses the shared report definition, report data table and document export menu.
- PDF landscape layout and multi-sheet Excel output have not yet been manually verified against live planner data.

## Data model findings and known gaps

| Area | Current source | Status |
|---|---|---|
| Guest and occupancy | `guest_name`, adults, child count and ages | Existing mapping |
| Channel and group | Existing channel/source and group fields | Existing mapping |
| Payment | Reservation amounts and folio/payment services | Display state is amount-derived |
| Room closures | `room_closures` with room/date/reason | Persistent CRUD wired in planner |
| Option expiry | No confirmed expiry timestamp in the inspected reservation model/schema | Not implemented; do not simulate expiry in the client |
| Audit | Existing audit reader / server-side mutation functions | Full planner before/after audit coverage not verified |
| Permissions | Existing app roles and RLS | Planner-specific action matrix not fully audited |

## Remaining work before marking complete

1. Define and verify a persisted option-expiry field and server-side expiry/confirmation workflow. Existing schema inspection did not confirm an expiry timestamp, so this needs a reviewed additive migration and RPC integration rather than a client-only countdown.
2. Design a property-scoped server-side visible-range query with buffer before changing the shared PMS store data contract.
3. Complete planner-specific role permissions and verify before/after audit events for each mutation.
4. Complete keyboard, screen-reader and responsive accessibility review of both timeline and day-list presentations.
5. Verify PDF and Excel exports end-to-end, including landscape output and the daily room matrix.
6. Run lint, typecheck, architecture tests, Vercel preview build and manual regression against reservations, groups, folios, payments, POS room charges and printing.
7. Capture desktop, tablet and phone screenshots and test closure, create, move, resize, touch, undo and redo interactions.

## Verification boundary

No production database migration, production data change, main-branch push, merge or production deployment is included in this branch's current implementation. Preview build success alone is not a substitute for live PMS regression.
