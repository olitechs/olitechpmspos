# Room Planner & Reservation UX Implementation Plan

This document installs the approved implementation brief for the Room Planner, reservation form, reservation hover summary, and app-wide colour system. Execute strictly phase by phase. Do not start the next phase until the owner explicitly says **continue**.

## Project and safety constraints
- Repository: `olitechs/olitechpmspos` (Vite, React 18, Tailwind, shadcn/ui, Supabase).
- Presentation and form UX only. Preserve folio/billing logic, stores, routes, permissions, Supabase queries (except the explicitly approved nullable children-ages column if ultimately proven necessary), booking logic, drag/drop, and print templates.
- Never edit `v6/`. Do not apply production database migrations or make production DB changes without explicit approval.
- Canonical colour tokens belong in `src/index.css`; Tailwind/shadcn values map to them. No component-level hard-coded palette values, except thermal receipts/print templates.
- Preserve existing theme provider, `.dark` synchronization, `olitech_theme_mode` storage and pre-render head script.
- After each phase: report changed files and before/after behaviour, run the requested checks, then STOP for approval.

## Phase 0 — Audit only (no application-code changes)
1. Locate Room Planner calendar/grid/header/toolbar/reservation bar/legend/styles and reservation create/edit routes, dialogs, validation and save handlers.
2. Inventory hard-coded colours throughout `src/`: hex, rgb/hsl, palette Tailwind classes, and fixed inline styles. Record file, line, current value/class, proposed token. Distinguish print-only exceptions.
3. Document current bar positioning, column widths/row heights, sticky behaviour, weekend/today treatment, past-stay opacity, payment-status mapping, hover/focus behaviour and all reservation fields already stored/loaded.
4. Inspect schema and migration history before proposing data changes. Do not add columns in this phase.
5. Record missing references/assets and verification blockers.

## Phase 1 — Canonical colour tokens
Implement the supplied light and dark token palettes in `src/index.css`, including app surfaces, text, semantic states, controls, calendar, payment/booking chips and cancel state. Map shadcn/Tailwind variables to these tokens. Preserve theme persistence/provider/head script. Ensure text contrast >=4.5:1 and UI borders/icons >=3:1. Keep receipt/print output black on white. Add restaurant table and room-rack state tokens from the approved brief. Do not change domain behaviour.

## Phase 2 — Room Planner toolbar
Match the approved reference dimensions, ordering, labels and colours. Keep only existing features; do not invent controls. Retain existing date/range/month/15-day/today/print/settings behaviours. Responsive wrapping below 1100px.

## Phase 3 — Calendar geometry
Target 225px sticky Rooms rail, 56px day columns, 38px month header and 41px day header, 28px group and room rows, one locale for weekday labels, 1px grid lines, weekend/today column tints, and 14px scrollbars. Preserve both-axis scrolling and sticky headers/room rail.

## Phase 4 — Reservation bars
Target 23px bars, 2px row offset, half-day check-in/check-out positioning, 4px radius, -15deg skew, payment-state fills/borders/text, clipped range edges, readable labels/icons, and background-only 50% opacity for past stays. Preserve drag/resize and turnover behaviour.

## Phase 5 — Legend
Render one left-aligned row of four 24px chips: No Amount Paid, Partially Paid, Total Paid, Optioned. Drive all colours from the same payment tokens as the bars.

## Phase 6 — New/Edit Reservation form
Preserve existing routes and save semantics. Add planner toolbar entry and empty-cell click/drag prefill; edit existing bars in the same form. Implement the specified two-column form, main details, room/guest details, children's ages, live summary, payment details, movements and tags only where existing data/workflows support them. Validate required fields inline and accessibly. Inspect schema first; only propose one additive nullable `children_ages` column if existing `kids_ages` JSONB is insufficient and missing ages genuinely cannot be stored. Do not alter billing/payment transaction logic.

## Phase 7 — Reservation hover summary
Accessible delayed hover/focus/touch summary with safe viewport positioning, keyboard/Escape handling, no activation during drag/resize/scroll, and cached/lazy detail loading only when necessary. Display available reservation code, guest, guest counts/ages, dates/nights, total, payment, channel and notes. All styling uses tokens.

## Phase 8 — App-wide token sweep
Use the Phase 0 inventory to migrate Login, Dashboard, Front Office, Room Rack, Folios/Billing, Housekeeping, Restaurant POS, Stores/Inventory, Reports, Settings, dialogs, toasts, tables, forms and charts to canonical tokens. Add the specified theme-aware restaurant table and room-rack status tokens. Keep labels/icons in addition to colour and POS touch targets >=44px.

## Phase 9 — Verification and documentation
Compare planner screenshots at 1440x900 in both themes against the references; report/fix deviations >2px. Run contrast checks for all required token pairs, search build output for forbidden hard-coded black/white utilities outside print exceptions, exercise 0/1/200+ reservations and clipped/long/short stays, validate create/edit/child-age/payment/hover interactions, run lint/tests/build, and update `Design.md`.

## Delivery status (updated 2026-11-01)
- Phase 0 — audit completed and committed.
- Phase 1 — canonical light/dark colour tokens and Tailwind/shadcn mappings completed and pushed to `main`.
- Phase 2 — Room Planner toolbar and date-range navigation completed and pushed to `main`.
- Phase 3 onward — not started; wait for explicit **continue** before proceeding.

## Phase gate
Stop after each phase. Phase 2 is the current completed phase; do not begin Phase 3 until the owner says **continue**.
