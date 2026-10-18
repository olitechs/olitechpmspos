# OliTechs PMS + POS — Coastal Linen design system

## Design intent
A calm, premium hotel operations interface with clear hierarchy, generous whitespace, light surfaces and consistent semantic states. This phase changes presentation only; domain behaviour, data, routes, permissions, receipts and print templates remain unchanged.

## Theme tokens
Canonical colours are declared once in `:root` in `src/index.css`. Tailwind and shadcn variables are mappings, not independent palettes.

| Token | Value | Usage |
|---|---|---|
| canvas | `#F6F9F9` | Page background |
| surface | `#FFFFFF` | Cards, panels, dialogs |
| sidebar | `#EAF3F3` | Navigation surface |
| primary | `#0F7C86` | Primary actions and active states |
| primary-hover | `#0C6870` | Hover |
| primary-soft | `#DDF0F1` | Selected states and planner today |
| accent | `#E8955A` | Restrained decorative accent |
| text | `#223039` | Main text |
| text-muted | `#6B7C85` | Secondary text |
| border | `#E1EAEC` | Borders and dividers |
| success | `#2F9E7A` on `#E3F4EE` | Success |
| danger | `#D9534F` on `#FBE9E8` | Errors |
| warning | `#E07A5F` on `#FCEDE8` | Warning |
| info | primary on primary-soft | Informational state |

Room status colours: clean `#3FA77A`, dirty `#D9826B`, occupied `#4B7BE5`, checking out `#6C63D9`, out of order `#B8BEC6`. Use a thin top status bar on white room tiles, labels/icons as well as colour, and light diagonal stripes for out-of-order rooms.

### Room Planner payment exception
Payment tokens are only consumed within `.room-planner`: paid `#3FA77A` with white text; deposit `#F2C14E` with `#5A4310` text; unpaid `#EE8A3C` with white text. Checked-out stays remain at 50% opacity. Selection and today's column use primary/primary-soft, not accent. No `--pay-*` token may be referenced outside the planner.

## Theme rules
- Allowed: the Coastal Linen tokens above, room-status tokens, soft semantic states, and the scoped Room Planner payment exception.
- Banned in application UI: black/near-black surfaces or text, yellow/amber outside the Room Planner payment legend/bars, saturated warning colours, dark sidebars, and font weights above 500.
- Exception: thermal receipt and print templates stay black on white for legibility and printing.
- Typography: system UI stack, weights 400 and 500 only, body 14–16px, headings 18–22px/500, sentence case.
- Cards: white surface, 1px border, 12px radius, no heavy shadow. Shadows only for floating elements: `0 8px 24px rgba(34,48,57,0.08)`.
- Buttons: one filled primary action per screen; secondary actions outlined or text-only. No black/gray filled buttons.
- Inputs: white surface, 1px border, visible primary focus ring. Tables use canvas headers, muted 12–13px labels and 1px row dividers.
- Respect reduced-motion preferences. Avoid blur, backdrop filters and heavy gradients.
- Keep POS touch targets at least 44px. Do not change business logic, data, routes or permissions during a theme pass.

## Navigation and page hierarchy
The shell should keep Front office, Planner, Folios, Restaurant, Stores and Reports prominent, with secondary administration grouped under Settings. Preserve existing role-filtered navigation and route guards. Global search and creation actions should remain consistent in position. Folios/orders need guest/table context. POS uses categories at the top, products centrally, ticket on the right, and Pay as the single filled action.

## Accessibility and performance
Maintain WCAG AA text contrast, visible keyboard focus, semantic labels, and status text/icons independent of colour. Lazy-load heavy route modules and charts only when it can be done without route or workflow regressions. Record build bundle sizes before and after; do not claim performance gains without measurements.
