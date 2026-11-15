# OliTechs Brand System Color Audit

**Audit date:** 2026-11-07

**Scope:** Active root Vite application, design-system guidance, Tailwind mappings, receipt/print templates, public brand assets and generated logo/manifest templates. No files were deleted. The historical `v6/` tree is reported separately and was not changed.

## Color source and result

`src/index.css` is the only source of literal color values. It now holds the 15 approved brand, payment and room-state literals plus two print-only literals that preserve existing black-on-white receipt text and the red void-slip warning. Components, Tailwind and asset templates use semantic CSS variables. The public SVGs/manifest and the retained documentation wordmark are rendered from `tools/brand-assets/*.in` by `scripts/prepare-brand-assets.mjs` during `predev`/`prebuild`, then restored to placeholder templates by the signal-aware dev wrapper or `postbuild`; the production `dist/` output retains rendered assets.

The strict audit scanned 218 active source/template files and passed: no active raw hex/RGB/HSL colors, palette-specific Tailwind utilities, literal black/white CSS colors, or unresolved `var(--token)` references remain outside `src/index.css`. The active palette contains no purple; the blue-indigo `--room-checkout` token is intentional and required for “checking out today.”

## Product-name and email coverage

The active application uses the exact `OliTechs` casing in the HTML title, README, PWA manifest, wordmark, public sign-in/registration copy, and receipt/print fallback copy. No app-owned outbound email body or subject template was found. `ForgotPassword.jsx` states that no email server is connected and exposes a generated reset link in development; any provider-managed email sender/template is outside this repository and was not verified.

## File-by-file color audit

| File(s) | Old value or treatment | New token / result |
|---|---|---|
| `src/index.css` | 117 distinct legacy hex values, including mixed light/dark palettes (`#081E22`, `#102B30`, `#173D40`, `#F3F7F7`), duplicated per-page values, and conflicting greens/reds/purples | Central tokens: `--deep-lagoon`, `--coastal-teal`, `--white`, `--soft-white`, `--canvas`, `--sidebar`, `--text`, `--accent`, `--status-*`, `--room-*`; print-only `--print-ink` and `--print-void` preserve output inks |
| `Design.md`, `design-system/olitechs-pms-pos/MASTER.md` | Competing palette examples and dark/legacy status values such as `#0E1417`, `#FA003F`, `#74C365`, `#C70032`, `#FAFAFA` | Document the single `src/index.css` token source and exact brand/payment/room-state mappings |
| `tailwind.config.js` | Semantic aliases depended on the old palette; `darkMode: false` triggered Tailwind’s system-media fallback warning | Color aliases map to `var(--token)`; `darkMode: 'class'` prevents OS dark mode from activating, and no `.dark` class is applied |
| `src/theme/ThemeProvider.jsx`, `index.html` | Dark/system mode and literal browser-theme colors (`#10171A`, `#F4F7F8`, `#0A3F4A`) | Fixed light mode; browser theme metadata is read from the `--deep-lagoon` token |
| `public/olitechs-logo.svg`, `public/app-icon.svg`, `public/favicon.svg`, `public/manifest.json` | Repeated brand hex values (`#0A3F4A`, `#0F7C86`, `#F5F8F8`, `#FFFFFF`, `#fff`) | Existing paths retained as token-placeholder templates; build/dev generation substitutes values from `src/index.css` |
| `docs/assets/olitechs-horizontal-light.svg` | Duplicate `#0A3F4A`, `#0F7C86`, `#F5F8F8`, and `#fff` values | File retained and generated from the same logo template/tokens; it is not a second palette source |
| `src/components/admin/SubscriptionPanel.jsx` | `bg-orange-50`, `border-orange-200`, `text-orange-700` | `--warning-soft`, `--warning`, `--warning-text` |
| `src/components/admin/TableSetup.jsx`, `src/components/admin/Printers.jsx`, `src/components/admin/StaffAdmin.jsx` | `#090C11`, `#fff`, or a brand-blue fill paired with body-text foreground | `--text`, `--white`, `--primary`, `--on-primary` |
| `src/components/modules/Folio.jsx` | `#17212b`, `#e5eaee`, `print:bg-white`, `print:border-black`, `text-amber-700` | `--print-ink`, `--print-border`, `--print-paper`, and the deposit/status foreground tokens |
| `src/components/modules/KitchenDisplay.jsx` | `border-white` | `--border` / semantic surface border |
| `src/components/pms/RoomManagement.jsx`, `RoomPanel.jsx` | `#090C11`, `#FDECEC`, dark-on-teal primary buttons | `--text`, `--danger-soft`, `--primary`, `--on-primary` |
| `src/components/pms/RoomPlanner.jsx` | `#111`, `#202020`, `#262B32`, `#757B81`, `#FFFFFF`, `#ddd`, `#fff`; Italian payment-legend labels | `--text`, `--print-*`, `--room-*`, and `--pay-*`; legend labels now read “Paid,” “Deposit paid,” and “Not paid” |
| `src/components/pos/POSContainer.jsx` | `bg-black`, `bg-red-50`, `text-amber-600`, `text-red-700`, `text-teal-700` | `--overlay-scrim`, `--danger-soft`, `--warning-text`, `--danger-text`, `--primary` |
| `src/components/pos/OrderTaking.jsx`, `FloorPlan.jsx`, `BillPayment.jsx`, `AppHeader.jsx`, `OpenTableDialog.jsx`, `CloseShiftModal.jsx`, `PrintWarn.jsx`, `POSAccessGate.jsx` | Mixed white/black/gray/red/amber/teal utilities and inline color literals | Semantic canvas/surface/text/border/primary/warning/danger/room/payment tokens; POS stock cards also show a small `LOW STOCK` warning badge from `min_stock` |
| `src/components/settings/PrinterGroupModal.jsx` | Material green/red/yellow/gray hex palette (`#43A047`, `#D32F2F`, `#F0F0F0`, etc.) and `text-white` | Shared success, warning, danger, surface, and on-primary tokens |
| `src/components/settings/ReceiptPreview.jsx`, `ReceiptSettings.jsx`, `src/pages/SettingsPrinters.jsx` | `bg-white`, `border-black`, `text-black`, `accent-red-600`, `#F7F8FA` | `--print-paper`, `--print-border`, `--print-ink`, `--danger`, `--canvas` |
| `src/components/shell/POSTabs.jsx`, `SocialFAB.jsx`, `TopBar.jsx` | `border-white`, `text-white`, and platform-specific social colors (`#0A66C2`, `#1877F2`, `#25D366`, etc.) | Primary/on-primary/surface/border tokens; social marks are monochrome so off-palette brand colors do not leak into the interface |
| `src/components/store/SupplierList.jsx`, `src/pages/Store.jsx`, `Register.jsx` | `text-white` without a shared semantic pairing | `--on-primary` on primary fills; status and store surfaces use semantic tokens |
| `src/components/ui/AuthLayout.jsx`, `ErrorBoundary.jsx`, `GoogleIcon.jsx`, `UserNotRegisteredError.jsx`, `system.jsx`, `dialog.jsx` | Gray utility values, colored Google mark literals, `text-white`, orange/red utility classes | `--surface`, `--sidebar`, `--border`, `--text`, `--danger-*`, `--warning-*`, `--on-primary`; Google provider mark is monochrome |
| `src/data/PmsStore.jsx` | `#2E7D32`, `#EF6C00`, `#F9A825` | `--status-paid`, `--status-not-paid`, `--status-deposit-paid` |
| `src/pages/PublicHome.jsx`, `PublicSignIn.jsx`, `PublicSignUp.jsx` | `bg-white`, `border-white`, `from-white`, `hover:border-white` | `--surface`, `--white`, `--border`, `--primary-soft`, `--primary` |
| `src/services/printService.js`, `printTemplates.js`, `src/utils/printTheme.js` | `#DC2626`, `#fff`, and named `black`/`white` print CSS values | Runtime values resolve from `--print-void`, `--print-void-foreground`, `--print-paper`, `--print-ink`, `--print-border`; receipt and void-slip output colors are preserved |
| `supabase/functions/print-proxy/index.ts`, `tools/print-agent/server.mjs` | Fixed/fallback print colors or inconsistent brand copy | Theme-derived print aliases and exact `OliTechs` casing; printer workflow behavior is retained |
| `README.md` | Literal color badge/logo values and inconsistent brand variants | Exact `OliTechs` spelling and token/template guidance |
| `src/components/ui/ThemeToggle.jsx` | Light/dark/system selector | File retained as a compatibility component showing only “OliTechs · Light”; it cannot set dark/system mode |

## Status and screen findings

| Screen/state | Finding | Status |
|---|---|---|
| Active root application screens | Strict scan finds no off-palette color literals/classes; theme provider is fixed light and all tokens resolve | Pass by source audit and tests; authenticated screens were not visually exercised |
| Payment status labels in Room Planner and other status-chip consumers | The required Paid fill/white text is `2.99:1`; required Not paid fill/white text is `2.52:1` | **Accessibility exception:** both are below WCAG AA normal-text contrast (and Not paid also fails the 3:1 large-text threshold). The exact user-mandated fills/white foregrounds were retained; this cannot be solved without changing the mandated colors. Keep explicit text labels and do not encode state by color alone. |
| Deposit paid, vacant clean/dirty, occupied, checkout-today, and out-of-order room states | Measured foreground/background ratios: `5.57:1`, `4.53:1`, `5.57:1`, `5.39:1`, `7.73:1`, `4.95:1` respectively | Pass at the tested token pairs; out-of-order retains a diagonal gray stripe |
| Historical `v6/` duplicate | Read-only scan found 59 files with 735 legacy literal/palette references | **Flagged and not changed:** repository guidance marks this historical tree inactive; the active root is the tested application. It remains a theme break if consumers still serve `v6/`. |
| Authenticated POS/tablet screenshots | Sandbox has no `.env`/`.env.local` and both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are unset; the local app shows the safe setup gate | **Not verified:** no authenticated POS screen or before/after POS screenshot is claimed. Diagnostic screenshot: [`local-preview-setup-gate.png`](screenshots/local-preview-setup-gate.png). |
| Printer hardware | Local Print Agent and printer hardware are not attached to this sandbox | Not hardware-tested; print contracts and build passed |

## Validation

- `npm run lint` — passed, including the brand contract (`npm run check:brand`) and strict token scan.
- `npm run typecheck` — passed.
- `npm run test:architecture` — 166 tests passed.
- `npm run build` — passed; Vite still reports the existing large-main-chunk advisory (>500 kB).
- `npm run check:contrast` — all unconstrained theme/status pairs passed; the two required white-text payment exceptions above were explicitly reported.
- `GET /`, `/manus-routes.json`, `/manifest.json`, and `/olitechs-logo.svg` returned HTTP 200 locally; the route manifest matches all 65 resolved routes.
