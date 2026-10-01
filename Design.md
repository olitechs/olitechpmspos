# OliTechs PMS + POS — Professional Design System

## 1. Design Problem

The current repository has a functional hotel application but its visual language is inconsistent and contains legacy yellow/black styling alongside newer UI patterns. The goal is not decorative redesign; the goal is an operational interface that communicates hierarchy, status, financial state and actions with enterprise clarity.

Existing design references:

- `design-system/olitechs-pms-pos/MASTER.md`
- `design-system/olitechs-pms-pos/pages/dashboard.md`
- `design-system/olitechs-pms-pos/pages/front-office.md`
- `design-system/olitechs-pms-pos/pages/housekeeping.md`
- `design-system/olitechs-pms-pos/pages/pos.md`
- `design-system/olitechs-pms-pos/pages/reservations.md`
- `tailwind.config.js`
- `src/data/palette.js`
- `src/data/themePalette.js`

## 2. Approved Target Palette

> **Important:** These are Phase 1 target tokens. Phase 0 does not modify the live palette files.

| Token | Hex | Usage |
|---|---|---|
| Primary Slate | `#0F172A` | Primary text, strong navigation, primary brand anchor |
| Accent Blue | `#2563EB` | Primary action, selected state, links |
| Background | `#F8FAFC` | Main application background |
| Border | `#E2E8F0` | Cards, tables, inputs, dividers |
| Success | `#059669` | Ready, paid, confirmed, healthy |
| Warning | `#D97706` | Pending, attention, reconciliation |
| Danger | `#DC2626` | Errors, destructive actions, blocked states |

### Existing palette conflict

The current `src/data/palette.js` defines:

- `NAVY #090C11`
- `NAVY2 #262B32`
- `TEAL #FFD300`
- `TEAL_DARK #FFD100`
- `TEAL_LIGHT #FFEE32`
- `SAND #F5F3EF`
- `SURFACE #FFFFFF`
- `BORDER #E5E5E5`

and `tailwind.config.js` contains yellow/black tokens such as `primaryHex #FFD300`.

Therefore Phase 1 must migrate tokens deliberately rather than mixing the two palettes.

## 3. Typography

### Primary families

- **Inter** — operational UI, tables, forms, controls.
- **Plus Jakarta Sans** — headings and high-level page hierarchy.

### Scale

| Size | Typical use |
|---:|---|
| 12px | Table metadata, compact labels |
| 13px | Dense table body, secondary operational data |
| 14px | Default control/body text |
| 16px | Primary body / important row labels |
| 20px | Section/page subheading |
| 24px | Page title / major KPI |

Weights should be restrained. Use 500/600 for hierarchy; reserve 700 for exceptional emphasis.

## 4. Layout

| Element | Target |
|---|---:|
| Topbar | 56px |
| Sidebar | 240px expanded |
| Main content max width | 1600px |
| Main background | `#F8FAFC` |
| Sidebar | Slate-900 / `#0F172A` |
| Standard control height | 36px |
| Table density | Compact/comfortable modes |
| Card radius | `rounded-lg` |
| Card shadow | `shadow-sm` |

### Operational shell

The existing shell files are:

- `src/components/shell/Sidebar.jsx`
- `src/components/shell/TopBar.jsx`
- `src/components/shell/POSTabs.jsx`

These are the primary layout integration points.

The shell must maintain:

- one page scrollbar where possible
- no horizontal clipping of navigation labels
- predictable sidebar width
- fixed topbar geometry
- content area that does not get squeezed by POS/PMS-specific wrappers

## 5. Components

### Button

- Height: `h-9`
- Radius: `rounded-lg`
- Primary: Accent Blue
- Secondary: white/slate surface with border
- Destructive: Danger
- Loading state retains button width

### Card

- White surface
- Border: `#E2E8F0`
- `shadow-sm`
- `rounded-lg`
- Consistent internal padding

### Table

- 13px body
- Sticky header
- Clear column hierarchy
- Density control where large datasets justify it
- Right-aligned numeric/financial columns
- Status badges remain legible without relying on color alone

### Badge

Dot-style semantic badge:

- small status dot
- label
- semantic background/text pairing
- never communicate state by color alone

### Input

- `h-9`
- visible label
- border
- clear focus ring
- validation state
- keyboard-friendly

## 6. UX Principles

### 2-click check-in

The normal arrival path should minimize decisions:

1. Select/open arrival.
2. Confirm room/payment/registration and complete check-in.

Complex cases can open a detailed drawer/modal, but the common path must stay short.

### Command search

Use `Cmd+K` on macOS and `Ctrl+K` on Windows/Linux.

Search targets should eventually include:

- guest
- reservation
- room
- folio
- receipt
- invoice
- staff

The repository already depends on `cmdk`.

### No dead-end empty states

Every empty state must tell the user:

- what is empty
- why it matters
- what action creates the first record

Example: “No reservations today” → “Create reservation” action.

### Financial clarity

Money should be visually prioritized without oversized decorative cards.

- Currency code/symbol is consistent.
- Negative values are clearly indicated.
- Paid/outstanding states are explicit.
- Financial totals align vertically.

## 7. Before / After — Dashboard

### Before — current repository pattern

`src/components/modules/Dashboard.jsx` currently combines KPI/operational presentation with data from the application's mixed live/static data architecture.

Typical risk:

- KPI cards can look like generic analytics widgets.
- Static sample values can visually resemble authoritative hotel data.
- Multiple modules compete for attention.

### After — target

**Header**
- Page title: “Today”
- Business date
- Property context
- Refresh/status indicator

**KPI row**
- Occupancy
- ADR
- RevPAR
- Room Revenue
- Total Revenue

**Operations**
- Arrivals
- Departures
- In-House
- Room-status summary

**Exceptions**
- Payment exceptions
- VIP arrivals
- Housekeeping delays
- Maintenance issues

The dashboard should be operational first, analytical second.

## 8. Before / After — Reservation List

### Before

`src/components/modules/Reservations.jsx` is a large monolithic screen containing reservation list/detail workflows.

Risk areas:

- dense controls compete with reservation information
- local state and persistence are tightly coupled
- advanced actions can be hard to discover

### After

**Toolbar**
- Search
- Date range
- Status
- Room type
- Channel
- Guest/company

**Table**
- Confirmation
- Guest
- Arrival
- Departure
- Room
- Status
- Balance
- Source

**Primary action**
- “New Reservation”

**Row actions**
- Open
- Edit
- Check in
- Move room
- Add payment
- Cancel

**Detail**
- Use a side drawer/modal for quick inspection
- Full reservation page only for complex workflows

## 9. Accessibility

- Minimum meaningful contrast for text/control states.
- Visible keyboard focus.
- Keyboard navigation for tables/dialogs.
- Escape closes transient UI.
- Buttons have accessible names.
- Status cannot be communicated only through color.
- Form errors are tied to fields.
- Touch targets remain practical for POS/tablet workflows.

## 10. Motion

Motion is subordinate to hotel operations.

Use short transitions for:

- drawer open/close
- table row state changes
- modal entry
- toast/status changes

Avoid:

- large decorative page animations
- motion that delays a cashier/receptionist action
- layout-shifting animations in dense tables

## 11. Design-System Acceptance Checklist

- [ ] All new components use target tokens.
- [ ] No arbitrary new brand colors.
- [ ] No inline visual styles.
- [ ] Shell dimensions remain stable.
- [ ] POS remains touch-friendly.
- [ ] Tables remain readable at high density.
- [ ] Dashboard distinguishes live/empty/unavailable states.
- [ ] Reservation actions remain discoverable.
- [ ] Dark mode, if implemented later, uses semantic tokens rather than duplicated component colors.

**Status: DRAFT - Awaiting Approval**
