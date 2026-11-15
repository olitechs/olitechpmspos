# OliTechs — Brand and theme system

The canonical theme specification is maintained in the root `Design.md`. This file is the design-system entry point; do not maintain a competing palette here.

## Theme mode
The application is light-only. There is no dark/system mode selector, dark palette, or dark Tailwind variant.

## Canonical tokens
All application colour values live in `src/index.css` under a single `:root`. Tailwind and shadcn values are CSS-variable mappings only. Component code must use semantic tokens and must not introduce raw colour literals, palette-specific utility classes, inline color values or another palette.

- Brand: `--brand-navy` (`--deep-lagoon`), `--brand-blue` (`--coastal-teal`), `--brand-blue-hover`, `--brand-blue-soft`, `--brand-canvas`, `--brand-white`, `--white`, `--soft-white`, `--accent`.
- Surfaces and text: `--canvas`, `--surface`, `--sidebar`, `--primary`, `--primary-hover`, `--text`, `--text-muted`, `--border`.
- Public marketing surfaces: `--mkt-*`, every value derived from the brand and status tokens with `color-mix()`.
- Payment status: `--status-paid`, `--status-deposit-paid`, `--status-not-paid`, with their matching foreground aliases.
- Room status: `--room-clean`, `--room-dirty`, `--room-occupied`, `--room-checkout`, `--room-out-of-order` and the diagonal `--room-out-of-order-stripe` treatment.

The warning accent is reserved for small highlights and warnings; never use it for large areas or the logo. No purple palette is used.

## Component and accessibility rules
- Status always has a text label or icon in addition to color.
- Maintain WCAG AA contrast for normal text, visible keyboard focus and at least 44px touch targets for POS controls; use 48px for frequent actions where practical.
- Pair filled status colors with the required semantic foreground token.
- Room Planner `--pay-*` tokens remain scoped to `.room-planner`; do not use them elsewhere.
- Public logo, favicon, app icon and manifest color metadata are generated from the canonical theme tokens during dev/build.
- Print/receipt UI uses `--print-*` aliases; preserve print data and output behavior.
- Preserve routes, role/permission checks, business logic and existing POS/PMS workflows during presentation-only work.

## POS priority
Speed and error prevention take precedence over decoration. Keep table context visible, categories and products easy to scan, the current order legible, payment methods explicit, and room charge treated as a folio operation. Void, refund and discount actions retain their existing confirmation and permission controls.
