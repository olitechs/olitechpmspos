# OliTechs PMS + POS — Brand and theme system

## Design intent
A professional, premium hotel operations interface with clear hierarchy, accessible semantic states and consistent surfaces. The application supports **Light**, **Dark** and **System** modes. This is a presentation-only change: domain behaviour, data, routes, permissions, stores, receipts and print templates remain unchanged.

## Canonical colour tokens
All canonical colour values are defined only in `src/index.css`. Tailwind and shadcn variables are mappings to those tokens; do not create a second palette or introduce ad-hoc colour values in components.

### Light mode

| Token | Value | Usage |
|---|---|---|
| `--canvas` | `#F4F7F8` | App/page background |
| `--surface` | `#FFFFFF` | Cards, panels, dialogs |
| `--sidebar` | `#E6EFF0` | Navigation surface |
| `--primary` | `#0F7C86` | Primary actions and active states |
| `--primary-hover` | `#0B6169` | Primary hover |
| `--primary-soft` | `#DDF0F1` | Selected states |
| `--primary-foreground` | `#FFFFFF` | Text/icons on primary actions |
| `--accent` | `#C98A52` | Restrained accent |
| `--text` | `#14232B` | Main text |
| `--text-muted` | `#566A73` | Secondary text |
| `--border` | `#DCE5E8` | Borders and dividers |
| `--shadow-overlay` | `0 8px 24px rgba(20,35,43,.08)` | Floating elements |

### Dark mode

| Token | Value | Usage |
|---|---|---|
| `--canvas` | `#0E1417` | App/page background |
| `--surface` | `#151D21` | Cards, panels, dialogs |
| `--sidebar` | `#11191C` | Navigation surface |
| `--primary` | `#2BB3BF` | Primary actions and active states |
| `--primary-hover` | `#4CC7D1` | Primary hover |
| `--primary-soft` | `#12343A` | Selected states |
| `--primary-foreground` | `#062226` | Text/icons on primary actions |
| `--accent` | `#D9A06B` | Restrained accent |
| `--text` | `#E6EEF0` | Main text |
| `--text-muted` | `#93A5AD` | Secondary text |
| `--border` | `#26343A` | Borders and dividers |
| `--success` / `--success-text` / `--success-soft` | `#3DBE95` / `#7BDDBC` / `#12302A` | Success states |
| `--danger` / `--danger-text` / `--danger-soft` | `#F0645F` / `#FF9A96` / `#3A1B1B` | Error states |
| `--warning` / `--warning-text` / `--warning-soft` | `#F0906F` / `#FFB59B` / `#38231B` | Warning states |
| `--shadow-overlay` | `0 8px 24px rgba(0,0,0,.45)` | Floating elements |

Dark mode is applied using `:root[data-theme="dark"]`. Tailwind uses `darkMode: ['class']` and the theme provider keeps the `.dark` class and `data-theme` attribute synchronized.

## Restaurant floor table colours

The following status colours are fixed and identical in both themes. The floor background changes with the theme.

| Table state | Fill | Text | Border |
|---|---|---|---|
| Open / available | `#74C365` | `#10260A` | `#5CA84E` |
| Occupied / ongoing order | `#FA003F` | `#FFFFFF` | `#C70032` |
| Printed / unsettled bill | `#FAFAFA` | `#14232B` | `#9AA3A8` |
| Floor background — light | `#D7D7D7` | — | — |
| Floor background — dark | `#1B2327` | — | — |

These colours are defined by `--table-free-*`, `--table-occupied-*`, `--table-bill-*` and `--floor-bg` tokens in `src/index.css`. Status must remain identifiable by text as well as colour. POS controls must retain touch targets of at least 44px.

## Room and payment status
Room status colours remain semantic: clean `#3FA77A`, dirty `#D9826B`, occupied `#4B7BE5`, checking out `#6C63D9`, and out of order `#B8BEC6`; their dark equivalents are tokenized in the dark theme. Use labels/icons in addition to colour and light diagonal stripes for out-of-order rooms.

The Room Planner payment exception remains scoped to `.room-planner`: paid `#3FA77A`, deposit `#F2C14E` with `#5A4310` text, and unpaid `#EE8A3C`. The existing `--pay-*` values stay scoped to that component. Checked-out stays remain at 50% opacity. Do not reference `--pay-*` outside the planner.

## Theme selection
The shared theme control offers **Light**, **Dark** and **System** in the top bar and Settings. The selected mode persists under `olitech_theme_mode`. System mode follows `prefers-color-scheme`; an inline head script applies the saved/system choice before the app starts to avoid a flash of the wrong theme.

## Component rules
- Use CSS variables from `src/index.css` for canonical colours. Tailwind/shadcn values are mappings only.
- Keep cards on `--surface` with a 1px `--border` outline and 12px radius; avoid heavy shadows.
- Use semantic tokens for text, surfaces, borders, focus rings and status states. Do not use a hardcoded colour on a surface that changes with the theme.
- Typography uses the system UI stack. Keep clear hierarchy and readable line heights.
- Buttons, inputs and interactive controls need visible focus, keyboard access and at least 44px touch targets for POS workflows.
- Respect reduced-motion preferences. Avoid blur, backdrop filters and heavy gradients.
- Thermal receipts and print templates remain black on white for printer legibility; do not apply the application theme to printed output.

## Navigation and page hierarchy
Keep Front office, Planner, Folios, Restaurant, Stores and Reports prominent, with secondary administration grouped under Settings. Preserve existing role-filtered navigation and route guards. Folios/orders need guest/table context. POS uses categories at the top, products centrally, ticket on the right, and Pay as the single filled action.

## Accessibility and performance
Target WCAG AA contrast for normal text (4.5:1), visible keyboard focus, and status labels/icons independent of colour. Some required fixed floor colours may create contrast exceptions for small white text on the occupied red fill; record and review those exceptions rather than claiming full AA compliance. Verify both themes on Login, Floor, Order taking, Bill payment, Cashier, Kitchen display, Settings, Stores and Room Planner. Record bundle sizes before/after only if performance is measured.
