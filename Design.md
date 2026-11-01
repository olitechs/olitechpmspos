# OliTechs PMS + POS — Brand and theme system

## Design intent
A professional, accessible hotel operations interface with clear hierarchy and consistent semantic surfaces. The application supports **Light**, **Dark** and **System** modes. Theme work is presentation-only: domain behaviour, data, routes, permissions, stores, receipts and print templates remain unchanged.

## Canonical colour source
All canonical application colours are defined in `src/index.css`. Tailwind and shadcn variables are mappings to these tokens; do not add a second palette or hard-code colour values in components. Legacy semantic names remain aliases for compatibility while modules are migrated.

### Light palette

| Token | Value |
|---|---|
| `--canvas` | `#F4F7F8` |
| `--surface` | `#FFFFFF` |
| `--sidebar` | `#E6EFF0` |
| `--border` / `--input-border` | `#C9D6DA` / `#7C9199` |
| `--panel-head` | `#E6EFF0` |
| `--text` / `--text-muted` | `#14232B` / `#4F646D` |
| `--primary` / `--on-primary` | `#0F7C86` / `#FFFFFF` |
| `--primary-hover` / `--primary-text` / `--primary-soft` | `#0B6169` / `#0B6169` / `#DDF0F1` |
| `--accent` | `#9A5F2B` |
| `--success` / `--success-soft` | `#1B7A57` / `#E3F3EC` |
| `--danger` / `--danger-soft` | `#B42318` / `#FBE8E6` |
| `--warning` / `--warning-soft` | `#8F5400` / `#FBEFD9` |
| `--info` / `--info-soft` | `#2A5AA7` / `#E4EDF9` |

### Dark palette

| Token | Value |
|---|---|
| `--canvas` | `#10171A` |
| `--surface` | `#172126` |
| `--sidebar` | `#131C20` |
| `--border` / `--input-border` | `#2C3B42` / `#5A6F77` |
| `--panel-head` | `#1E2B31` |
| `--text` / `--text-muted` | `#E3EBED` / `#9DB0B8` |
| `--primary` / `--on-primary` | `#137682` / `#F2F8F9` |
| `--primary-hover` / `--primary-text` / `--primary-soft` | `#0E6A75` / `#5CC6D0` / `#17353B` |
| `--accent` | `#D4A06E` |
| `--success` / `--success-soft` | `#4CC39A` / `#143A2D` |
| `--danger` / `--danger-soft` | `#FF8A84` / `#3E1E1E` |
| `--warning` / `--warning-soft` | `#F0A56F` / `#3F2318` |
| `--info` / `--info-soft` | `#8DB4F0` / `#1A2E52` |

Dark-theme text and foreground tokens must remain light/off-white; never use black or near-black text on dark surfaces. Use separate fill and foreground tokens for buttons, links and status chips. Bright status colours are limited to appropriate fills, borders and icons.

## Room Planner semantic tokens
The planner uses the `--cal-*` family for page, header, grid, weekend, today, room and scrollbar colours. Payment/booking status uses the same fill, foreground and border triplets across bars, legend, hover summaries and reservation forms:

| State | Fill | Foreground | Border |
|---|---|---|---|
| No amount paid | `--pay-none` | `--pay-none-fg` | `--pay-none-bd` |
| Partially paid | `--pay-part` | `--pay-part-fg` | `--pay-part-bd` |
| Total paid / confirmed | `--pay-paid` | `--pay-paid-fg` | `--pay-paid-bd` |
| Optioned | `--pay-opt` | `--pay-opt-fg` | `--pay-opt-bd` |
| Cancelled | `--st-cancel` | `--st-cancel-fg` | `--st-cancel-bd` |

## Restaurant floor table colours
Table status tokens remain semantic and theme-aware. Status must also be identifiable by text or icon, not colour alone. POS controls retain touch targets of at least 44px.

## Theme selection and persistence
The shared theme control offers **Light**, **Dark** and **System**. `ThemeProvider` stores the selected mode under `olitech_theme_mode`, synchronizes `.dark` with `data-theme="dark"`, and follows `prefers-color-scheme` in System mode. The inline script in `index.html` applies the saved/system choice before React mounts to avoid a flash of the wrong theme. Tailwind remains configured with `darkMode: ['class']`.

## Component rules
- Define canonical colour literals only in `src/index.css`; map Tailwind/shadcn semantic values to CSS variables.
- Use `--surface` for cards and dialogs, `--border` for outlines, and semantic tokens for status.
- Keep normal text contrast at WCAG AA (4.5:1) and UI boundaries/icons at least 3:1; validate actual component pairings during rollout.
- Use labels/icons in addition to colour for operational states.
- Respect reduced-motion preferences and visible keyboard focus.
- Preserve thermal receipts and print templates as black-on-white; in dark mode receipt previews should use a white paper surface.

## Scope and rollout
Phase 1 establishes the canonical light/dark token layer and semantic Tailwind/shadcn mappings. It does not claim that every legacy utility class or component has already been migrated. The app-wide component sweep, planner geometry, reservation form and screenshot verification remain later phases. Do not modify `v6/`, booking/billing logic, routes, permissions or database schema as part of theme work.
