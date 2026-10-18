# OliTechs PMS + POS — Coastal Linen design system

## Product
Hotel property management and point of sale for front office, restaurant, housekeeping, stores and management teams.

## Design intent
Premium, light operational UI: airy spacing, clear context, restrained colour and fast scanning. Preserve operational density where needed without nested cards or heavy dividers.

## Canonical tokens
All canonical colours are defined once in `src/index.css :root`. Tailwind and shadcn values map to those tokens.

- Canvas `#F6F9F9`; surface `#FFFFFF`; sidebar `#EAF3F3`.
- Primary `#0F7C86`; hover `#0C6870`; soft selection `#DDF0F1`; accent `#E8955A`.
- Text `#223039`; muted `#6B7C85`; border `#E1EAEC`.
- Success `#2F9E7A` / `#E3F4EE`; danger `#D9534F` / `#FBE9E8`; warning `#E07A5F` / `#FCEDE8`.
- Room rack status: clean `#3FA77A`, dirty `#D9826B`, occupied `#4B7BE5`, checkout today `#6C63D9`, out of order `#B8BEC6`.

## Theme rules
Allowed colours are the tokens above and their semantic mappings. Black/near-black application surfaces, yellow/amber outside the Room Planner payment exception, dark mode, saturated warning states, and font weights above 500 are banned. Thermal print/receipt templates remain black on white. Room Planner payment colours are scoped to `.room-planner`: paid `#3FA77A`/white, deposit `#F2C14E`/`#5A4310`, unpaid `#EE8A3C`/white. No payment token outside the planner. Selection and today's column use primary/primary-soft.

## Component rules
- Cards: white, 1px border, 12px radius, no heavy shadows.
- Shadows only on floating menus, popovers and dialogs: `0 8px 24px rgba(34,48,57,0.08)`.
- One filled primary button per screen; other buttons outlined or text-only.
- Sidebar: pale teal, muted items, selected item primary-soft with primary text/icon.
- Tables: white rows, canvas header, muted 12–13px headings, subtle row dividers.
- Inputs: white, border token, visible 2px primary focus ring at 30% opacity.
- Typography: system UI, 400/500 weights, body 14–16px, headings 18–22px/500 and sentence case.
- Icons: outline, 18–20px; active primary, otherwise muted.
- Respect reduced motion; no blur/backdrop-filter or heavy gradients.
- POS touch targets at least 44px; status always has text or an icon in addition to colour.

## Layout and navigation
Keep operational context visible. Primary navigation categories are Front office, Planner, Folios, Restaurant, Stores and Reports; secondary modules belong under Settings, subject to existing role/module access. Search and create actions should occupy consistent positions. Avoid route/permission changes in visual-only work.

## Accessibility and performance
Meet WCAG AA for text and controls, preserve keyboard access, and check contrast of muted text on canvas/surface and white on primary. Measure build output before/after; lazy-load heavy routes and charts only when safe and verified.
