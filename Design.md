# OliTechs — Brand and theme system

## Design intent
OliTechs is a professional hospitality operations interface with a light-only OliTechs navy/blue palette, calm hierarchy, clear semantic surfaces and touch-first workflows. Theme work is presentation-only: preserve domain behavior, data, routes, permissions, stores, receipts, printer routing and payment functionality.

## Canonical colour source
`src/index.css` is the single source of application colour values. Components, Tailwind and shadcn use CSS variables and semantic aliases only. Do not introduce a second palette, palette-specific utility classes, inline colour literals or a dark/system theme.

### Approved navy/blue brand tokens

| Purpose | Token |
|---|---|
| Navy brand | `--brand-navy` (`#101A35`) |
| Primary blue | `--brand-blue`, `--coastal-teal`, `--primary` (`#285FE7`) |
| Primary hover / dark anchor | `--brand-blue-hover`, `--deep-lagoon` |
| Soft blue / canvas / white | `--brand-blue-soft`, `--brand-canvas`, `--brand-white`, `--soft-white`, `--canvas`, `--white` |
| Sidebar / text / muted text / border | `--sidebar`, `--text`, `--text-muted`, `--border` |
| Small highlights and warnings only | `--accent`, `--warning`, `--warning-soft` |

The brand palette is navy `#101A35`, primary blue `#285FE7`, hover blue `#174AC8`, soft blue `#F3F7FF`, canvas `#F8FAFF`, sidebar `#EEF3FC`, and white `#FFFFFF`. The `--deep-lagoon` and `--coastal-teal` names remain as compatibility aliases for existing component contracts; their values follow the current OliTechs navy/blue palette.

Use the official brand tokens for the logo, headers, primary buttons, active states, links and key accents. Do not use the warning accent as a large surface or in the logo. The canvas and normal working surfaces remain light; do not introduce black areas.

## Functional status tokens

| State | Fill token | Foreground token |
|---|---|---|
| Paid | `--status-paid` | white (`--white`) |
| Deposit paid | `--status-deposit-paid` | `--status-deposit-foreground` |
| Not paid | `--status-not-paid` | white (`--status-not-paid-foreground`) |
| Vacant clean | `--room-clean` | semantic foreground |
| Vacant dirty | `--room-dirty` | semantic foreground |
| Occupied | `--room-occupied` | white |
| Checking out today | `--room-checkout` | white |
| Out of order | `--room-out-of-order` with `--room-out-of-order-stripe` | semantic foreground |

Status must also be identifiable by a text label or icon, not colour alone. Keep room-status colors distinct from payment-status semantics.

## Room Planner
The planner uses the `--cal-*` family for page, header, grid, weekend, today, room and scrollbar colors. Payment/booking status uses consistent fill, foreground and border triplets: `--pay-none`, `--pay-part`, `--pay-paid`, `--pay-opt`, and `--st-cancel` with their matching `-fg` / `-bd` aliases. These planner aliases remain scoped to the planner.

## Light-only theme behavior
The whole app uses a light appearance. There is no theme selector, saved dark mode, system-color-mode listener, `.dark` palette, or dark Tailwind variant. The provider may set the light browser color-scheme and read brand metadata from the canonical CSS tokens.

## Component and accessibility rules
- Define canonical colour literals only in `src/index.css`; public logo/PWA assets are generated from those tokens during `npm run dev` and `npm run build`.
- Use semantic foregrounds on colored buttons and status fills; never pair body text with a primary fill without the matching foreground token.
- Maintain WCAG AA contrast for normal text and at least 3:1 for UI boundaries/icons; validate actual component pairings. The fixed user-mandated white text on Paid and Not paid fills is an exception: measured contrast is 2.99:1 and 2.52:1 respectively. Preserve those exact pairs, render these status labels explicitly in bold high-emphasis text, and never rely on color alone; do not silently adjust the specified fill or foreground.
- POS controls use touch targets of at least 44px, preferably 48px for frequent actions.
- Keep normal text contrast readable at tablet viewing distance; labels and icons supplement color.
- Respect reduced-motion preferences and visible keyboard focus.
- Printed receipts retain legible paper/ink styling through `--print-*` aliases; printer/receipt logic remains unchanged.

## Scope and rollout
Apply this system to the active root Vite application. Do not modify the historical `v6/` duplicate. Preserve routes, role/permission checks, reservation/billing logic, POS/PMS workflows, printer behavior and database schema while migrating presentation.
