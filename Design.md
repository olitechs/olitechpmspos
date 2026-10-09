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

| Token | Light | Dark | Usage |
|---|---|---|---|
| Brand dark | `#0B0F14` | `#F3F4F6` | Brand structure / inverse text |
| Brand charcoal | `#1F252D` | `#161B22` | Navigation and strong surfaces |
| Action / brand primary | `#FFC400` | `#FFC400` | Primary actions; always use dark action text |
| Action hover | `#E6B000` | `#E6B000` | Primary action hover |
| Action text | `#0B0F14` | `#0B0F14` | Text on yellow action surfaces; never white |
| Brand soft | `#FFF4C2` | `#3A2F00` | Selected/soft brand surface |
| Background | `#F6F7F9` | `#0E1116` | Main application background |
| Surface | `#FFFFFF` | `#161B22` | Cards, dialogs, menus |
| Surface 2 | `#F1F3F6` | `#1C222B` | Secondary surfaces |
| Border | `#E2E6EB` | `#2A313B` | Default separators and controls |
| Strong border | `#C5CCD5` | `#3A4350` | Strong separators |
| Text | `#0F1720` | `#F3F4F6` | Main text |
| Muted text | `#5B6677` | `#9AA4B2` | Secondary text |
| Info / focus | `#2563EB` | `#60A5FA` | Information and 3px keyboard focus ring |
| Success | `#059669` | `#34D399` | Success states |
| Warning | `#D97706` | `#FBBF24` | Attention states |
| Danger | `#DC2626` | `#F87171` | Errors and destructive actions |

This palette supersedes the previous blue/slate proposal. CSS variables in `src/index.css` are canonical; Tailwind and `src/data/palette.js` / `src/data/themePalette.js` are mappings/compatibility exports, not separate sources of truth. Status must include readable text and/or an icon, not color alone. Do not use yellow text on light surfaces or decorative gradients.

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



## 12. Phase 1 Contrast Spot-Check

Contrast ratios calculated from the specified sRGB tokens (WCAG relative luminance formula):

| Pair | Ratio | Result |
|---|---:|---|
| Light primary text on white | 18.05:1 | Pass AA text |
| Light muted text on white | 5.81:1 | Pass AA text |
| Dark primary text on dark surface | 15.72:1 | Pass AA text |
| Dark muted text on dark surface | 6.86:1 | Pass AA text |
| Dark action text on brand yellow | 12.03:1 | Pass AA text |
| Light warning text on white | 5.02:1 | Pass AA text |
| Light success text on white | 5.48:1 | Pass AA text |
| Default light border `#E2E6EB` on white | 1.25:1 | Fails 3:1 UI boundary contrast if used alone |
| Strong light border `#C5CCD5` on white | 1.62:1 | Fails 3:1 UI boundary contrast if used alone |
| Default dark border `#2A313B` on dark surface | 1.32:1 | Fails 3:1 UI boundary contrast if used alone |
| Strong dark border `#3A4350` on dark surface | 1.73:1 | Fails 3:1 UI boundary contrast if used alone |

The approved border colors are retained for cards and dividers, but interactive controls use the separate semantic `--control-border: var(--muted)` token and a visible 3px focus ring. This spot-check is not a full page-level WCAG audit; all component states and migrated screens still require browser verification.

**Phase 1 implementation status:** token and documentation alignment plus shared shell refactor are in progress. This phase is not accepted until build/lint/typecheck, role-route regression, responsive review, font packaging, shared component adoption, and the remaining sidebar consolidation are verified.


**Status: Approved for scoped Phase 1 implementation — 2026-10-09**