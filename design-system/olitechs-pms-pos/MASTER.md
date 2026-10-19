# OliTechs PMS + POS — Brand and theme system

The canonical theme specification is maintained in the root `Design.md`. This file is the design-system entry point; do not maintain a competing colour palette here.

## Theme modes
The app supports Light, Dark and System modes. The persisted selection is stored as `olitech_theme_mode`; system mode follows `prefers-color-scheme`. The shared theme selector is available in the workspace top bar and Settings.

## Canonical tokens
All colour values live in `src/index.css` under `:root` and `:root[data-theme="dark"]`. Tailwind and shadcn variables are mappings only. Component code should use these tokens and must not introduce a separate palette.

- Light: canvas `#F4F7F8`, surface `#FFFFFF`, sidebar `#E6EFF0`, primary `#0F7C86`, text `#14232B`, muted `#566A73`, border `#DCE5E8`.
- Dark: canvas `#0E1417`, surface `#151D21`, sidebar `#11191C`, primary `#2BB3BF`, text `#E6EEF0`, muted `#93A5AD`, border `#26343A`.
- Restaurant floor: open `#74C365` / text `#10260A` / border `#5CA84E`; occupied `#FA003F` / text `#FFFFFF` / border `#C70032`; unsettled `#FAFAFA` / text `#14232B` / border `#9AA3A8`. Floor background is `#D7D7D7` in light mode and `#1B2327` in dark mode.

## Component and accessibility rules
- Status always has a text label or icon in addition to colour.
- Maintain WCAG AA contrast for normal text, visible keyboard focus and at least 44px touch targets for POS controls.
- The occupied red fill with white text is a fixed-colour exception at approximately 4.1:1 for small text; see `Design.md` for the required verification note.
- Room Planner `--pay-*` tokens remain scoped to `.room-planner`; do not use them elsewhere.
- Thermal receipts and print templates remain black on white and are not themed.
- Preserve routes, role/permission checks, business logic and existing POS/PMS workflows during presentation-only work.
